import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AutoLayoutRequest,
  type CalibrateRequest,
  calibrateRoomShell,
  CalibrationError,
  type CreateProjectFields,
  CreateProjectFieldsSchema,
  DEFAULT_PROMPT_STRENGTH,
  DEFAULT_STYLES,
  type DesignProject,
  type DesignProjectVersion,
  type GenerateStylesRequest,
  type ImportProjectRequest,
  type JobAccepted,
  type JobProgressEvent,
  type ProjectListItem,
  resizeRoomShell,
  RoomGeometryError,
  type RoomShell,
  scalePlacements,
  type PlanPosition,
  SetHomeRequest,
  type ShareLink,
  type ShoppingList,
  STAGE_MESSAGES,
  type StyleId,
  type UpdateRoomRequest,
  type UpdateSceneRequest,
} from '@interiores/shared-types';
import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import { ValidationError } from '../../common/errors.js';
import { MediaUrlSigner } from '../../infrastructure/media/media-url-signer.js';
import { PhotoProcessor } from '../../infrastructure/imaging/photo-processor.js';
import {
  APP_CONFIG,
  CATALOG_REPOSITORY,
  FILE_STORAGE,
  type ICatalogRepository,
  type IFileStorage,
  type IJobQueue,
  type IProgressBroker,
  type IProjectRepository,
  type IQuota,
  JOB_QUEUE,
  PROGRESS_BROKER,
  PROJECT_REPOSITORY,
  type ProjectRecord,
  QUOTA,
} from '../../ports/index.js';
import { projectKeys, toListItem } from './project.mapper.js';
import type { ProjectDossier, HomeDossier } from './shopping-list.pdf.js';
import { newRoomFor } from './room-factory.js';
import { HomesService } from './homes.service.js';
import { ProjectAccess, revisionGuard, type Actor } from './project-access.js';
import { ProjectReports } from './project-reports.service.js';
import { SceneRules } from './scene-rules.js';
import { SharingService } from './sharing.service.js';
import { VersionsService } from './versions.service.js';

export type { Actor } from './project-access.js';

/** Una preview "pending" más vieja que esto se considera colgada y se puede volver a pedir. */
export const STALE_PENDING_MS = 15 * 60_000;

export const previewCacheKey =(photoHash: string, styleId: StyleId, strength: number) =>
  createHash('sha256').update(`${photoHash}|${styleId}|${strength.toFixed(2)}|v1`).digest('hex');

