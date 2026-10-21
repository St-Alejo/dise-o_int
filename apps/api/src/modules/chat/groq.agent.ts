/**
 * Agente con Groq: segundo paso de la cascada, para lo que el modelo local no entendió con
 * confianza. API compatible con OpenAI (chat completions con `tools`), las mismas herramientas
 * de la DesignToolbox que Claude y el mismo bucle: el modelo elige herramientas, cada resultado
 * vuelve a él y al final resume.
 *
 * Con mesura (capa gratuita): sin reintentos ante 429, cortacircuitos propio y la cuota diaria
 * del chat que aplica el caso de uso. Cualquier fallo externo es AgentUnavailableError.
 */
import { TOOL_DESCRIPTIONS, TOOL_INPUTS, TOOL_NAMES } from '@interiores/shared-types';
import { z } from 'zod';
import { CircuitBreaker } from '../../common/circuit-breaker.js';
import { DESIGN_SYSTEM_PROMPT, historyToMessages } from './claude.agent.js';
import { AgentUnavailableError, type DesignAgent, type DesignAgentInput, type DesignAgentResult } from './design-agent.js';

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface Completion {
  choices: { finish_reason: string; message: { content: string | null; tool_calls?: ToolCall[] } }[];
}

/** Lo mínimo de `fetch` que usa el agente (las pruebas lo sustituyen). */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface GroqAgentOptions {
  apiKey: string | undefined;
  model: string;
  maxToolTurns?: number;
  timeoutMs?: number;
  fetch?: FetchLike;
  now?: () => number;
}

export function buildGroqTools() {
  return TOOL_NAMES.map((name) => {
    const { $schema: _omit, ...parameters } = z.toJSONSchema(TOOL_INPUTS[name]) as Record<string, unknown>;
    return { type: 'function' as const, function: { name, description: TOOL_DESCRIPTIONS[name], parameters } };
  });
}

export class GroqDesignAgent implements DesignAgent {
  readonly kind = 'groq' as const;
  private readonly tools = buildGroqTools();
  private readonly fetch: FetchLike;
  /** Tres fallos seguidos (límite, caída) y Groq descansa un minuto: se responde sin él. */
  private readonly breaker: CircuitBreaker;

  constructor(private readonly opts: GroqAgentOptions) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 60_000, ...(opts.now ? { now: opts.now } : {}) });
  }

  get available(): boolean {
    return !!this.opts.apiKey && this.breaker.state !== 'open';
  }

  async run({ message, history, toolbox, context, signal }: DesignAgentInput): Promise<DesignAgentResult> {
    if (!this.opts.apiKey) throw new AgentUnavailableError('Sin GROQ_API_KEY');
    const scene = toolbox.run('get_scene', {}).content;
    const messages: Message[] = [
      { role: 'system', content: DESIGN_SYSTEM_PROMPT },
      ...historyToMessages(history).map((m) => ({ role: m.role, content: m.content as string }) as Message),
      { role: 'user', content: `Tipo de cuarto: ${context.roomType}. Estilo elegido: ${context.styleId ?? 'ninguno'}.\n<escena>\n${scene}\n</escena>\n\n${message}` },
    ];
    const maxTurns = this.opts.maxToolTurns ?? 6;
    for (let turn = 0; ; turn++) {
      const last = turn + 1 >= maxTurns;
      const choice = (await this.call(messages, signal, !last)).choices[0];
      if (!choice) throw new AgentUnavailableError('Groq respondió sin opciones');
      const calls = choice.message.tool_calls ?? [];
      if (calls.length === 0 || last) return { reply: choice.message.content?.trim() || 'Listo.' };
      messages.push({ role: 'assistant', content: choice.message.content, tool_calls: calls });
      for (const call of calls) {
        let input: unknown;
        try {
          input = JSON.parse(call.function.arguments || '{}');
        } catch {
          input = null;
        }
        const out = input === null ? { content: 'Los argumentos no son JSON válido' } : toolbox.run(call.function.name, input);
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.content });
      }
    }
  }

  private async call(messages: Message[], signal: AbortSignal | undefined, withTools: boolean): Promise<Completion> {
    if (!this.breaker.allows()) throw new AgentUnavailableError('Groq descansa tras varios fallos seguidos');
    const signals = [AbortSignal.timeout(this.opts.timeoutMs ?? 30_000)];
    if (signal) signals.push(signal);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.opts.model,
          messages,
          tools: this.tools,
          tool_choice: withTools ? 'auto' : 'none',
          temperature: 0.2,
          max_tokens: 1024,
        }),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      this.breaker.failure();
      throw new AgentUnavailableError(`Groq no respondió: ${(err as Error).message}`);
    }
    if (!res.ok) {
      // 400 (una llamada a herramienta mal formada) es del modelo, no de Groq caído.
      if (res.status !== 400) this.breaker.failure();
      throw new AgentUnavailableError(`Groq respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    this.breaker.success();
    return (await res.json()) as Completion;
  }
}
