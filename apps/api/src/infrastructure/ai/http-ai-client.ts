import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeReferenceResponseSchema,
  AnalyzeRoomResponseSchema,
  NluParseResponseSchema,
  RankRecommendationsResponseSchema,
  type AnalyzeReferenceRequest,
  type AnalyzeReferenceResponse,
  type NluParseRequest,
  type NluParseResponse,
  type RankRecommendationsRequest,
  type RankRecommendationsResponse,
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
import { CircuitBreaker, type CircuitState } from '../../common/circuit-breaker.js';
import { AiServiceError } from '../../common/errors.js';
import type { AppConfig } from '../../config/env.js';
import { APP_CONFIG, type AiCallContext, type IAiClient } from '../../ports/index.js';

export { AiServiceError };

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/** Llamadas fallidas seguidas (cada una con sus reintentos) que dan a la IA por caída. */
const BREAKER_FAILURES = 4;
/** Con el circuito abierto, cada cuánto se deja pasar una llamada de prueba. */
const BREAKER_OPEN_MS = 15_000;
/** Modelo de intención y ranking: en CPU tardan milisegundos; si no, mejor el respaldo. */
const FAST_TIMEOUT_MS = 4_000;
/** La lectura de una referencia puede pasar por el modelo de visión. */
const REFERENCE_TIMEOUT_MS = 45_000;

/**
 * Adaptador HTTP hacia el microservicio de IA (FastAPI). Aplica timeout por llamada,
 * un reintento con backoff ante fallos transitorios, propagación del request-id y
 * validación de la respuesta contra el contrato compartido.
 *
 * Con cortacircuitos: si la IA lleva varias llamadas seguidas sin responder, las siguientes
 * fallan al instante (siguen siendo reintentables, así que la cola las repite más tarde) en vez
 * de esperar cada una su timeout. Cada proceso (API, worker) tiene el suyo.
 */
@Injectable()
export class HttpAiClient implements IAiClient {
  private readonly logger = new Logger(HttpAiClient.name);
  private readonly baseUrl: string;
  private readonly breaker = new CircuitBreaker({ failureThreshold: BREAKER_FAILURES, openMs: BREAKER_OPEN_MS });
  /** Espera base entre reintentos (las pruebas la ponen a cero). */
  retryDelayMs = 500;

  get circuitState(): CircuitState {
    return this.breaker.state;
  }

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

  // El chat y Recomendar esperan a estas tres: un solo intento y poco tiempo (hay respaldo).
  parseIntent(req: NluParseRequest, ctx?: AiCallContext): Promise<NluParseResponse> {
    return this.post('/v1/nlu/parse', req, NluParseResponseSchema, { timeoutMs: FAST_TIMEOUT_MS, ...ctx }, 1);
  }

  rankRecommendations(req: RankRecommendationsRequest, ctx?: AiCallContext): Promise<RankRecommendationsResponse> {
    return this.post('/v1/recommend/rank', req, RankRecommendationsResponseSchema, { timeoutMs: FAST_TIMEOUT_MS, ...ctx }, 1);
  }

  analyzeReference(req: AnalyzeReferenceRequest, ctx?: AiCallContext): Promise<AnalyzeReferenceResponse> {
    return this.post('/v1/reference/analyze', req, AnalyzeReferenceResponseSchema, { timeoutMs: REFERENCE_TIMEOUT_MS, ...ctx }, 1);
  }

  async ping(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/health/live`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new AiServiceError(`health ${res.status}`, res.status, true, 'upstream');
  }

  private async post<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
    ctx: AiCallContext = {},
    maxAttempts = 2,
  ): Promise<z.output<S>> {
    if (!this.breaker.allows()) {
      throw new AiServiceError(
        `La IA no responde (circuito abierto; se vuelve a probar en ${Math.ceil(this.breaker.retryInMs / 1000)} s)`,
        null,
        true,
        'unreachable',
      );
    }
    try {
      const result = await this.attempt(path, body, schema, ctx, maxAttempts);
      this.breaker.success();
      return result;
    } catch (err) {
      // Solo cuenta como caída lo que es culpa del servicio: ni un rechazo de los datos ni una
      // llamada que canceló quien la hizo.
      const down = err instanceof AiServiceError && err.kind !== 'rejected' && !ctx.signal?.aborted;
      if (down) this.breaker.failure();
      else this.breaker.success();
      throw err;
    }
  }

  private async attempt<S extends z.ZodType>(path: string, body: unknown, schema: S, ctx: AiCallContext, maxAttempts: number): Promise<z.output<S>> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const signals = [AbortSignal.timeout(ctx.timeoutMs ?? this.config.AI_TIMEOUT_MS)];
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
          const retryable = RETRYABLE_STATUS.has(res.status);
          throw new AiServiceError(
            `IA ${path} respondió ${res.status}: ${text}`,
            res.status,
            retryable,
            res.status === 408 || res.status === 504
              ? 'timeout'
              : retryable || res.status === 404 // 404: falta un objeto en S3, no es culpa de la foto
                ? 'upstream'
                : 'rejected',
          );
        }
        const parsed = schema.safeParse(await res.json());
        if (!parsed.success) {
          // Respuesta fuera de contrato: reintentar no la arregla.
          throw new AiServiceError(`IA ${path} devolvió una respuesta inválida: ${parsed.error.message.slice(0, 300)}`, res.status, false, 'upstream');
        }
        return parsed.data;
      } catch (err) {
        lastError = err;
        const retryable = err instanceof AiServiceError ? err.retryable : !ctx.signal?.aborted;
        if (!retryable || attempt === maxAttempts) break;
        const delay = this.retryDelayMs * 2 ** (attempt - 1);
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
      isTimeout ? 'timeout' : 'unreachable',
    );
  }
}
