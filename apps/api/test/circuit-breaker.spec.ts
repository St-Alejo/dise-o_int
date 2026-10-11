import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiServiceError } from '../src/common/errors.js';
import { CircuitBreaker } from '../src/common/circuit-breaker.js';
import { HttpAiClient } from '../src/infrastructure/ai/http-ai-client.js';
import { testConfig } from './fakes.js';

describe('CircuitBreaker', () => {
  function make() {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 1000, now: () => now });
    return { breaker, advance: (ms: number) => (now += ms) };
  }

  it('cerrado deja pasar; se abre al tercer fallo seguido', () => {
    const { breaker } = make();
    breaker.failure();
    breaker.failure();
    expect(breaker.state).toBe('closed');
    expect(breaker.allows()).toBe(true);
    breaker.failure();
    expect(breaker.state).toBe('open');
    expect(breaker.allows()).toBe(false);
    expect(breaker.retryInMs).toBe(1000);
  });

  it('un acierto entre fallos pone la cuenta a cero', () => {
    const { breaker } = make();
    breaker.failure();
    breaker.failure();
    breaker.success();
    breaker.failure();
    breaker.failure();
    expect(breaker.state).toBe('closed');
  });

  it('pasada la espera deja pasar una sola prueba: si sale bien se cierra', () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 3; i++) breaker.failure();
    advance(1000);
    expect(breaker.state).toBe('half-open');
    expect(breaker.allows()).toBe(true);
    expect(breaker.allows()).toBe(false); // la segunda espera a ver qué pasa con la primera
    breaker.success();
    expect(breaker.state).toBe('closed');
    expect(breaker.allows()).toBe(true);
  });

  it('si la prueba falla se vuelve a abrir desde ese momento', () => {
    const { breaker, advance } = make();
    for (let i = 0; i < 3; i++) breaker.failure();
    advance(1500);
    expect(breaker.allows()).toBe(true);
    breaker.failure();
    expect(breaker.state).toBe('open');
    expect(breaker.retryInMs).toBe(1000);
    advance(999);
    expect(breaker.allows()).toBe(false);
  });
});

describe('HttpAiClient con cortacircuitos', () => {
  afterEach(() => vi.unstubAllGlobals());
  const layout = { roomShell: {}, roomType: 'living', styleId: null, candidates: [], locked: [] } as never;

  it('con la IA caída deja de llamarla y falla al instante con un error reintentable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpAiClient({ ...testConfig, AI_SERVICE_URL: 'http://ia.invalid', AI_TIMEOUT_MS: 50 });
    client.retryDelayMs = 0;

    // Cada llamada hace dos intentos; a la cuarta que falla, el circuito se abre.
    for (let i = 0; i < 4; i++) await expect(client.placeFurniture(layout)).rejects.toBeInstanceOf(AiServiceError);
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBe(8);

    const error = await client.placeFurniture(layout).catch((e: unknown) => e as AiServiceError);
    expect(error).toMatchObject({ retryable: true, kind: 'unreachable' });
    expect(error.message).toContain('circuito abierto');
    expect(fetchMock.mock.calls.length).toBe(calls); // ni una llamada más
  });

  it('un rechazo de los datos (4xx) no cuenta como caída', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('foto inválida', { status: 422 })),
    );
    const client = new HttpAiClient({ ...testConfig, AI_SERVICE_URL: 'http://ia.invalid', AI_TIMEOUT_MS: 50 });
    for (let i = 0; i < 6; i++) await expect(client.placeFurniture(layout)).rejects.toMatchObject({ kind: 'rejected' });
    expect(client.circuitState).toBe('closed');
  });
});