/**
 * Casos de uso del agregado DesignProject. No conoce HTTP, Prisma, S3 ni BullMQ:
 * solo los puertos. Todas las operaciones verifican propiedad y devuelven 404 (no 403)
 * a quien no es dueño, para no filtrar la existencia de proyectos ajenos.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  /** Reloj inyectable (las pruebas lo fijan). */
  clock: () => number = () => Date.now();
  private readonly access: ProjectAccess;
  private readonly rules: SceneRules;
  private readonly versions: VersionsService;
  private readonly sharing: SharingService;
  private readonly reports: ProjectReports;
  private readonly homes: HomesService;

  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: IProjectRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: ICatalogRepository,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    @Inject(JOB_QUEUE) private readonly queue: IJobQueue,
    @Inject(PROGRESS_BROKER) private readonly progress: IProgressBroker,
    @Inject(QUOTA) private readonly quota: IQuota,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly photos: PhotoProcessor,
    private readonly signer: MediaUrlSigner,
  ) {
    this.access = new ProjectAccess(projects, signer);
    this.rules = new SceneRules(catalog);
    this.versions = new VersionsService(projects, this.access);
    this.sharing = new SharingService(projects, this.access);
    this.reports = new ProjectReports(catalog, this.access, projects);
    this.homes = new HomesService(projects, this.access);
  }

  // ------------------------------------------------------------------ delegado en sus colaboradores
  own(actor: Actor, id: string): Promise<ProjectRecord> {
    return this.access.own(actor, id);
  }

  toDto(project: ProjectRecord): Promise<DesignProject> {
    return this.access.toDto(project);
  }

  setHome(actor: Actor, id: string, req: SetHomeRequest): Promise<DesignProject> {
    return this.homes.setHome(actor, id, req);
  }

  setHomePosition(actor: Actor, id: string, position: PlanPosition): Promise<DesignProject> {
    return this.homes.setPosition(actor, id, position);
  }

  /** Tope de gasto del cuarto: una nota de quien lo diseña, no cambia la escena ni su revisión. */
  async setBudget(actor: Actor, id: string, cap: number | null): Promise<DesignProject> {
    await this.access.own(actor, id);
    return this.toDto(await this.projects.update(id, { budgetCap: cap }));
  }

  saveVersion(actor: Actor, id: string, note?: string): Promise<DesignProject> {
    return this.versions.saveVersion(actor, id, note);
  }

  version(actor: Actor, id: string, versionId: string): Promise<DesignProjectVersion> {
    return this.versions.version(actor, id, versionId);
  }

  restoreVersion(actor: Actor, id: string, versionId: string, revision?: number): Promise<DesignProject> {
    return this.versions.restoreVersion(actor, id, versionId, revision);
  }

  share(actor: Actor, id: string): Promise<ShareLink> {
    return this.sharing.share(actor, id);
  }

  unshare(actor: Actor, id: string): Promise<void> {
    return this.sharing.unshare(actor, id);
  }

  shoppingList(actor: Actor, id: string): Promise<ShoppingList> {
    return this.reports.shoppingList(actor, id);
  }

  buildShoppingList(project: ProjectRecord): Promise<ShoppingList> {
    return this.reports.buildShoppingList(project);
  }

  dossier(actor: Actor, id: string): Promise<ProjectDossier> {
    return this.reports.dossier(actor, id);
  }

  homeDossier(actor: Actor, id: string): Promise<HomeDossier> {
    return this.reports.homeDossier(actor, id);
  }

  // ------------------------------------------------------------------ lectura
  async list(actor: Actor): Promise<ProjectListItem[]> {
    const rows = await this.projects.listByOwner(actor.userId);
    // Una sola consulta al catálogo para toda la lista, no una por proyecto.
    const ids = [...new Set(rows.flatMap((p) => p.placements.map((placement) => placement.catalogItemId)))];
    const prices = new Map((ids.length ? await this.catalog.findByIds(ids) : []).map((item) => [item.id, item]));
    return rows.map((p) => toListItem(p, this.signer, prices));
  }

  async get(actor: Actor, id: string): Promise<DesignProject> {
    return this.toDto(await this.own(actor, id));
  }

  async progressHistory(actor: Actor, id: string): Promise<JobProgressEvent[]> {
    await this.own(actor, id);
    return this.progress.history(id);
  }

  // ------------------------------------------------------------------ creación (paso 1-2 del flujo)
  async create(actor: Actor, rawFields: CreateProjectFields, photo: Buffer | undefined): Promise<DesignProject> {
    const fields = CreateProjectFieldsSchema.parse(rawFields);
    // El cuarto definido a mano se valida antes de gastar nada; sin él, la foto es obligatoria.
    const room = newRoomFor({ ...fields, hasPhoto: !!photo });
    const styles = fields.styles ?? [...DEFAULT_STYLES];

    // Primero se valida la foto (barato) y después se consume cuota. Sin foto no hay propuestas
    // de estilo que generar, así que no se consume.
    const processed = photo ? await this.photos.process(photo, this.config.UPLOAD_MAX_MB * 1024 * 1024) : null;
    if (processed) await this.quota.consume(actor.userId, styles.length);

    // Un cuarto nuevo dentro de una vivienda: la vivienda tiene que ser de quien lo crea.
    const home = fields.homeId ? await this.homes.homeOf(actor, fields.homeId) : null;
    const id = randomUUID();
    try {
      if (processed) {
        await this.storage.put(projectKeys.photo(id), processed.photo, 'image/jpeg');
        await this.storage.put(projectKeys.thumb(id), processed.thumbnail, 'image/webp');
      }
      const project = await this.projects.create({
        id,
        ownerId: actor.userId,
        name: fields.name,
        roomType: fields.roomType,
        status: 'processing',
        photoKey: processed ? projectKeys.photo(id) : null,
        photoHash: processed?.hash ?? null,
        thumbKey: processed ? projectKeys.thumb(id) : null,
        roomShell: room.shell,
        placements: [],
        finishes: null,
        requestedRoom: room.requestedRoom,
        selectedStyleId: null,
        requestedStyles: styles,
        saved: false,
        homeId: home?.id ?? null,
        homeName: home?.name ?? null,
      });
      const jobId = await this.enqueueFirstJob(id, room.firstJob, styles, actor);
      this.logger.log({ projectId: id, jobId, kind: room.firstJob, requestId: actor.requestId }, 'Proyecto creado y encolado');
      return this.toDto(project);
    } catch (err) {
      if (processed) await this.quota.refund(actor.userId, styles.length).catch(() => undefined);
      await this.projects.delete(id).catch(() => undefined);
      await this.storage.deletePrefix(projectKeys.prefix(id)).catch(() => undefined);
      // El adaptador de la cola ya traduce los fallos de Redis a DependencyError (503).
      throw err;
    }
  }

  /**
   * Encola el trabajo que termina de montar un proyecto: el análisis de la foto o, si el cuarto
   * se definió a mano y no hay foto, amueblarlo directamente.
   */
  private async enqueueFirstJob(id: string, kind: 'analyze-room' | 'build-scene', styles: StyleId[], actor: Actor): Promise<string> {
    const requestId = actor.requestId ? { requestId: actor.requestId } : {};
    const jobId =
      kind === 'analyze-room'
        ? await this.queue.enqueue('analyze-room', `analyze.${id}`, { projectId: id, styles, promptStrength: DEFAULT_PROMPT_STRENGTH, ...requestId })
        : await this.queue.enqueue('build-scene', `scene.${id}`, { projectId: id, styleId: styles[0] ?? null, keepLocked: false, finalize: true, ...requestId });
    await this.publishQueued(id, jobId, kind);
    return jobId;
  }

  /** Reintenta montar un proyecto que falló (p. ej. la IA estaba caída). */
  async retryAnalysis(actor: Actor, id: string): Promise<DesignProject> {
    const project = await this.own(actor, id);
    if (project.status !== 'failed') throw new ValidationError('Solo se pueden reintentar proyectos con error');
    const updated = await this.projects.update(id, { status: 'processing', lastError: null });
    const styles = project.requestedStyles.length ? project.requestedStyles : [...DEFAULT_STYLES];
    await this.enqueueFirstJob(id, project.photoKey ? 'analyze-room' : 'build-scene', styles, actor);
    return this.toDto(updated);
  }

  async rename(actor: Actor, id: string, name: string, revision?: number): Promise<DesignProject> {
    await this.own(actor, id);
    return this.toDto(await this.projects.update(id, { name }, revisionGuard(revision)));
  }

  /**
   * Copia el diseño (cuarto, muebles, acabados y estilo) en un proyecto nuevo, para probar una
   * variante sin tocar el original. La foto, las propuestas 2D y las versiones no se copian: la
   * copia nace como un cuarto ya listo, sin guardar.
   */
  async duplicate(actor: Actor, id: string): Promise<DesignProject> {
    const source = await this.own(actor, id);
    const shell = this.access.requireShell(source);
    const suffix = ' (copia)';
    const copy = await this.projects.create({
      id: randomUUID(),
      ownerId: actor.userId,
      name: `${source.name.slice(0, 120 - suffix.length)}${suffix}`,
      roomType: source.roomType,
      status: 'ready',
      photoKey: null,
      photoHash: null,
      thumbKey: null,
      roomShell: shell,
      placements: source.placements,
      finishes: source.finishes,
      requestedRoom: source.requestedRoom,
      photoInventory: source.photoInventory ?? null,
      homeId: source.homeId ?? null,
      homeName: source.homeName ?? null,
      budgetCap: source.budgetCap ?? null,
      selectedStyleId: source.selectedStyleId,
      requestedStyles: source.requestedStyles,
      saved: false,
    });
    this.logger.log({ projectId: copy.id, from: id, requestId: actor.requestId }, 'Proyecto duplicado');
    return this.toDto(copy);
  }

  /**
   * Un cuarto hecho fuera (la demo sin cuenta) entra como proyecto propio, ya listo. Pasa por las
   * mismas comprobaciones que una escena guardada: planta válida, muebles que existen y caben,
   * acabados conocidos. Nace guardado: quien lo importa pidió conservarlo.
   */
  async importScene(actor: Actor, req: ImportProjectRequest): Promise<DesignProject> {
    const shell = this.rules.editedShell({ ...req.roomShell, id: randomUUID() }, req.roomShell);
    const placements = await this.rules.sanitizePlacements(shell, req.furniturePlacements);
    if (req.finishes) this.rules.validateFinishes(req.finishes);
    const created = await this.projects.create({
      id: randomUUID(),
      ownerId: actor.userId,
      name: req.name,
      roomType: req.roomType,
      status: 'ready',
      photoKey: null,
      photoHash: null,
      thumbKey: null,
      roomShell: shell,
      placements,
      budgetCap: req.budgetCap ?? null,
      finishes: req.finishes ?? null,
      requestedRoom: null,
      selectedStyleId: req.selectedStyleId ?? null,
      requestedStyles: req.selectedStyleId ? [req.selectedStyleId] : [],
      saved: true,
    });
    this.logger.log({ projectId: created.id, pieces: placements.length, requestId: actor.requestId }, 'Proyecto importado');
    return this.toDto(created);
  }



  /** Borrado REAL de base de datos y archivos (§8.4 privacidad). */
  async remove(actor: Actor, id: string): Promise<void> {
    await this.own(actor, id);
    await this.hardDelete(id);
  }

  /**
   * Primero la base de datos (así el proyecto deja de existir para la API de inmediato) y
   * después S3. Si el borrado de archivos falla, el barrido de huérfanos de RetentionService
   * los elimina más tarde: nunca queda una fila apuntando a archivos inexistentes.
   */
  async hardDelete(id: string): Promise<void> {
    await this.projects.delete(id);
    const removed = await this.storage.deletePrefix(projectKeys.prefix(id)).catch((err) => {
      this.logger.warn({ err, projectId: id }, 'No se pudieron borrar los archivos; quedan para el barrido de huérfanos');
      return 0;
    });
    this.logger.log({ projectId: id, removedObjects: removed }, 'Proyecto eliminado definitivamente');
  }

  // ------------------------------------------------------------------ escena 3D (paso 5)
  async updateScene(actor: Actor, id: string, req: UpdateSceneRequest): Promise<DesignProject> {
    const project = await this.own(actor, id);
    const current = this.access.requireShell(project);
    const shell = req.roomShell ? this.rules.editedShell(current, req.roomShell) : current;
    const placements = await this.rules.sanitizePlacements(shell, req.furniturePlacements);
    if (req.finishes) this.rules.validateFinishes(req.finishes);
    const updated = await this.projects.update(
      id,
      {
        placements,
        ...(req.roomShell ? { roomShell: shell } : {}),
        ...(req.selectedStyleId !== undefined ? { selectedStyleId: req.selectedStyleId } : {}),
        ...(req.finishes !== undefined ? { finishes: req.finishes } : {}),
      },
      { expectedRevision: req.revision, bumpRevision: true },
    );
    return this.toDto(updated);
  }


  /**
   * Medidas exactas del cuarto: ancho, largo y alto independientes (y opcionalmente sus puertas y
   * ventanas). Los muebles se reacomodan lo mínimo para quedar dentro; ninguno se borra.
   */
  async updateRoom(actor: Actor, id: string, req: UpdateRoomRequest): Promise<DesignProject> {
    const project = await this.own(actor, id);
    const shell = this.access.requireShell(project);
    let next: RoomShell;
    try {
      next = resizeRoomShell(shell, { widthM: req.widthM, depthM: req.depthM, heightM: req.heightM }, req.openings);
    } catch (err) {
      if (err instanceof RoomGeometryError) throw new ValidationError(err.message);
      throw err;
    }
    const placements = await this.rules.sanitizePlacements(next, project.placements);
    const updated = await this.projects.update(
      id,
      { roomShell: next, placements },
      { expectedRevision: req.revision, bumpRevision: true },
    );
    return this.toDto(updated);
  }

  async calibrate(actor: Actor, id: string, req: CalibrateRequest): Promise<DesignProject> {
    const project = await this.own(actor, id);
    const shell = this.access.requireShell(project);
    let result: { shell: RoomShell; factor: number };
    try {
      result = calibrateRoomShell(shell, req.reference, req.valueM);
    } catch (err) {
      if (err instanceof CalibrationError) throw new ValidationError(err.message);
      throw err;
    }
    const placements = await this.rules.sanitizePlacements(result.shell, scalePlacements(project.placements, result.factor));
    const updated = await this.projects.update(
      id,
      { roomShell: result.shell, placements },
      { expectedRevision: req.revision, bumpRevision: true },
    );
    return this.toDto(updated);
  }

  async selectStyle(actor: Actor, id: string, styleId: StyleId | null, revision?: number): Promise<DesignProject> {
    await this.own(actor, id);
    return this.toDto(await this.projects.update(id, { selectedStyleId: styleId }, revisionGuard(revision)));
  }




  // ------------------------------------------------------------------ Track A: estilos
  async generateStyles(actor: Actor, id: string, req: GenerateStylesRequest): Promise<JobAccepted> {
    const project = await this.own(actor, id);
    if (!project.photoHash || !project.photoKey) throw new ValidationError('El proyecto no tiene foto');

    // 1) Se decide qué hay que generar sin escribir nada todavía.
    const toGenerate: { styleId: StyleId; cacheKey: string }[] = [];
    const now = this.clock();
    for (const styleId of req.styles) {
      const cacheKey = previewCacheKey(project.photoHash, styleId, req.promptStrength);
      const cached = await this.projects.findPreviewByCacheKey(id, cacheKey);
      if (cached?.status === 'pending') {
        if (now - cached.createdAt.getTime() < STALE_PENDING_MS) continue; // ya se está generando
        // Quedó colgada (p. ej. el worker murió): se da por fallida y se vuelve a pedir.
        await this.projects.updatePreview(cached.id, { status: 'failed', error: 'La generación no terminó a tiempo' });
      }
      if (cached?.status === 'ready') {
        // Misma foto + estilo + intensidad: se reutiliza el render (no se vuelve a pagar la
        // inferencia) y se registra como la generación más reciente de ese estilo.
        await this.projects.createPreview({
          projectId: id,
          styleId,
          promptStrength: req.promptStrength,
          status: 'ready',
          imageKey: cached.imageKey,
          cacheKey,
          provider: `${(cached.provider ?? 'desconocido').replace(/ \(caché\)$/, '')} (caché)`,
        });
        continue;
      }
      toGenerate.push({ styleId, cacheKey });
    }
    if (toGenerate.length === 0) return { jobId: 'cached', projectId: id };

    // 2) Cuota antes de crear filas: si se excede (429) no queda ninguna preview "pending" huérfana.
    await this.quota.consume(actor.userId, toGenerate.length);
    const created: string[] = [];
    try {
      for (const { styleId, cacheKey } of toGenerate) {
        const preview = await this.projects.createPreview({
          projectId: id,
          styleId,
          promptStrength: req.promptStrength,
          status: 'pending',
          imageKey: null,
          cacheKey,
          provider: null,
        });
        created.push(preview.id);
      }
      const digest = createHash('sha256').update(created.join(',')).digest('hex').slice(0, 16);
      const jobId = await this.queue.enqueue('generate-styles', `styles.${id}.${digest}`, {
        projectId: id,
        previewIds: created,
        ...(actor.requestId ? { requestId: actor.requestId } : {}),
      });
      await this.publishQueued(id, jobId, 'generate-styles');
      return { jobId, projectId: id };
    } catch (err) {
      // 3) Compensación: las previews no se van a generar → fallidas (no bloquean reintentos) y cuota devuelta.
      await Promise.all(
        created.map((pid) =>
          this.projects.updatePreview(pid, { status: 'failed', error: 'No se pudo encolar la generación' }).catch(() => undefined),
        ),
      );
      await this.quota.refund(actor.userId, toGenerate.length).catch(() => undefined);
      throw err;
    }
  }

  // ------------------------------------------------------------------ Track B: layout automático
  async autoLayout(actor: Actor, id: string, req: AutoLayoutRequest): Promise<JobAccepted> {
    const project = await this.own(actor, id);
    this.access.requireShell(project);
    const styleId = req.styleId === undefined ? project.selectedStyleId : req.styleId;
    // El id lleva la revisión: dos peticiones sobre la misma escena (un doble clic) son un solo
    // job, pero en cuanto la escena cambia la siguiente es otro. Con un id fijo por proyecto, pedir
    // otra distribución justo al terminar la anterior se perdía: la cola aún recordaba ese id.
    const jobId = await this.queue.enqueue('build-scene', `scene.${id}.r${project.revision}`, {
      projectId: id,
      styleId,
      keepLocked: req.keepLocked ?? true,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(actor.requestId ? { requestId: actor.requestId } : {}),
    });
    await this.publishQueued(id, jobId, 'build-scene');
    return { jobId, projectId: id };
  }











  private async publishQueued(projectId: string, jobId: string, kind: JobProgressEvent['kind']): Promise<void> {
    await this.progress
      .publish({
        jobId,
        projectId,
        kind,
        stage: 'queued',
        pct: 0,
        message: STAGE_MESSAGES.queued,
        status: 'active',
        at: new Date().toISOString(),
      })
      .catch((err) => this.logger.warn({ err }, 'No se pudo publicar el progreso inicial'));
  }
}
