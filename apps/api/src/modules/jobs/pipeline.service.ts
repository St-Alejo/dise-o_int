import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  STAGE_MESSAGES,
  STYLES,
  resizeRoomShell,
  type FurniturePlacement,
  type JobKind,
  type JobProgressEvent,
  type LayoutCandidate,
  type ProgressStage,
  type RoomShell,
  type StyleId,
} from '@interiores/shared-types';
import { StaleRevisionError, findAiFailure } from '../../common/errors.js';
import {
  AI_CLIENT,
  CATALOG_REPOSITORY,
  PROGRESS_BROKER,
  PROJECT_REPOSITORY,
  QUOTA,
  type AnalyzeRoomJob,
  type BuildSceneJob,
  type GenerateStylesJob,
  type IAiClient,
  type ICatalogRepository,
  type IProgressBroker,
  type IProjectRepository,
  type IQuota,
  type PreviewRecord,
  type ProjectRecord,
} from '../../ports/index.js';
import { projectKeys } from '../projects/project.mapper.js';
import { previewCacheKey } from '../projects/projects.service.js';

/** Contexto de ejecución de un job: permite reportar progreso real y saber si es el último intento. */
export interface JobContext {
  jobId: string;
  kind: JobKind;
  requestId?: string | undefined;
  isFinalAttempt: boolean;
  signal?: AbortSignal;
}

