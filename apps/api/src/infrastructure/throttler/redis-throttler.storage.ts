import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Almacenamiento del rate limiter en Redis: los límites se comparten entre todas las
 * réplicas de la API (con almacenamiento en memoria, N réplicas = N veces el límite).
 * Un script Lua hace el conteo + bloqueo de forma atómica.
 */
const SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])
local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  return {limit + 1, redis.call('PTTL', hitsKey), 1, blockTtl}
end
local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local hitsTtl = redis.call('PTTL', hitsKey)
if hits > limit then
  redis.call('SET', blockKey, 1, 'PX', blockDuration)
  return {hits, hitsTtl, 1, blockDuration}
end
return {hits, hitsTtl, 0, 0}
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    const [hits, hitsTtl, blocked, blockTtl] = (await this.redis.eval(
      SCRIPT,
      2,
      `${base}:hits`,
      `${base}:block`,
      ttl,
      limit,
      blockDuration > 0 ? blockDuration : ttl,
    )) as [number, number, number, number];
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(Math.max(hitsTtl, 0) / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(Math.max(blockTtl, 0) / 1000),
    };
  }
}
