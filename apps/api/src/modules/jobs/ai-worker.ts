import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { JobKind } from '@interiores/shared-types';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import { AiServiceError } from '../../infrastructure/ai/http-ai-client.js';
import { AI_QUEUE } from '../../infrastructure/queue/bullmq-job-queue.js';
import { APP_CONFIG, PROJECT_REPOSITORY, REDIS, type IProjectRepository, type JobPayloads } from '../../ports/index.js';
import { PipelineService, type JobContext } from './pipeline.service.js';

type AnyData = JobPayloads[JobKind] & { requestId?: string };
type AnyJob = Job<AnyData, void, JobKind>;

/**
 * Consumidor BullMQ de la cola de IA. Cada job se audita (inicio/fin/duración/intentos),
 * los fallos transitorios se reintentan con backoff y los definitivos marcan el proyecto
 * con un mensaje entendible para el usuario.
 */
@Injectable()
export class AiWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AiWorker.name);
  private worker: Worker<AnyData, void, JobKind> | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROJECT_REPOSITORY) private readonly projects: IProjectRepository,
    private readonly pipeline: PipelineService,
  ) {}

  get running(): boolean {
    return this.worker?.isRunning() ?? false;
  }

  onApplicationBootstrap(): void {
    const worker = new Worker<AnyData, void, JobKind>(AI_QUEUE, (job, _token, signal) => this.process(job, signal), {
      connection: this.redis.duplicate(),
      concurrency: this.config.WORKER_CONCURRENCY,
      lockDuration: 120_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    });
    worker.on('failed', (job, err) => void this.onFailed(job, err));
    worker.on('error', (err) => this.logger.error({ err }, 'Error del worker BullMQ'));
    this.worker = worker;
    this.logger.log(`Worker de IA escuchando la cola "${AI_QUEUE}" (concurrencia ${this.config.WORKER_CONCURRENCY})`);
  }

  async onApplicationShutdown(): Promise<void> {
    // close() espera a que terminen los jobs en curso (graceful shutdown).
    await this.worker?.close();
  }

  private ctx(job: AnyJob, signal?: AbortSignal): JobContext {
    const attempts = job.opts.attempts ?? 1;
    return {
      jobId: job.id ?? 'unknown',
      kind: job.name,
      requestId: job.data.requestId,
      isFinalAttempt: job.attemptsMade + 1 >= attempts,
      ...(signal ? { signal } : {}),
    };
  }

  private async process(job: AnyJob, signal?: AbortSignal): Promise<void> {
    const ctx = this.ctx(job, signal);
    const started = Date.now();
    const log = { jobId: ctx.jobId, kind: job.name, projectId: job.data.projectId, requestId: ctx.requestId, attempt: job.attemptsMade + 1 };
    this.logger.log(log, 'Job iniciado');
    await this.projects
      .auditJob({ projectId: job.data.projectId, jobId: ctx.jobId, kind: job.name, status: 'started', attempts: job.attemptsMade + 1, ...(ctx.requestId ? { requestId: ctx.requestId } : {}) })
      .catch(() => undefined);
    try {
      switch (job.name) {
        case 'analyze-room':
          await this.pipeline.analyzeRoom(job.data as JobPayloads['analyze-room'], ctx);
          break;
        case 'generate-styles':
          await this.pipeline.generateStyles(job.data as JobPayloads['generate-styles'], ctx);
          break;
        case 'build-scene':
          await this.pipeline.buildScene(job.data as JobPayloads['build-scene'], ctx);
          break;
        default:
          throw new UnrecoverableError(`Tipo de job desconocido: ${String(job.name)}`);
      }
      const durationMs = Date.now() - started;
      this.logger.log({ ...log, durationMs }, 'Job completado');
      await this.projects
        .auditJob({ projectId: job.data.projectId, jobId: ctx.jobId, kind: job.name, status: 'completed', attempts: job.attemptsMade + 1, durationMs })
        .catch(() => undefined);
    } catch (err) {
      // Errores que reintentar no arregla (entrada inválida) saltan los reintentos.
      if (err instanceof AiServiceError && !err.retryable) throw new UnrecoverableError(err.message);
      throw err;
    }
  }

  private async onFailed(job: AnyJob | undefined, err: Error): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    const final = err instanceof UnrecoverableError || err.name === 'UnrecoverableError' || job.attemptsMade >= attempts;
    const ctx: JobContext = { jobId: job.id ?? 'unknown', kind: job.name, requestId: job.data.requestId, isFinalAttempt: final };
    this.logger.warn({ jobId: ctx.jobId, kind: job.name, projectId: job.data.projectId, attemptsMade: job.attemptsMade, final, err: err.message }, 'Job fallido');
    if (final) {
      await this.pipeline.markFailed(job.name, job.data.projectId, ctx, err.message);
      await this.projects
        .auditJob({ projectId: job.data.projectId, jobId: ctx.jobId, kind: job.name, status: 'failed', attempts: job.attemptsMade, error: err.message })
        .catch(() => undefined);
    } else {
      await this.pipeline.reportRetry(job.data.projectId, ctx, job.attemptsMade);
    }
  }
}
