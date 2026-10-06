import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import {
  APP_CONFIG,
  FILE_STORAGE,
  PROJECT_REPOSITORY,
  REDIS,
  type IFileStorage,
  type IProjectRepository,
} from '../../ports/index.js';
import { projectKeys } from '../projects/project.mapper.js';

const MAINTENANCE_QUEUE = 'maintenance';

/**
 * Política de privacidad (§8.4): las fotos de proyectos que el usuario nunca guardó ni
 * compartió se BORRAN (S3 + base de datos) al cumplirse RETENTION_HOURS. Corre como job
 * repetible de BullMQ, así que con varias réplicas del worker se ejecuta una sola vez.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROJECT_REPOSITORY) private readonly projects: IProjectRepository,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.redis.duplicate() });
    await this.queue.upsertJobScheduler(
      'cleanup-unsaved-projects',
      { every: 30 * 60_000 },
      { name: 'cleanup', opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
    this.worker = new Worker(MAINTENANCE_QUEUE, async () => this.purgeExpired(), {
      connection: this.redis.duplicate(),
      concurrency: 1,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - this.config.RETENTION_HOURS * 3600_000);
    let purged = 0;
    for (;;) {
      const ids = await this.projects.listExpiredUnsaved(before, 50);
      if (ids.length === 0) break;
      for (const id of ids) {
        await this.storage.deletePrefix(projectKeys.prefix(id));
        await this.projects.delete(id);
        purged++;
      }
    }
    if (purged > 0) this.logger.log({ purged }, 'Proyectos no guardados eliminados por retención');
    return purged;
  }
}
