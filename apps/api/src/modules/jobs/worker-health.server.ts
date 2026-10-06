import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import { APP_CONFIG, REDIS } from '../../ports/index.js';
import { AiWorker } from './ai-worker.js';

/** Endpoint HTTP mínimo para el HEALTHCHECK del contenedor del worker (no expuesto fuera de la red interna). */
@Injectable()
export class WorkerHealthServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerHealthServer.name);
  private server: Server | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly worker: AiWorker,
  ) {}

  onApplicationBootstrap(): void {
    this.server = createServer(async (req, res) => {
      if (req.url !== '/health') {
        res.writeHead(404).end();
        return;
      }
      let redisOk = false;
      try {
        redisOk = (await this.redis.ping()) === 'PONG';
      } catch {
        redisOk = false;
      }
      const ok = redisOk && this.worker.running;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'error', redis: redisOk, worker: this.worker.running }));
    });
    this.server.listen(this.config.WORKER_HEALTH_PORT, this.config.LISTEN_HOST, () =>
      this.logger.log(`Health del worker en :${this.config.WORKER_HEALTH_PORT}/health`),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
