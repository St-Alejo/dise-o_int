import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  BlenderJobSchema,
  RENDER_NODE_HEARTBEAT_KEY,
  RENDER_QUEUE,
  RenderNodeHeartbeatSchema,
  renderCancelKey,
  type BlenderJob,
  type RenderNodeStatus,
} from '@interiores/shared-types';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DependencyError } from '../../common/errors.js';
import { REDIS, type IRenderJobQueue, type RenderJobInfo, type RenderJobState } from '../../ports/index.js';
import { JOB_OPTIONS, RETENTION } from './bullmq-job-queue.js';

/** Lo que dura la marca de cancelación: de sobra para el render más largo. */
const CANCEL_TTL_SECONDS = 3600;

/**
 * Cola `render-jobs` del nodo Blender (ADR-0036). Solo encola y consulta: quien renderiza es el
 * worker de Python del nodo, y quien escucha los resultados es RenderJobsListener.
 */
@Injectable()
export class BullMqRenderJobQueue implements IRenderJobQueue, OnModuleDestroy {
  private readonly queue: Queue;
  private readonly connection: Redis;

  constructor(@Inject(REDIS) redis: Redis) {
    this.connection = redis.duplicate();
    this.queue = new Queue(RENDER_QUEUE, { connection: this.connection });
  }

  async enqueue(job: BlenderJob): Promise<void> {
    try {
      await this.queue.add('blender-render', job, { ...JOB_OPTIONS['blender-render'], ...RETENTION, jobId: job.renderId });
    } catch (err) {
      throw Object.assign(new DependencyError('No se pudo encolar el render; intenta de nuevo en unos segundos'), { cause: err });
    }
  }

  async node(): Promise<RenderNodeStatus> {
    const raw = await this.connection.get(RENDER_NODE_HEARTBEAT_KEY).catch(() => null);
    if (!raw) return { available: false, device: null };
    let beat: unknown = null;
    try {
      beat = JSON.parse(raw);
    } catch {
      // Un latido ilegible sigue diciendo que el nodo está vivo.
    }
    const parsed = RenderNodeHeartbeatSchema.safeParse(beat);
    return { available: true, device: parsed.success ? parsed.data.device : null };
  }

  async info(renderId: string): Promise<RenderJobInfo> {
    const job = await this.queue.getJob(renderId);
    if (!job) return { state: 'missing', job: null };
    const raw = await job.getState();
    // Un reintento programado (delayed) o en espera cuenta como "aún en cola".
    const state: RenderJobState = raw === 'completed' || raw === 'failed' || raw === 'active' ? raw : raw === 'unknown' ? 'missing' : 'waiting';
    const data = BlenderJobSchema.safeParse(job.data);
    return {
      state,
      job: data.success ? data.data : null,
      result: job.returnvalue as unknown,
      ...(job.failedReason ? { error: job.failedReason } : {}),
    };
  }

  async cancel(renderId: string): Promise<void> {
    const job = await this.queue.getJob(renderId);
    if (!job) return;
    const state = await job.getState();
    if (state === 'active') {
      // Un trabajo activo está bloqueado por el nodo: se le avisa y él corta Blender.
      await this.connection.set(renderCancelKey(renderId), '1', 'EX', CANCEL_TTL_SECONDS);
      return;
    }
    await job.remove().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
