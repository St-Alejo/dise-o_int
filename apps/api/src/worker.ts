import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loggerModule } from './common/logger.js';
import { loadConfig } from './config/env.js';
import { CoreModule } from './infrastructure/core.module.js';
import { AiWorker } from './modules/jobs/ai-worker.js';
import { PipelineService } from './modules/jobs/pipeline.service.js';
import { RetentionService } from './modules/jobs/retention.service.js';
import { WorkerHealthServer } from './modules/jobs/worker-health.server.js';

@Module({
  imports: [loggerModule('worker'), CoreModule],
  providers: [PipelineService, AiWorker, RetentionService, WorkerHealthServer],
})
class WorkerModule {}

/** Proceso worker: misma imagen que la API, otro entrypoint (escala de forma independiente). */
async function bootstrap(): Promise<void> {
  loadConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.init();
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fallo al arrancar el worker:', err instanceof Error ? err.message : err);
  process.exit(1);
});
