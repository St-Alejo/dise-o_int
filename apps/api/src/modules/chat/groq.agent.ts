/**
 * Agente con Groq: segundo paso de la cascada, para lo que el modelo local no entendió con
 * confianza. API compatible con OpenAI (chat completions con `tools`), las mismas herramientas
 * de la DesignToolbox que Claude y el mismo bucle: el modelo elige herramientas, cada resultado
 * vuelve a él y al final resume.
 *
 * Con mesura (capa gratuita): un 429 en la primera llamada no se reintenta (se responde sin
 * Groq), cortacircuitos propio y la cuota diaria del chat que aplica el caso de uso. Única
 * excepción: a mitad del bucle de herramientas (cada vuelta manda ~4.500 tokens, casi todo la
 * definición de las herramientas, y la capa gratuita da 8.000/min) se espera lo que pide
 * `retry-after`, con un tope de 90 s por mensaje, para no tirar el trabajo ya hecho.
 * Cualquier fallo externo es AgentUnavailableError.
 */
import { TOOL_DESCRIPTIONS, TOOL_INPUTS, TOOL_NAMES, type ToolName } from '@interiores/shared-types';
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
  headers: { get(name: string): string | null };
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
  sleep?: (ms: number) => Promise<void>;
}

/** Espera total por mensaje ante 429 a mitad del bucle (nginx corta /api a los 120 s). */
const MID_LOOP_WAIT_BUDGET_MS = 90_000;

/** `retry-after` en segundos (Groq lo manda con decimales); null si falta o no es número. */
function retryAfterMs(value: string | null): number | null {
  const s = value === null ? NaN : Number.parseFloat(value);
  return Number.isFinite(s) && s >= 0 ? Math.ceil(s * 1000) : null;
}

export function buildGroqTools(names: readonly ToolName[] = TOOL_NAMES) {
  return names.map((name) => {
    const { $schema: _omit, ...parameters } = z.toJSONSchema(TOOL_INPUTS[name]) as Record<string, unknown>;
    return { type: 'function' as const, function: { name, description: TOOL_DESCRIPTIONS[name], parameters } };
  });
}

/**
 * Las 23 herramientas ocupan ~3.500 tokens y van en cada vuelta: con 8.000 tokens/min (capa
 * gratuita) no caben dos vueltas. A Groq se le manda un núcleo (amueblar, mover, acabados de la
 * biblioteca, luz, recomendar) y los grupos que el mensaje pide por sus palabras.
 */
