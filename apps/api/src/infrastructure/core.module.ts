import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { loadConfig, type AppConfig } from '../config/env.js';
import {
  AI_CLIENT,
  APP_CONFIG,
  BLENDER_QUOTA,
  CATALOG_REPOSITORY,
  FILE_STORAGE,
  JOB_QUEUE,
  PROGRESS_BROKER,
  PROJECT_REPOSITORY,
  QUOTA,
  REDIS,
  RENDER_JOB_QUEUE,
  RENDER_REPOSITORY,
} from '../ports/index.js';
import { HttpAiClient } from './ai/http-ai-client.js';
import { PhotoProcessor } from './imaging/photo-processor.js';
import { MediaUrlSigner } from './media/media-url-signer.js';
import { PrismaCatalogRepository } from './prisma/prisma-catalog.repository.js';
import { PrismaProjectRepository } from './prisma/prisma-project.repository.js';
import { PrismaRenderRepository } from './prisma/prisma-render.repository.js';
import { PrismaService } from './prisma/prisma.service.js';
import { BullMqJobQueue } from './queue/bullmq-job-queue.js';
import { BullMqRenderJobQueue } from './queue/bullmq-render-queue.js';
import { RedisBlenderQuota, RedisQuota } from './queue/redis-quota.js';
import { RedisProgressBroker } from './realtime/redis-progress-broker.js';
import { createRedis } from './redis/redis.provider.js';
import { S3FileStorage } from './storage/s3-file-storage.js';

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

/**
 * Raíz de composición de la infraestructura: el ÚNICO lugar donde se decide qué adaptador
 * implementa cada puerto. Lo comparten la API HTTP y el worker.
 */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    { provide: REDIS, useFactory: (c: AppConfig) => createRedis(c.REDIS_URL), inject: [APP_CONFIG] },
    RedisLifecycle,
    PrismaService,
    PhotoProcessor,
    MediaUrlSigner,
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
    { provide: CATALOG_REPOSITORY, useClass: PrismaCatalogRepository },
    { provide: RENDER_REPOSITORY, useClass: PrismaRenderRepository },
    { provide: FILE_STORAGE, useClass: S3FileStorage },
    { provide: AI_CLIENT, useClass: HttpAiClient },
    { provide: JOB_QUEUE, useClass: BullMqJobQueue },
    { provide: PROGRESS_BROKER, useClass: RedisProgressBroker },
    { provide: QUOTA, useClass: RedisQuota },
    { provide: RENDER_JOB_QUEUE, useClass: BullMqRenderJobQueue },
    { provide: BLENDER_QUOTA, useClass: RedisBlenderQuota },
  ],
  exports: [
    APP_CONFIG,
    REDIS,
    PrismaService,
    PhotoProcessor,
    MediaUrlSigner,
    PROJECT_REPOSITORY,
    CATALOG_REPOSITORY,
    RENDER_REPOSITORY,
    FILE_STORAGE,
    AI_CLIENT,
    JOB_QUEUE,
    PROGRESS_BROKER,
    QUOTA,
    RENDER_JOB_QUEUE,
    BLENDER_QUOTA,
  ],
})
export class CoreModule {}
