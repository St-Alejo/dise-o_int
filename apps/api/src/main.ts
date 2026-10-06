import 'reflect-metadata';
import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { buildOpenApiDocument, mountSwagger } from './common/openapi.js';
import { loadConfig } from './config/env.js';
import { FILE_STORAGE, type IFileStorage } from './ports/index.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig(); // fail fast antes de abrir conexiones
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.set('trust proxy', config.TRUST_PROXY); // IP real del cliente detrás de nginx / balanceador (rate limit)
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  if (config.CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: config.CORS_ORIGINS, credentials: true, exposedHeaders: ['x-request-id'] });
  }
  app.enableShutdownHooks(); // SIGTERM → cierra HTTP, colas, Redis y Prisma ordenadamente

  if (config.SWAGGER_ENABLED) mountSwagger(app, buildOpenApiDocument(app));

  await app.get<IFileStorage>(FILE_STORAGE).ensureBucket();
  await app.listen(config.PORT, '0.0.0.0');
  NestLogger.log(`API escuchando en :${config.PORT} (${config.NODE_ENV})`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fallo al arrancar la API:', err instanceof Error ? err.message : err);
  process.exit(1);
});
