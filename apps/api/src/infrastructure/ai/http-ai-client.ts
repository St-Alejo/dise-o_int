import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeRoomResponseSchema,
  GenerateStyleResponseSchema,
  PlaceFurnitureResponseSchema,
  type AnalyzeRoomRequest,
  type AnalyzeRoomResponse,
  type GenerateStyleRequest,
  type GenerateStyleResponse,
  type PlaceFurnitureRequest,
  type PlaceFurnitureResponse,
} from '@interiores/shared-types';
import type { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import { APP_CONFIG, type AiCallContext, type IAiClient } from '../../ports/index.js';

export class AiServiceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Si es false, reintentar no tiene sentido (p. ej. 422: la entrada es inválida). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Adaptador HTTP hacia el microservicio de IA (FastAPI). Aplica timeout por llamada,
 * un reintento con backoff ante fallos transitorios, propagación del request-id y
 * validación de la respuesta contra el contrato compartido.
 */
@Injectable()
export class HttpAiClient implements IAiClient {
  private readonly logger = new Logger(HttpAiClient.name);
  private readonly baseUrl: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.baseUrl = config.AI_SERVICE_URL.replace(/\/$/, '');
  }

  analyzeRoom(req: AnalyzeRoomRequest, ctx?: AiCallContext): Promise<AnalyzeRoomResponse> {
    return this.post('/v1/room/analyze', req, AnalyzeRoomResponseSchema, ctx);
  }

  generateStyle(req: GenerateStyleRequest, ctx?: AiCallContext): Promise<GenerateStyleResponse> {
    return this.post('/v1/styles/generate', req, GenerateStyleResponseSchema, ctx);
  }

  placeFurniture(req: PlaceFurnitureRequest, ctx?: AiCallContext): Promise<PlaceFurnitureResponse> {
    return this.post('/v1/layout/place', req, PlaceFurnitureResponseSchema, ctx);
  }

  async ping(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/health/live`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new AiServiceError(`health ${res.status}`, res.status, true);
  }

  private async post<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
    ctx: AiCallContext = {},
    maxAttempts = 2,
  ): Promise<z.output<S>> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const signals = [AbortSignal.timeout(this.config.AI_TIMEOUT_MS)];
      if (ctx.signal) signals.push(ctx.signal);
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.AI_INTERNAL_TOKEN}`,
            ...(ctx.requestId ? { 'x-request-id': ctx.requestId } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any(signals),
        });
        if (!res.ok) {
          const text = (await res.text()).slice(0, 500);
          throw new AiServiceError(`IA ${path} respondió ${res.status}: ${text}`, res.status, RETRYABLE_STATUS.has(res.status));
        }
        return schema.parse(await res.json());
      } catch (err) {
        lastError = err;
        const retryable =
          err instanceof AiServiceError ? err.retryable : (err as Error).name !== 'ZodError' && !ctx.signal?.aborted;
        if (!retryable || attempt === maxAttempts) break;
        const delay = 500 * 2 ** (attempt - 1);
        this.logger.warn({ path, attempt, requestId: ctx.requestId, err: (err as Error).message }, `Reintentando IA en ${delay} ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (lastError instanceof AiServiceError) throw lastError;
    const e = lastError as Error;
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw new AiServiceError(
      isTimeout ? `La IA no respondió a tiempo (${path})` : `No se pudo contactar a la IA: ${e?.message ?? e}`,
      null,
      true,
    );
  }
}
