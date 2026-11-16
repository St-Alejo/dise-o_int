/**
 * Tope de gasto en Claude para toda la app (no por usuario): cada respuesta suma su costo real,
 * calculado con `usage`, y al llegar al tope el agente deja de llamar a la API y el chat sigue
 * con el modelo local y las reglas. Así la demo nunca gasta más de lo presupuestado.
 */
import type { ISpendLedger } from '../../ports/index.js';
import { AgentUnavailableError } from './design-agent.js';

/** US$ por millón de tokens (precios de la API de Anthropic, nov-2026). */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
/** Modelo desconocido: se cobra como el más caro de la tabla, para no quedarse corto. */
const UNKNOWN: Price = PRICES['claude-opus-5']!;

export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function priceOf(model: string): Price {
  return PRICES[model] ?? UNKNOWN;
}

/** Costo en US$ de una respuesta. */
export function costOf(model: string, usage: TokenUsage | null | undefined): number {
  if (!usage) return 0;
  const p = priceOf(model);
  const n = (v: number | null | undefined) => v ?? 0;
  return (
    (n(usage.input_tokens) * p.input +
      n(usage.output_tokens) * p.output +
      n(usage.cache_read_input_tokens) * p.cacheRead +
      n(usage.cache_creation_input_tokens) * p.cacheWrite) /
    1_000_000
  );
}

export class ClaudeBudget {
  constructor(
    private readonly ledger: ISpendLedger,
    readonly limitUsd: number,
  ) {}

  /** Lanza AgentUnavailableError si ya se gastó el tope (el chat sigue con el respaldo). */
  async ensure(): Promise<void> {
    const spent = await this.ledger.spent();
    if (spent >= this.limitUsd) {
      throw new AgentUnavailableError(`Presupuesto de Claude agotado (US$${spent.toFixed(4)} de US$${this.limitUsd})`);
    }
  }

  /** Suma lo que costó una respuesta; devuelve el total gastado. */
  async charge(model: string, usage: TokenUsage | null | undefined): Promise<number> {
    const cost = costOf(model, usage);
    return cost > 0 ? this.ledger.add(cost) : this.ledger.spent();
  }

  spent(): Promise<number> {
    return this.ledger.spent();
  }
}

/** Libreta en memoria (pruebas y arranque sin Redis). */
export class InMemorySpendLedger implements ISpendLedger {
  private total = 0;
  async spent(): Promise<number> {
    return this.total;
  }
  async add(usd: number): Promise<number> {
    this.total += usd;
    return this.total;
  }
}
