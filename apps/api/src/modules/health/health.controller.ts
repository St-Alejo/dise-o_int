import { Controller, Get, Inject, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AI_CLIENT, FILE_STORAGE, REDIS, type IAiClient, type IFileStorage } from '../../ports/index.js';
import { Public } from '../auth/auth.decorators.js';

const withTimeout = <T>(p: Promise<T>, ms = 2500) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms))]);

/**
 * - /health/live: el proceso responde (liveness; lo usa Docker/K8s para reiniciar).
 * - /health/ready: todas las dependencias responden (readiness; el balanceador solo
 *   envía tráfico cuando está OK). Devuelve 503 con el detalle de qué falla.
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    @Inject(AI_CLIENT) private readonly ai: IAiClient,
  ) {}

  @Public()
  @Get('live')
  live(): { status: 'ok'; uptimeS: number } {
    return { status: 'ok', uptimeS: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  async ready(@Res({ passthrough: true }) res: Response) {
    try {
      return await this.health.check([
        () => this.probe('database', () => this.prisma.ping()),
        () => this.probe('redis', async () => void (await this.redis.ping())),
        () => this.probe('storage', () => this.storage.ping()),
        () => this.probe('ai', () => this.ai.ping()),
      ]);
    } catch (err) {
      // Se devuelve el detalle por dependencia (no un problem+json genérico): el orquestador
      // y quien opera el sistema necesitan saber QUÉ está caído.
      if (err instanceof ServiceUnavailableException) {
        res.status(503);
        return err.getResponse();
      }
      throw err;
    }
  }

  private async probe(key: string, fn: () => Promise<void>): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    const started = Date.now();
    try {
      await withTimeout(fn());
      return check.up({ latencyMs: Date.now() - started });
    } catch (err) {
      return check.down({ message: (err as Error).message });
    }
  }
}
