/**
 * Agente con Claude (tool use, bucle manual). El modelo nunca escribe coordenadas: elige
 * herramientas de la DesignToolbox con relaciones ("junto a la cama") y el resolvedor espacial
 * hace la geometría. Cada resultado (o el motivo por el que algo no cabe) vuelve al modelo para
 * que siga, proponga otra cosa o explique.
 *
 * - Modelo por `CHAT_MODEL` (por defecto claude-opus-5-5), pensamiento adaptativo, esfuerzo medio.
 * - Herramientas `strict` (entradas que cumplen el schema) y además validadas con zod.
 * - Fallback del servidor ante un rechazo de seguridad (`fallbacks: "default"`).
 * - Si la API falla (red, 5xx, sin crédito), lanza AgentUnavailableError y el caso de uso
 *   responde con el agente por reglas.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageParam, BetaTool, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { TOOL_DESCRIPTIONS, TOOL_INPUTS, TOOL_NAMES, type ChatTurn } from '@interiores/shared-types';
import { z } from 'zod';
import { AgentUnavailableError, type DesignAgent, type DesignAgentInput, type DesignAgentResult } from './design-agent.js';

/** Lo mínimo del SDK que usa el agente (las pruebas inyectan un cliente falso). */
export interface MessagesApi {
  create(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<BetaMessage>;
}

export interface ClaudeAgentOptions {
  apiKey: string | undefined;
  model: string;
  maxToolTurns?: number;
  /** Para pruebas: sustituye al SDK real. */
  messages?: MessagesApi;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Palabras clave de JSON Schema que las herramientas `strict` no admiten (zod las valida después). */
const UNSUPPORTED = new Set(['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems']);

function sanitize(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitize);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) if (!UNSUPPORTED.has(k)) out[k] = sanitize(v);
  if (out['type'] === 'object') {
    out['additionalProperties'] = false;
    out['properties'] ??= {};
  }
  return out;
}

export function buildTools(): BetaTool[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    input_schema: sanitize(z.toJSONSchema(TOOL_INPUTS[name])) as BetaTool['input_schema'],
    strict: true,
  }));
}

const SYSTEM = `Eres el asistente de una app de diseño de interiores en 3D. El usuario te pide cambios en su cuarto en español ("pon una lámpara de pie junto al sofá", "quiero un escritorio frente a la ventana", "pinta las paredes de verde").

Cómo trabajas:
- Haz los cambios SOLO con las herramientas. Nunca inventes ids: los de piezas salen de get_scene y los del catálogo de search_catalog.
- La escena actual viene en el mensaje del usuario; vuelve a llamar get_scene solo si necesitas confirmar algo tras varios cambios.
- No calcules coordenadas: elige la relación espacial que mejor exprese lo pedido y deja que el sistema la resuelva. Si una herramienta responde que no cabe, prueba otra relación, otra pieza más pequeña o explica el motivo al usuario.
- Si el pedido es amplio ("amuebla el dormitorio", "hazlo más acogedor"), propone un conjunto razonable para el tipo de cuarto y su tamaño (pocas piezas bien elegidas, coherentes con el estilo) y aplícalo.
- Si algo es ambiguo pero hay una opción sensata, hazla y menciónala; pregunta solo si de verdad no puedes elegir.
- Al terminar, responde en español, breve (1 a 4 frases): qué cambiaste y cualquier cosa que no se pudo. Sin listas largas ni detalles técnicos (ids, coordenadas).`;

/** Historial como mensajes de texto: empieza por el usuario y alterna (fusiona turnos seguidos del mismo rol). */
export function historyToMessages(history: readonly ChatTurn[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const turn of history) {
    if (!turn.text.trim()) continue;
    if (out.length === 0 && turn.role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content as string}\n\n${turn.text}`;
    else out.push({ role: turn.role, content: turn.text });
  }
  // El mensaje nuevo es del usuario: el historial debe terminar en el asistente.
  if (out[out.length - 1]?.role === 'user') out.pop();
  return out;
}

export class ClaudeDesignAgent implements DesignAgent {
  readonly kind = 'claude' as const;
  private readonly messages: MessagesApi | null;
  private readonly tools = buildTools();

  constructor(private readonly opts: ClaudeAgentOptions) {
    this.messages = opts.messages ?? (opts.apiKey ? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 90_000 }).beta.messages : null);
  }

  get available(): boolean {
    return this.messages !== null;
  }

  async run({ message, history, toolbox, context, signal }: DesignAgentInput): Promise<DesignAgentResult> {
    if (!this.messages) throw new AgentUnavailableError('Sin ANTHROPIC_API_KEY');
    const scene = toolbox.run('get_scene', {}).content;
    const messages: BetaMessageParam[] = [
      ...historyToMessages(history),
      {
        role: 'user',
        content: `Tipo de cuarto: ${context.roomType}. Estilo elegido: ${context.styleId ?? 'ninguno'}.\n<escena>\n${scene}\n</escena>\n\n${message}`,
      },
    ];
    const maxTurns = this.opts.maxToolTurns ?? 8;

    for (let turn = 0; ; turn++) {
      const response = await this.call(messages, signal);
      if (response.stop_reason === 'refusal') {
        return { reply: 'No puedo ayudar con eso. Pídeme cambios de muebles, medidas o acabados del cuarto.' };
      }
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        return { reply: textOf(response) || 'Listo.' };
      }
      // Se devuelve el turno tal cual (incluye los bloques de pensamiento, que deben volver intactos).
      messages.push({ role: 'assistant', content: response.content });
      const results: BetaToolResultBlockParam[] = toolUses.map((block) => {
        const out = toolbox.run(block.name, block.input);
        return { type: 'tool_result', tool_use_id: block.id, content: out.content, ...(out.ok ? {} : { is_error: true }) };
      });
      if (turn + 1 >= maxTurns) {
        // Tope de vueltas: se cierran los tool_use pendientes y se pide el resumen final sin más herramientas.
        messages.push({ role: 'user', content: [...results, { type: 'text', text: 'Alcanzaste el máximo de pasos: no uses más herramientas y resume al usuario lo que hiciste.' }] });
        const last = await this.call(messages, signal, false);
        return { reply: textOf(last) || 'Hice parte de los cambios; pídeme el resto en otro mensaje.' };
      }
      messages.push({ role: 'user', content: results });
    }
  }

  private async call(messages: BetaMessageParam[], signal: AbortSignal | undefined, withTools = true): Promise<BetaMessage> {
    try {
      return await this.messages!.create(
        {
          model: this.opts.model,
          max_tokens: 16_000,
          system: SYSTEM,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          // Las herramientas siempre se declaran (el historial tiene tool_use); al cerrar se prohíben con tool_choice.
          tools: this.tools,
          tool_choice: withTools ? { type: 'auto' } : { type: 'none' },
          messages,
        },
        signal ? { signal } : undefined,
      );
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) throw err;
      if (err instanceof Anthropic.APIError) {
        throw new AgentUnavailableError(`Claude no respondió (${err.status ?? 'red'}): ${err.message}`);
      }
      throw err;
    }
  }
}

function textOf(message: BetaMessage): string {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