const CORE_TOOLS: readonly ToolName[] = ['search_catalog', 'get_scene', 'add_item', 'move_item', 'rotate_item', 'remove_item', 'set_finishes', 'set_lighting', 'recommend'];
const TOOL_GROUPS: readonly { words: RegExp; tools: readonly ToolName[] }[] = [
  { words: /material|tapiz|tela|cuero|lino|terciopelo|madera|metal|marmol|color|tono|pinta|piso|pared|techo/, tools: ['list_materials', 'set_material'] },
  { words: /baldosa|azulejo|ceramic|porcelanato|ladrillo|cemento|microcemento|moqueta|piedra|marmol|brill|mosaico|espiga|damero|hexag|revest|enchap|zocalo|#[0-9a-f]{3}/, tools: ['set_finish_spec', 'set_wall_tiles', 'list_materials'] },
  { words: /bano|ducha|banera|lavamanos|inodoro/, tools: ['add_zone', 'set_finish_spec', 'set_wall_tiles'] },
  { words: /medid|tamano|metro|\bcm\b|ancho|largo|alto|grande|pequen|agrand|achic|estir|ampli|reduc/, tools: ['resize_item', 'set_room_size'] },
  { words: /fija|no (lo )?cambi|manten|candado|bloque|suelta|ya puedes|libera|no quiero|evita|sin alfombra|quiero (un|una)|me gustaria/, tools: ['pin', 'unpin', 'want_item'] },
  { words: /presupuesto|cuesta|costo|precio|obra|comput|norma|cumple|ergonom|electric|toma|enchufe|interruptor|instalac|circuito|plano|alzado|lamina|corte/, tools: ['estimate_works', 'check_compliance', 'suggest_installations', 'list_drawings'] },
];

/** Herramientas para un mensaje (y el historial reciente, por "y ahora en la otra pared"). */
export function selectGroqTools(text: string): ToolName[] {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const names = new Set<ToolName>(CORE_TOOLS);
  for (const group of TOOL_GROUPS) if (group.words.test(t)) for (const name of group.tools) names.add(name);
  return TOOL_NAMES.filter((name) => names.has(name));
}

/** Los gpt-oss razonan antes de responder: con esfuerzo bajo gastan menos de la cuota por minuto. */
const isReasoningModel = (model: string) => model.startsWith('openai/gpt-oss');

export class GroqDesignAgent implements DesignAgent {
  readonly kind = 'groq' as const;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Tres fallos seguidos (límite, caída) y Groq descansa un minuto: se responde sin él. */
  private readonly breaker: CircuitBreaker;

  constructor(private readonly opts: GroqAgentOptions) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 60_000, ...(opts.now ? { now: opts.now } : {}) });
  }

  get available(): boolean {
    return !!this.opts.apiKey && this.breaker.state !== 'open';
  }

  async run({ message, history, toolbox, context, signal }: DesignAgentInput): Promise<DesignAgentResult> {
    if (!this.opts.apiKey) throw new AgentUnavailableError('Sin GROQ_API_KEY');
    const scene = toolbox.run('get_scene', {}).content;
    const recent = history.slice(-2).map((h) => h.text);
    const tools = buildGroqTools(selectGroqTools([...recent, message].join('\n')));
    const messages: Message[] = [
      { role: 'system', content: `${DESIGN_SYSTEM_PROMPT}\n- Usa solo las herramientas que tienes en esta conversación; si lo pedido necesita otra, dilo.
- Tienes pocas vueltas: en cada respuesta haz a la vez todas las llamadas que puedas (buscar varias piezas juntas, agregarlas juntas) y termina en cuanto esté hecho.` },
      ...historyToMessages(history).map((m) => ({ role: m.role, content: m.content as string }) as Message),
      { role: 'user', content: `Tipo de cuarto: ${context.roomType}. Estilo elegido: ${context.styleId ?? 'ninguno'}.\n<escena>\n${scene}\n</escena>\n\n${message}` },
    ];
    const maxTurns = this.opts.maxToolTurns ?? 6;
    const waitBudget = { leftMs: MID_LOOP_WAIT_BUDGET_MS };
    for (let turn = 0; ; turn++) {
      const last = turn + 1 >= maxTurns;
      let completion: Completion;
      try {
        completion = await this.call(messages, tools, signal, !last, turn > 0 ? waitBudget : null);
      } catch (err) {
        // En la vuelta final (sin herramientas) el modelo a veces insiste en llamar una y Groq lo
        // rechaza: lo ya hecho vale, así que se conserva con un resumen genérico.
        if (last && err instanceof ToolUseRejectedError && toolbox.operations().length > 0) {
          return { reply: 'Listo: apliqué los cambios que pude. Si falta algo, pídemelo de nuevo.' };
        }
        throw err;
      }
      const choice = completion.choices[0];
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

  /** `waitBudget` null = primera vuelta: un 429 no se espera. */
  private async call(messages: Message[], tools: GroqTool[], signal: AbortSignal | undefined, withTools: boolean, waitBudget: { leftMs: number } | null): Promise<Completion> {
    for (;;) {
      try {
        return await this.request(messages, tools, signal, withTools);
      } catch (err) {
        if (!(err instanceof RateLimitedError)) throw err;
        const wait = err.waitMs;
        if (!waitBudget || wait > waitBudget.leftMs || signal?.aborted) {
          this.breaker.failure(); // solo cuenta el 429 al que se renuncia, no cada espera
          throw err;
        }
        waitBudget.leftMs -= wait;
        await this.sleep(wait);
      }
    }
  }

  private async request(messages: Message[], tools: GroqTool[], signal: AbortSignal | undefined, withTools: boolean): Promise<Completion> {
    // max_tokens cuenta contra la cuota por minuto aunque no se use: se pide lo justo.
    const reasoning = isReasoningModel(this.opts.model);
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
          tools,
          tool_choice: withTools ? 'auto' : 'none',
          temperature: 0.2,
          max_tokens: reasoning ? 700 : 1024,
          ...(reasoning ? { reasoning_effort: 'low' } : {}),
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
      const detail = `Groq respondió ${res.status}: ${(await res.text()).slice(0, 400)}`;
      const wait = res.status === 429 ? retryAfterMs(res.headers.get('retry-after')) : null;
      if (wait !== null) throw new RateLimitedError(detail, wait); // call() decide si cuenta
      if (res.status !== 400) this.breaker.failure();
      throw detail.includes('tool_use_failed') ? new ToolUseRejectedError(detail) : new AgentUnavailableError(detail);
    }
    this.breaker.success();
    return (await res.json()) as Completion;
  }
}

type GroqTool = ReturnType<typeof buildGroqTools>[number];

/** 400 tool_use_failed: el modelo llamó una herramienta prohibida o mal formada. */
class ToolUseRejectedError extends AgentUnavailableError {}

/** 429 con `retry-after`: sigue siendo "agente no disponible" para la cascada. */
class RateLimitedError extends AgentUnavailableError {
  constructor(
    message: string,
    readonly waitMs: number,
  ) {
    super(message);
  }
}