/**
 * Orquesta el pipeline de IA (sección 6 del documento): Room Understanding → Track A
 * (previews de estilo) → Track B (colocación de muebles). Independiente de BullMQ para
 * poder probarlo con dobles de prueba.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: IProjectRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: ICatalogRepository,
    @Inject(AI_CLIENT) private readonly ai: IAiClient,
    @Inject(PROGRESS_BROKER) private readonly progress: IProgressBroker,
    @Inject(QUOTA) private readonly quota: IQuota,
  ) {}

  /** Intentos de escribir la escena si el usuario la editó mientras se calculaba. */
  static readonly LAYOUT_WRITE_ATTEMPTS = 3;

  // ---------------------------------------------------------------- analyze-room (pipeline completo)
  async analyzeRoom(data: AnalyzeRoomJob, ctx: JobContext): Promise<void> {
    const project = await this.projects.findById(data.projectId);
    if (!project?.photoKey) return; // borrado mientras estaba en cola: nada que hacer
    await this.projects.update(project.id, { status: 'processing', lastError: null });

    await this.report(project.id, ctx, 'geometry', 5);
    const analysis = await this.ai.analyzeRoom({ photoKey: project.photoKey, roomType: project.roomType }, this.aiCtx(ctx));
    const doors = analysis.roomShell.openings.filter((o) => o.type === 'door').length;
    const windows = analysis.roomShell.openings.length - doors;
    await this.report(
      project.id,
      ctx,
      'surfaces',
      35,
      `Detectamos ${analysis.roomShell.walls.length} paredes, ${doors} puerta(s), ${windows} ventana(s) y ${analysis.detectedObjects.length} objeto(s)`,
    );
    const fresh = await this.projects.findById(project.id);
    if (!fresh) return; // borrado mientras se analizaba
    await this.projects.update(
      project.id,
      { roomShell: this.withRequestedRoom(analysis.roomShell, fresh) },
      { expectedRevision: fresh.revision, bumpRevision: true },
    );

    // Track A — nunca una sola opción: se generan todos los estilos pedidos.
    const previews = await this.ensurePreviews(project, data.styles, data.promptStrength);
    await this.generatePreviews(project, previews, ctx, 40, 80, { failSoft: true });

    // Track B — escena inicial con el primer estilo que salió bien.
    const ready = (await this.projects.listPreviews(project.id)).filter((p) => p.status === 'ready');
    const selected: StyleId | null = ready.find((p) => data.styles.includes(p.styleId))?.styleId ?? data.styles[0] ?? null;
    await this.report(project.id, ctx, 'scene', 85);
    await this.writeLayout(project.id, selected, true, { status: 'ready', lastError: null }, ctx);
    await this.report(project.id, ctx, 'done', 100, undefined, 'completed');
  }

  // ---------------------------------------------------------------- generate-styles
  async generateStyles(data: GenerateStylesJob, ctx: JobContext): Promise<void> {
    const project = await this.projects.findById(data.projectId);
    if (!project) return;
    const pending = (await this.projects.listPreviews(project.id)).filter(
      (p) => data.previewIds.includes(p.id) && p.status === 'pending',
    );
    await this.generatePreviews(project, pending, ctx, 5, 95, { failSoft: false });
    await this.report(project.id, ctx, 'done', 100, undefined, 'completed');
  }

  // ---------------------------------------------------------------- build-scene
  async buildScene(data: BuildSceneJob, ctx: JobContext): Promise<void> {
    const project = await this.projects.findById(data.projectId);
    if (!project?.roomShell) return;
    await this.report(project.id, ctx, 'scene', 20);
    await this.writeLayout(project.id, data.styleId, data.keepLocked, {}, ctx);
    await this.report(project.id, ctx, 'done', 100, undefined, 'completed');
  }

  /**
   * Calcula y guarda la distribución con bloqueo optimista: si el usuario guardó la escena
   * mientras la IA trabajaba, se vuelve a leer el proyecto (respetando sus muebles fijados)
   * en lugar de pisar su cambio.
   */
  private async writeLayout(
    projectId: string,
    styleId: StyleId | null,
    keepLocked: boolean,
    extra: { status?: 'ready'; lastError?: null },
    ctx: JobContext,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const project = await this.projects.findById(projectId);
      if (!project?.roomShell) return; // borrado mientras se calculaba
      const locked = keepLocked ? project.placements.filter((p) => p.lockedByUser) : [];
      const placements = await this.layout(project, project.roomShell, styleId, locked, ctx);
      try {
        await this.projects.update(
          projectId,
          { placements, selectedStyleId: styleId, ...extra },
          { expectedRevision: project.revision, bumpRevision: true },
        );
        return;
      } catch (err) {
        if (!(err instanceof StaleRevisionError) || attempt >= PipelineService.LAYOUT_WRITE_ATTEMPTS) throw err;
        this.logger.warn({ projectId, attempt, jobId: ctx.jobId }, 'La escena cambió durante el layout; se recalcula');
      }
    }
  }

  // ---------------------------------------------------------------- fallos definitivos
  async markFailed(kind: JobKind, projectId: string, ctx: JobContext, error: unknown): Promise<void> {
    const friendly = this.friendlyError(error);
    if (kind === 'analyze-room') {
      await this.projects.update(projectId, { status: 'failed', lastError: friendly }).catch(() => undefined);
    }
    if (kind === 'generate-styles' || kind === 'analyze-room') {
      const project = await this.projects.findById(projectId).catch(() => null);
      const previews = await this.projects.listPreviews(projectId).catch(() => [] as PreviewRecord[]);
      const results = await Promise.all(
        previews
          .filter((p) => p.status === 'pending')
          .map((p) =>
            this.projects
              .updatePreview(p.id, { status: 'failed', error: friendly })
              .then(() => true)
              .catch(() => false),
          ),
      );
      // Cada preview pendiente consumió una generación de la cuota: si no se produjo, se devuelve.
      if (project) await this.refund(project.ownerId, results.filter(Boolean).length);
    }
    await this.report(projectId, ctx, 'done', 100, friendly, 'failed', friendly);
  }

  async reportRetry(projectId: string, ctx: JobContext, attempt: number): Promise<void> {
    await this.report(projectId, ctx, 'queued', 0, `Hubo un problema temporal; reintentando (intento ${attempt + 1})…`);
  }

  // ---------------------------------------------------------------- helpers
  private async ensurePreviews(project: ProjectRecord, styles: StyleId[], strength: number): Promise<PreviewRecord[]> {
    const out: PreviewRecord[] = [];
    for (const styleId of styles) {
      const cacheKey = previewCacheKey(project.photoHash ?? project.id, styleId, strength);
      // En un reintento del job, las previews ya creadas se reutilizan.
      const existing = await this.projects.findPreviewByCacheKey(project.id, cacheKey);
      out.push(
        existing ??
          (await this.projects.createPreview({
            projectId: project.id,
            styleId,
            promptStrength: strength,
            status: 'pending',
            imageKey: null,
            cacheKey,
            provider: null,
          })),
      );
    }
    return out;
  }

  private async generatePreviews(
    project: ProjectRecord,
    previews: PreviewRecord[],
    ctx: JobContext,
    fromPct: number,
    toPct: number,
    opts: { failSoft: boolean },
  ): Promise<void> {
    const pending = previews.filter((p) => p.status === 'pending');
    let lastError: unknown = null;
    for (const [i, preview] of pending.entries()) {
      const pct = fromPct + ((toPct - fromPct) * i) / Math.max(pending.length, 1);
      await this.report(
        project.id,
        ctx,
        'styles',
        pct,
        `Generando propuesta ${STYLES[preview.styleId].label} (${i + 1}/${pending.length})…`,
      );
      try {
        const res = await this.ai.generateStyle(
          {
            photoKey: project.photoKey!,
            outputKey: projectKeys.preview(project.id, preview.id),
            styleId: preview.styleId,
            roomType: project.roomType,
            promptStrength: preview.promptStrength,
          },
          this.aiCtx(ctx),
        );
        await this.projects.updatePreview(preview.id, { status: 'ready', imageKey: res.imageKey, provider: res.provider });
      } catch (err) {
        lastError = err;
        this.logger.warn({ err, previewId: preview.id, jobId: ctx.jobId }, 'Falló la generación de un estilo');
        // failSoft: un estilo que falla no tumba el pipeline (Track B sigue); en el job
        // dedicado se reintenta todo el job mientras queden intentos.
        if (opts.failSoft || ctx.isFinalAttempt) {
          await this.projects.updatePreview(preview.id, { status: 'failed', error: this.friendlyError(err) });
          await this.refund(project.ownerId, 1);
        }
      }
    }
    if (!opts.failSoft && lastError && !ctx.isFinalAttempt) throw lastError;
  }

  private async layout(
    project: ProjectRecord,
    shell: RoomShell,
    styleId: StyleId | null,
    locked: FurniturePlacement[],
    ctx: JobContext,
  ): Promise<FurniturePlacement[]> {
    const catalog = await this.catalog.search({ roomType: project.roomType });
    const candidates: LayoutCandidate[] = catalog.map((c) => ({
      id: c.id,
      category: c.category,
      ...(c.subcategory ? { subcategory: c.subcategory } : {}),
      styleTags: c.styleTags,
      dimensionsM: { x: c.widthM, y: c.heightM, z: c.depthM },
      mount: c.mount,
      ...(c.price !== null ? { price: c.price } : {}),
    }));
    if (candidates.length === 0) {
      this.logger.warn({ projectId: project.id }, 'Catálogo vacío: la escena queda sin muebles (¿se ejecutó el seed?)');
      return locked;
    }
    const res = await this.ai.placeFurniture(
      { roomShell: shell, roomType: project.roomType, styleId, candidates, locked },
      this.aiCtx(ctx),
    );
    const lockedIds = new Set(locked.map((p) => p.id));
    return [...locked, ...res.placements.filter((p) => !lockedIds.has(p.id))];
  }

  /**
   * Las medidas que escribió el usuario son exactas y mandan sobre la estimación de la foto: se
   * conserva lo detectado (puertas, ventanas y su posición relativa) con el tamaño real.
   */
  private withRequestedRoom(estimated: RoomShell, project: ProjectRecord): RoomShell {
    if (!project.requestedRoom) return estimated;
    try {
      return resizeRoomShell(estimated, project.requestedRoom);
    } catch (err) {
      this.logger.warn({ err, projectId: project.id }, 'No se pudieron aplicar las medidas del usuario; se usa la estimación');
      return estimated;
    }
  }

  private aiCtx(ctx: JobContext) {
    return { ...(ctx.requestId ? { requestId: ctx.requestId } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}) };
  }

  private async refund(userId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.quota
      .refund(userId, amount)
      .catch((err) => this.logger.warn({ err, userId, amount }, 'No se pudo reembolsar la cuota'));
  }

  /** Mensaje para el usuario según el TIPO de fallo (no según el texto del error). */
  friendlyError(error: unknown): string {
    switch (findAiFailure(error)?.kind) {
      case 'timeout':
        return 'El servicio de IA tardó demasiado. Intenta de nuevo.';
      case 'unreachable':
        return 'El servicio de IA no está disponible en este momento.';
      case 'rejected':
        return 'No pudimos interpretar la foto. Prueba con una foto de frente y bien iluminada.';
      default:
        return 'Ocurrió un error procesando tu cuarto. Intenta de nuevo.';
    }
  }

  private async report(
    projectId: string,
    ctx: JobContext,
    stage: ProgressStage,
    pct: number,
    message?: string,
    status: JobProgressEvent['status'] = 'active',
    error?: string,
  ): Promise<void> {
    const event: JobProgressEvent = {
      jobId: ctx.jobId,
      projectId,
      kind: ctx.kind,
      stage,
      pct: Math.round(Math.min(100, Math.max(0, pct))),
      message: message ?? STAGE_MESSAGES[stage],
      status,
      ...(error ? { error } : {}),
      at: new Date().toISOString(),
    };
    await this.progress.publish(event).catch((err) => this.logger.warn({ err }, 'No se pudo publicar progreso'));
  }
}
