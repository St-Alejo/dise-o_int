import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { JobKind } from '@interiores/shared-types';
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { DependencyError } from '../../common/errors.js';
import { REDIS, type IJobQueue, type JobPayloads } from '../../ports/index.js';

export const AI_QUEUE = 'ai-jobs';

/** Opciones por tipo de job: reintentos con backoff exponencial y retención acotada. */
export const JOB_OPTIONS: Record<JobKind, JobsOptions> = {
  'analyze-room': { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
  'generate-styles': { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
  'build-scene': { attempts: 2, backoff: { type: 'exponential', delay: 1000 } },
};

const RETENTION: JobsOptions = {
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 1000 },
};

@Injectable()
export class BullMqJobQueue implements IJobQueue, OnModuleDestroy {
  private readonly queue: Queue;
  private readonly connection: Redis;

  constructor(@Inject(REDIS) redis: Redis) {
    this.connection = redis.duplicate();
    this.queue = new Queue(AI_QUEUE, { connection: this.connection });
  }

  async enqueue<K extends JobKind>(kind: K, jobId: string, data: JobPayloads[K]): Promise<string> {
    try {
      return await this.add(kind, jobId, data);
    } catch (err) {
      // Cualquier fallo hablando con Redis es una dependencia caída (503), no un error del cliente.
      throw Object.assign(new DependencyError('No se pudo encolar el trabajo; intenta de nuevo en unos segundos'), { cause: err });
    }
  }

  private async add<K extends JobKind>(kind: K, jobId: string, data: JobPayloads[K]): Promise<string> {
    // Idempotencia: si ya existe un job vivo con ese id, no se duplica. Si terminó
    // (completado o fallido) se elimina para permitir relanzarlo.
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed' && state !== 'unknown') return jobId;
      await existing.remove().catch(() => undefined);
    }
    const job = await this.queue.add(kind, data, { ...JOB_OPTIONS[kind], ...RETENTION, jobId });
    return job.id ?? jobId;
  }

  async ping(): Promise<void> {
    await this.connection.ping();
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
