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
    @Inject(APP_CONFIG) protected readonly config: AppConfig,
  ) {}

  /** Qué se cuenta (Template Method: las subclases cambian el contador y el límite). */
  protected readonly counter: string = 'generations';
  protected limit(): number {
    return this.config.GENERATIONS_PER_DAY;
  }
  protected exceededMessage(limit: number): string {
    return `Alcanzaste el límite de ${limit} generaciones por día. Vuelve mañana.`;
  }

  private key(userId: string): string {
    return `quota:${this.counter}:${userId}:${new Date().toISOString().slice(0, 10)}`;
  }

  async consume(userId: string, amount: number): Promise<{ used: number; limit: number }> {
    const limit = this.limit();
    const key = this.key(userId);
    const [[, used]] = (await this.redis.multi().incrby(key, amount).expire(key, 26 * 3600).exec()) as [
      [Error | null, number],
      [Error | null, number],
    ];
    if (used > limit) {
      await this.redis.decrby(key, amount);
      throw new QuotaExceededError(this.exceededMessage(limit));
    }
    return { used, limit };
  }

  async refund(userId: string, amount: number): Promise<void> {
    const key = this.key(userId);
    const left = await this.redis.decrby(key, amount);
    if (left < 0) await this.redis.set(key, 0, 'KEEPTTL');
  }
}

/** Cuota diaria de mensajes al chat con Claude (cada mensaje cuesta tokens). */
@Injectable()
export class RedisChatQuota extends RedisQuota {
  protected override readonly counter = 'chat';
  protected override limit(): number {
    return this.config.CHAT_PER_DAY;
  }
  protected override exceededMessage(limit: number): string {
    return `Alcanzaste el límite de ${limit} mensajes al asistente con IA por día.`;
  }
}
