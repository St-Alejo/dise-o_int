export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Fallos seguidos que abren el circuito. */
  failureThreshold: number;
  /** Cuánto se espera, abierto, antes de dejar pasar una llamada de prueba. */
  openMs: number;
  /** Reloj inyectable (las pruebas lo fijan). */
  now?: () => number;
}

/**
 * Cortacircuitos (patrón Circuit Breaker) para una dependencia que puede caerse.
 *
 * - Cerrado: las llamadas pasan. Tras `failureThreshold` fallos seguidos se abre.
 * - Abierto: las llamadas se rechazan sin intentarlas, para no apilar esperas contra algo que no
 *   responde. Pasado `openMs` queda medio abierto.
 * - Medio abierto: pasa una sola llamada de prueba. Si sale bien se cierra; si falla, vuelve a abrirse.
 *
 * No hace la llamada: quien lo usa pregunta con `allows()` y le cuenta el resultado.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  get state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.options.openMs ? 'half-open' : 'open';
  }

  /** Milisegundos que faltan para la próxima llamada de prueba (0 si ya puede pasar). */
  get retryInMs(): number {
    return this.openedAt === null ? 0 : Math.max(0, this.options.openMs - (this.now() - this.openedAt));
  }

  /** ¿Puede pasar una llamada ahora? Medio abierto, solo una a la vez. */
  allows(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open' || this.probing) return false;
    this.probing = true;
    return true;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  failure(): void {
    this.probing = false;
    this.failures++;
    // La prueba de medio abierto falló, o se llegó al tope: se abre (otra vez) desde ahora.
    if (this.openedAt !== null || this.failures >= this.options.failureThreshold) this.openedAt = this.now();
  }
}
