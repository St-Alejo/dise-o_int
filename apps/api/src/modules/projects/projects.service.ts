import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CalibrationError,
  DEFAULT_PROMPT_STRENGTH,
  DEFAULT_STYLES,
  RoomGeometryError,
  STAGE_MESSAGES,
  UnknownMaterialError,
  assertValidFinishes,
  calibrateRoomShell,
  clampDimensions,
  describeVariant,
  clampToRoom,
  defaultResizeRanges,
  effectiveDimensions,
  mountY,
  resizeRoomShell,
  scalePlacements,
  type AutoLayoutRequest,
  type CalibrateRequest,
  type CreateProjectFields,
  type DesignProject,
  type FurniturePlacement,
  type GenerateStylesRequest,
  type JobAccepted,
  type JobProgressEvent,
  type ProjectListItem,
  type RoomShell,
  type ShareLink,
  type ShoppingList,
  type RoomFinishes,
  type StyleId,
  type UpdateRoomRequest,
  type UpdateSceneRequest,
  type Vector3,
  CreateProjectFieldsSchema,
} from '@interiores/shared-types';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { MediaUrlSigner } from '../../infrastructure/media/media-url-signer.js';
import { PhotoProcessor } from '../../infrastructure/imaging/photo-processor.js';
import {
  APP_CONFIG,
  CATALOG_REPOSITORY,
  FILE_STORAGE,
  JOB_QUEUE,
  PROGRESS_BROKER,
  PROJECT_REPOSITORY,
  QUOTA,
  type CatalogRecord,
  type ICatalogRepository,
  type IFileStorage,
  type IJobQueue,
  type IProgressBroker,
  type IProjectRepository,
  type IQuota,
  type ProjectRecord,
} from '../../ports/index.js';
import { projectKeys, toDesignProject, toListItem } from './project.mapper.js';
import { newRoomFor } from './room-factory.js';

export interface Actor {
  userId: string;
  requestId?: string | undefined;
}

/** Una preview "pending" más vieja que esto se considera colgada y se puede volver a pedir. */
export const STALE_PENDING_MS = 15 * 60_000;

