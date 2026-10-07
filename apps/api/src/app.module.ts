import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { loggerModule } from './common/logger.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import type { AppConfig } from './config/env.js';
import { CoreModule } from './infrastructure/core.module.js';
import { RedisThrottlerStorage } from './infrastructure/throttler/redis-throttler.storage.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ProgressModule } from './modules/progress/progress.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { APP_CONFIG, REDIS } from './ports/index.js';

@Module({
  imports: [
    loggerModule('api'),
    CoreModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, REDIS],
      useFactory: (config: AppConfig, redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: config.THROTTLE_LIMIT_PER_MIN }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    AuthModule,
    ProjectsModule,
    CatalogModule,
    ChatModule,
    HealthModule,
    ProgressModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
