import { Redis, type RedisOptions } from 'ioredis';

/**
 * Crea conexiones Redis con reconexión exponencial acotada. BullMQ exige
 * `maxRetriesPerRequest: null` en las conexiones que usan workers bloqueantes.
 */
export function createRedis(url: string, opts: RedisOptions = {}): Redis {
  return new Redis(url, {
    lazyConnect: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    ...opts,
  });
}