const revisionGuard = (revision?: number) => (revision === undefined ? {} : { expectedRevision: revision });

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
  ) {}

  // ------------------------------------------------------------------ lectura
  async list(actor: Actor): Promise<ProjectListItem[]> {
    const rows = await this.projects.listByOwner(actor.userId);
    return rows.map((p) => toListItem(p, this.signer));
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
    const shell = this.requireShell(project);
    const placements = await this.sanitizePlacements(shell, req.furniturePlacements);
    if (req.finishes) this.validateFinishes(req.finishes);
    const updated = await this.projects.update(
      id,
      {
        placements,
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
    const shell = this.requireShell(project);
    let next: RoomShell;
    try {
      next = resizeRoomShell(shell, { widthM: req.widthM, depthM: req.depthM, heightM: req.heightM }, req.openings);
    } catch (err) {
      if (err instanceof RoomGeometryError) throw new ValidationError(err.message);
      throw err;
    }
    const placements = await this.sanitizePlacements(next, project.placements);
    const updated = await this.projects.update(
      id,
      { roomShell: next, placements },
      { expectedRevision: req.revision, bumpRevision: true },
    );
    return this.toDto(updated);
  }

  async calibrate(actor: Actor, id: string, req: CalibrateRequest): Promise<DesignProject> {
    const project = await this.own(actor, id);
    const shell = this.requireShell(project);
    let result: { shell: RoomShell; factor: number };
    try {
      result = calibrateRoomShell(shell, req.reference, req.valueM);
    } catch (err) {
      if (err instanceof CalibrationError) throw new ValidationError(err.message);
      throw err;
    }
    const placements = await this.sanitizePlacements(result.shell, scalePlacements(project.placements, result.factor));
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

  // ------------------------------------------------------------------ versiones (paso 7)
  async saveVersion(actor: Actor, id: string, note?: string): Promise<DesignProject> {
    await this.own(actor, id);
    await this.projects.addVersion(id, note?.trim() || null);
    return this.get(actor, id);
  }

  async restoreVersion(actor: Actor, id: string, versionId: string, revision?: number): Promise<DesignProject> {
    await this.own(actor, id);
    const version = await this.projects.getVersion(id, versionId);
    if (!version) throw new NotFoundError('La versión no existe');
    const updated = await this.projects.update(
      id,
      {
        roomShell: version.roomShell,
        placements: version.placements,
        finishes: version.finishes,
        selectedStyleId: version.selectedStyleId,
      },
      { ...revisionGuard(revision), bumpRevision: true },
    );
    return this.toDto(updated);
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
    this.requireShell(project);
    const styleId = req.styleId === undefined ? project.selectedStyleId : req.styleId;
    const jobId = await this.queue.enqueue('build-scene', `scene.${id}`, {
      projectId: id,
      styleId,
      keepLocked: req.keepLocked ?? true,
      ...(actor.requestId ? { requestId: actor.requestId } : {}),
    });
    await this.publishQueued(id, jobId, 'build-scene');
    return { jobId, projectId: id };
  }

  // ------------------------------------------------------------------ compartir
  async share(actor: Actor, id: string): Promise<ShareLink> {
    await this.own(actor, id);
    const token = randomBytes(24).toString('base64url');
    // Atómico: revoca los anteriores, crea el nuevo y marca el proyecto como guardado.
    await this.projects.replaceShareLink(id, token);
    return { token, path: `/p/${token}` };
  }

  async unshare(actor: Actor, id: string): Promise<void> {
    await this.own(actor, id);
    await this.projects.revokeShareLinks(id);
  }

  // ------------------------------------------------------------------ lista de compras
  async shoppingList(actor: Actor, id: string): Promise<ShoppingList> {
    return this.buildShoppingList(await this.own(actor, id));
  }

  async buildShoppingList(project: ProjectRecord): Promise<ShoppingList> {
    const items = new Map((await this.catalog.findByIds(project.placements.map((p) => p.catalogItemId))).map((i) => [i.id, i]));
    // Una línea por producto Y variante: un sofá de catálogo y otro a medida en cuero son distintos.
    const groups = new Map<string, { itemId: string; variant: string | null; quantity: number }>();
    for (const p of project.placements) {
      const item = items.get(p.catalogItemId);
      if (!item) continue;
      const variant = describeVariant(
        { dimensionsM: { x: item.widthM, y: item.heightM, z: item.depthM }, materialSlots: item.spec?.materialSlots },
        p,
      );
      const key = `${p.catalogItemId}|${variant ?? ''}`;
      const g = groups.get(key) ?? { itemId: p.catalogItemId, variant, quantity: 0 };
      g.quantity++;
      groups.set(key, g);
    }

    const lines = [...groups.values()].flatMap(({ itemId, variant, quantity }) => {
      const item = items.get(itemId);
      if (!item) return [];
      return [
        {
          catalogItemId: item.id,
          name: item.name,
          variant,
          category: item.category,
          quantity,
          unitPrice: item.price,
          subtotal: item.price === null ? null : Math.round(item.price * quantity * 100) / 100,
          currency: item.currency,
          productUrl: item.productUrl,
          license: item.license,
          attribution: item.attribution,
        },
      ];
    });
    lines.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name) || (a.variant ?? '').localeCompare(b.variant ?? ''));
    const total = Math.round(lines.reduce((acc, l) => acc + (l.subtotal ?? 0), 0) * 100) / 100;
    return { projectId: project.id, projectName: project.name, lines, total, currency: lines[0]?.currency ?? 'USD' };
  }

  // ------------------------------------------------------------------ helpers
  async own(actor: Actor, id: string): Promise<ProjectRecord> {
    const project = await this.projects.findById(id);
    if (!project || project.ownerId !== actor.userId) throw new NotFoundError('El proyecto no existe');
    return project;
  }

  async toDto(project: ProjectRecord): Promise<DesignProject> {
    const [previews, versions, shared] = await Promise.all([
      this.projects.listPreviews(project.id),
      this.projects.listVersions(project.id),
      this.projects.hasActiveShareLink(project.id),
    ]);
    return toDesignProject(project, previews, versions, shared, this.signer);
  }

  private requireShell(project: ProjectRecord): RoomShell {
    if (!project.roomShell) throw new ValidationError('El cuarto aún se está analizando');
    return project.roomShell;
  }

  private validateFinishes(finishes: RoomFinishes): void {
    try {
      assertValidFinishes(finishes);
    } catch (err) {
      if (err instanceof UnknownMaterialError) throw new ValidationError(err.message);
      throw err;
    }
  }

  /**
   * Defensa en profundidad: aunque el editor ya evita salirse del cuarto, el servidor
   * valida que el catálogo exista, acota las medidas propias a los rangos del catálogo, fija la
   * altura según el montaje (piso, techo, pared o sobre otro mueble) y mete dentro del cuarto
   * cualquier mueble fuera de límites.
   */
  private async sanitizePlacements(shell: RoomShell, placements: FurniturePlacement[]): Promise<FurniturePlacement[]> {
    const ids = new Set<string>();
    for (const p of placements) {
      if (ids.has(p.id)) throw new ValidationError(`Id de mueble repetido: ${p.id}`);
      ids.add(p.id);
    }
    const catalog = new Map<string, CatalogRecord>(
      (await this.catalog.findByIds(placements.map((p) => p.catalogItemId))).map((i) => [i.id, i]),
    );
    const unknown = placements.filter((p) => !catalog.has(p.catalogItemId)).map((p) => p.catalogItemId);
    if (unknown.length) throw new ValidationError(`Muebles inexistentes en el catálogo: ${[...new Set(unknown)].join(', ')}`);

    const itemOf = (p: FurniturePlacement) => catalog.get(p.catalogItemId)!;
    const catalogDims = (p: FurniturePlacement): Vector3 => {
      const item = itemOf(p);
      return { x: item.widthM, y: item.heightM, z: item.depthM };
    };
    const twoPi = Math.PI * 2;
    const wallIds = new Set(shell.walls.map((w) => w.id));

    // 1) Medidas, rotación y referencias (no dependen de los demás muebles).
    const sized = placements.map((p): FurniturePlacement => {
      const item = itemOf(p);
      const base = catalogDims(p);
      const { dimensionsM, supportId, wallId, elevationM, ...rest } = p;
      const isWall = item.mount === 'wall';
      return {
        ...rest,
        rotationY: ((p.rotationY % twoPi) + twoPi) % twoPi,
        ...(dimensionsM ? { dimensionsM: clampDimensions(dimensionsM, base, item.spec?.resize ?? defaultResizeRanges(base)) } : {}),
        // Un soporte inexistente (o el propio mueble) no sirve: el objeto cae al piso.
        ...(item.mount === 'surface' && supportId && supportId !== p.id && ids.has(supportId) ? { supportId } : {}),
        ...(isWall && wallId && wallIds.has(wallId) ? { wallId } : {}),
        ...(isWall && elevationM !== undefined ? { elevationM } : {}),
      };
    });

    // 2) Posición y altura: lo que va sobre una superficie necesita el tope de su soporte.
    const byId = new Map(sized.map((p) => [p.id, p]));
    const baseY = (p: FurniturePlacement): number => {
      const item = itemOf(p);
      // Un soporte que a su vez está sobre otro conserva su altura declarada (sin recursión).
      if (item.mount === 'surface') return Math.max(0, p.position.y);
      return mountY(item.mount, effectiveDimensions(catalogDims(p), p), shell, {
        elevationM: p.elevationM,
        elevationDefaultM: item.spec?.elevationDefaultM,
      });
    };
    return sized.map((p) => {
      const item = itemOf(p);
      const dims = effectiveDimensions(catalogDims(p), p);
      const clamped = clampToRoom(p.position, dims, p.rotationY, shell);
      const support = p.supportId ? byId.get(p.supportId) : undefined;
      const supportTopY = support ? baseY(support) + effectiveDimensions(catalogDims(support), support).y : undefined;
      const y = mountY(item.mount, dims, shell, {
        elevationM: p.elevationM,
        elevationDefaultM: item.spec?.elevationDefaultM,
        supportTopY,
      });
      return { ...p, position: { ...clamped, y } };
    });
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
