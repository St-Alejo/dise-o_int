/**
 * Puerto del agente de diseño (Strategy): recibe el mensaje del usuario y una DesignToolbox
 * sobre la escena virtual; usa sus herramientas y devuelve la respuesta en texto. Los cambios
 * quedan registrados en la toolbox (el caso de uso saca de ahí las operaciones).
 */
import type { ChatAgentKind, ChatTurn, DesignToolbox, StyleId } from '@interiores/shared-types';

export interface DesignAgentInput {
  message: string;
  history: readonly ChatTurn[];
  toolbox: DesignToolbox;
  /** Tipo de cuarto y estilo elegido, para que las sugerencias tengan sentido. */
  context: { roomType: string; styleId: StyleId | null };
  signal?: AbortSignal;
}

export interface DesignAgentResult {
  reply: string;
}

export interface DesignAgent {
  readonly kind: ChatAgentKind;
  /** ¿Puede responder ahora? (Claude necesita API key). */
  readonly available: boolean;
  run(input: DesignAgentInput): Promise<DesignAgentResult>;
}

/** El agente que no pudo responder por una causa externa (red, API caída): se usa el de respaldo. */
export class AgentUnavailableError extends Error {}

/** El agente no está seguro de haber entendido (el modelo local): responde el siguiente, sin aviso. */
export class AgentDeclinedError extends Error {}

export const LOCAL_AGENT = Symbol('LocalNluDesignAgent');
export const GROQ_AGENT = Symbol('GroqDesignAgent');
export const CLAUDE_AGENT = Symbol('ClaudeDesignAgent');
export const RULES_AGENT = Symbol('RuleBasedDesignAgent');
