import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JobProgressEventSchema, type JobProgressEvent } from '@interiores/shared-types';
import type { Redis } from 'ioredis';
import { REDIS, type IProgressBroker } from '../../ports/index.js';

const CHANNEL_PREFIX = 'progress:';
const HISTORY_TTL_S = 3600;
const HISTORY_MAX = 100;

/**
 * Progreso en vivo sobre Redis pub/sub + historial en una lista (patrón del proyecto de
 * planos): quien se conecta tarde recibe primero el historial y luego los eventos en vivo,
 * así nunca "se pierde" una etapa. Cada instancia de la API tiene su propio suscriptor,
 * por lo que escala horizontalmente sin adaptador de socket.io ni sticky sessions.
 */
@Injectable()
export class RedisProgressBroker implements IProgressBroker, OnModuleDestroy {
  private readonly logger = new Logger(RedisProgressBroker.name);
  private subscriber: Redis | null = null;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(event: JobProgressEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const historyKey = `${CHANNEL_PREFIX}${event.projectId}:history`;
    await this.redis
      .multi()
      .rpush(historyKey, payload)
      .ltrim(historyKey, -HISTORY_MAX, -1)
      .expire(historyKey, HISTORY_TTL_S)
      .publish(`${CHANNEL_PREFIX}${event.projectId}`, payload)
      .exec();
  }

  async history(projectId: string): Promise<JobProgressEvent[]> {
    const raw = await this.redis.lrange(`${CHANNEL_PREFIX}${projectId}:history`, 0, -1);
    return raw.flatMap((r) => {
      const parsed = JobProgressEventSchema.safeParse(JSON.parse(r));
      return parsed.success ? [parsed.data] : [];
    });
  }

  async subscribe(handler: (event: JobProgressEvent) => void): Promise<() => Promise<void>> {
    const sub = this.redis.duplicate();
    this.subscriber = sub;
    sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      if (channel.endsWith(':history')) return;
      try {
        const parsed = JobProgressEventSchema.safeParse(JSON.parse(message));
        if (parsed.success) handler(parsed.data);
      } catch (err) {
        this.logger.warn({ err }, 'Evento de progreso inválido descartado');
      }
    });
    await sub.psubscribe(`${CHANNEL_PREFIX}*`);
    return async () => {
      await sub.punsubscribe().catch(() => undefined);
      sub.disconnect();
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.subscriber?.disconnect();
  }
}
