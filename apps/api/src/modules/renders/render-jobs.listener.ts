import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { BlenderResultSchema, RENDER_QUEUE, STAGE_MESSAGES, type JobProgressEvent } from '@interiores/shared-types';
import { QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  BLENDER_QUOTA,
  FILE_STORAGE,
  PROGRESS_BROKER,
  REDIS,
  RENDER_JOB_QUEUE,
  RENDER_REPOSITORY,
  type IFileStorage,
  type IProgressBroker,
  type IQuota,
  type IRenderJobQueue,
  type IRenderRepository,
} from '../../ports/index.js';
import { projectKeys } from '../projects/project.mapper.js';
import { CYCLES_PROVIDER } from './renders.service.js';

type Outcome = Pick<JobProgressEvent, 'stage' | 'pct' | 'status' | 'message'> & { error?: string };

/** Traduce el motivo técnico del nodo a algo que la persona pueda entender. */
export function friendlyRenderError(reason: string | undefined): string {
  const r = (reason ?? '').toLowerCase();
  if (r.includes('cancel')) return 'Render cancelado';
  if (r.includes('out of memory') || r.includes('cuda error')) return 'La GPU se quedó sin memoria: prueba con menos resolución o calidad.';
  if (r.includes('timeout') || r.includes('stalled')) return 'El render tardó demasiado y se detuvo. Vuelve a intentarlo.';
  return 'Blender no pudo terminar el render. Vuelve a intentarlo.';
}

/**
 * Escucha la cola del nodo Blender desde el proceso worker (ADR-0036). La API es la única que
 * escribe en la base: el nodo solo deja archivos en S3 y su resultado en la cola, y aquí se pasa
 * el render a listo o fallido y se avisa a la web por el broker de progreso.
 */
@Injectable()
export class RenderJobsListener implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RenderJobsListener.name);
  private events: QueueEvents | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(RENDER_JOB_QUEUE) private readonly queue: IRenderJobQueue,
    @Inject(RENDER_REPOSITORY) private readonly renders: IRenderRepository,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    @Inject(PROGRESS_BROKER) private readonly broker: IProgressBroker,
    @Inject(BLENDER_QUOTA) private readonly quota: IQuota,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const events = new QueueEvents(RENDER_QUEUE, { connection: this.redis.duplicate() });
    events.on('progress', ({ jobId, data }) => void this.guard(this.progress(jobId, data)));
    events.on('completed', ({ jobId }) => void this.guard(this.settle(jobId)));
    events.on('failed', ({ jobId }) => void this.guard(this.settle(jobId)));
    events.on('error', (err) => this.logger.error({ err }, 'Error escuchando la cola de render'));
    this.events = events;
    await this.guard(this.reconcile());
    this.logger.log(`Escuchando la cola "${RENDER_QUEUE}" del nodo Blender`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.events?.close();
  }

  /** Avance del nodo: un número 0–100 (lo que reporta Blender al muestrear). */
  async progress(renderId: string, data: unknown): Promise<void> {
    const pct = typeof data === 'number' ? data : Number((data as { pct?: unknown } | null)?.pct);
    if (!Number.isFinite(pct)) return;
    const { job } = await this.queue.info(renderId);
    if (!job) return;
    await this.publish(renderId, job.projectId, {
      stage: 'rendering',
      pct: Math.min(99, Math.max(0, Math.round(pct))),
      status: 'active',
      message: STAGE_MESSAGES.rendering,
    });
  }

  /** Cierra un render según cómo terminó su trabajo. Idempotente: un render ya cerrado no cambia. */
  async settle(renderId: string): Promise<void> {
    const info = await this.queue.info(renderId);
    if (!info.job || (info.state !== 'completed' && info.state !== 'failed')) return;
    const { job } = info;
    const render = await this.renders.findById(job.projectId, renderId);
    if (!render) {
      // Lo borraron mientras se renderizaba: lo que el nodo subió después ya no tiene dueño.
      await this.storage.deletePrefix(projectKeys.render(job.projectId, renderId, ''));
      return;
    }
    if (render.status !== 'pending') return;

    if (info.state === 'completed') {
      const result = BlenderResultSchema.safeParse(info.result);
      // La clave tiene que ser la del propio render: nunca se firma lo que el nodo diga sin más.
      if (result.success && result.data.previewKey.startsWith(`${job.outputPrefix}.`)) {
        await this.renders.update(renderId, { status: 'ready', fileKey: result.data.previewKey, mediaType: 'image/jpeg' });
        this.logger.log({ renderId, seconds: result.data.seconds, device: result.data.device }, 'Render en Blender listo');
        await this.publish(renderId, job.projectId, { stage: 'done', pct: 100, status: 'completed', message: STAGE_MESSAGES.done });
        return;
      }
      this.logger.error({ renderId, result: info.result }, 'El nodo Blender devolvió un resultado inválido');
    }

    const error = info.state === 'failed' ? friendlyRenderError(info.error) : 'El nodo Blender devolvió un resultado inválido.';
    await this.renders.update(renderId, { status: 'failed', error });
    await this.quota.refund(job.userId, 1).catch(() => undefined);
    this.logger.warn({ renderId, reason: info.error }, 'Render en Blender fallido');
    await this.publish(renderId, job.projectId, { stage: 'rendering', pct: 100, status: 'failed', message: error, error });
  }

  /**
   * Al arrancar: los renders que quedaron pendientes mientras el worker estaba apagado se cierran
   * con lo que diga la cola; los que ya no están en ella se perdieron (Redis se vació).
   */
  async reconcile(): Promise<void> {
    for (const render of await this.renders.listPending(CYCLES_PROVIDER)) {
      const { state } = await this.queue.info(render.id);
      if (state === 'completed' || state === 'failed') {
        await this.settle(render.id);
      } else if (state === 'missing') {
        await this.renders.update(render.id, { status: 'failed', error: 'El render se perdió al reiniciarse el servidor. Vuelve a pedirlo.' });
      }
    }
  }

  private async publish(renderId: string, projectId: string, outcome: Outcome): Promise<void> {
    await this.broker.publish({ jobId: renderId, projectId, kind: 'blender-render', ...outcome, at: new Date().toISOString() });
  }

  private async guard(work: Promise<void>): Promise<void> {
    try {
      await work;
    } catch (err) {
      this.logger.error({ err }, 'Error procesando un evento del nodo Blender');
    }
  }
}
