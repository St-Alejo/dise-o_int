import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { loadConfig, type AppConfig } from '../config/env.js';
import {
  AI_CLIENT,
  APP_CONFIG,
  CATALOG_REPOSITORY,
  FILE_STORAGE,
  JOB_QUEUE,
  PROGRESS_BROKER,
  PROJECT_REPOSITORY,
  QUOTA,
  REDIS,
} from '../ports/index.js';
import { HttpAiClient } from './ai/http-ai-client.js';
import { PhotoProcessor } from './imaging/photo-processor.js';
import { MediaUrlSigner } from './media/media-url-signer.js';
import { PrismaCatalogRepository } from './prisma/prisma-catalog.repository.js';
import { PrismaProjectRepository } from './prisma/prisma-project.repository.js';
import { PrismaService } from './prisma/prisma.service.js';
import { BullMqJobQueue } from './queue/bullmq-job-queue.js';
import { RedisQuota } from './queue/redis-quota.js';
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
    { provide: FILE_STORAGE, useClass: S3FileStorage },
    { provide: AI_CLIENT, useClass: HttpAiClient },
    { provide: JOB_QUEUE, useClass: BullMqJobQueue },
    { provide: PROGRESS_BROKER, useClass: RedisProgressBroker },
    { provide: QUOTA, useClass: RedisQuota },
  ],
  exports: [
    APP_CONFIG,
    REDIS,
    PrismaService,
    PhotoProcessor,
    MediaUrlSigner,
    PROJECT_REPOSITORY,
    CATALOG_REPOSITORY,
    FILE_STORAGE,
    AI_CLIENT,
    JOB_QUEUE,
    PROGRESS_BROKER,
    QUOTA,
  ],
})
export class CoreModule {}
