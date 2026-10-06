import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import { QuotaExceededError } from '../../common/errors.js';
import { APP_CONFIG, REDIS, type IQuota } from '../../ports/index.js';

/**
 * Cuota diaria de generaciones por usuario (control del costo de inferencia, §8.5).
 * INCRBY atómico: si se pasa del límite se revierte y se rechaza.
 */
@Injectable()
export class RedisQuota implements IQuota {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private key(userId: string): string {
    return `quota:generations:${userId}:${new Date().toISOString().slice(0, 10)}`;
  }

  async consume(userId: string, amount: number): Promise<{ used: number; limit: number }> {
    const limit = this.config.GENERATIONS_PER_DAY;
    const key = this.key(userId);
    const [[, used]] = (await this.redis.multi().incrby(key, amount).expire(key, 26 * 3600).exec()) as [
      [Error | null, number],
      [Error | null, number],
    ];
    if (used > limit) {
      await this.redis.decrby(key, amount);
      throw new QuotaExceededError(`Alcanzaste el límite de ${limit} generaciones por día. Vuelve mañana.`);
    }
    return { used, limit };
  }

  async refund(userId: string, amount: number): Promise<void> {
    const key = this.key(userId);
    const left = await this.redis.decrby(key, amount);
    if (left < 0) await this.redis.set(key, 0, 'KEEPTTL');
  }
}
