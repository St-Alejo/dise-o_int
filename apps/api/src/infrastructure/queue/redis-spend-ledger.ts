import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS, type ISpendLedger } from '../../ports/index.js';

/** Gasto acumulado en Claude (US$), compartido por todas las réplicas de la API. */
@Injectable()
export class RedisSpendLedger implements ISpendLedger {
  static readonly KEY = 'spend:claude:usd';

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async spent(): Promise<number> {
    return Number((await this.redis.get(RedisSpendLedger.KEY)) ?? 0);
  }

  async add(usd: number): Promise<number> {
    return Number(await this.redis.incrbyfloat(RedisSpendLedger.KEY, usd));
  }
}
