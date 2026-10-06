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
  static readonly ORPHAN_GRACE_MS = 60 * 60_000;
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
    this.worker = new Worker(MAINTENANCE_QUEUE, async () => (await this.purgeExpired()) + (await this.sweepOrphans()), {
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
        // Igual que el borrado manual: primero la fila, luego los archivos (lo que falle lo
        // recoge el barrido de huérfanos).
        await this.projects.delete(id);
        await this.storage.deletePrefix(projectKeys.prefix(id)).catch(() => undefined);
        purged++;
      }
    }
    if (purged > 0) this.logger.log({ purged }, 'Proyectos no guardados eliminados por retención');
    return purged;
  }

  /**
   * Borra archivos de proyectos que ya no existen en la base de datos (p. ej. si S3 falló
   * durante un borrado). Solo toca prefijos cuyo objeto más reciente tiene más de
   * ORPHAN_GRACE_MS, para no competir con un proyecto que se está creando en este momento.
   */
  async sweepOrphans(now = new Date()): Promise<number> {
    const newest = new Map<string, number>();
    for await (const obj of this.storage.listObjects('projects/')) {
      const id = obj.key.split('/')[1];
      if (!id) continue;
      newest.set(id, Math.max(newest.get(id) ?? 0, obj.lastModified.getTime()));
    }
    const candidates = [...newest.entries()]
      .filter(([, t]) => now.getTime() - t > RetentionService.ORPHAN_GRACE_MS)
      .map(([id]) => id);
    let swept = 0;
    for (let i = 0; i < candidates.length; i += 100) {
      const batch = candidates.slice(i, i + 100);
      const alive = new Set(await this.projects.existingIds(batch));
      for (const id of batch.filter((x) => !alive.has(x))) {
        swept += await this.storage.deletePrefix(projectKeys.prefix(id));
      }
    }
    if (swept > 0) this.logger.log({ swept }, 'Archivos huérfanos eliminados');
    return swept;
  }
}
