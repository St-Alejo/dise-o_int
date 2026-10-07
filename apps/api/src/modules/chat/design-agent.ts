/**
 * Puerto del agente de diseño (Strategy): recibe el mensaje del usuario y una DesignToolbox
 * sobre la escena virtual; usa sus herramientas y devuelve la respuesta en texto. Los cambios
 * quedan registrados en la toolbox (el caso de uso saca de ahí las operaciones).
 */
import type { ChatAgentKind, ChatTurn, DesignToolbox } from '@interiores/shared-types';

export interface DesignAgentInput {
  message: string;
  history: readonly ChatTurn[];
  toolbox: DesignToolbox;
  /** Tipo de cuarto y estilo elegido, para que las sugerencias tengan sentido. */
  context: { roomType: string; styleId: string | null };
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

export const CLAUDE_AGENT = Symbol('ClaudeDesignAgent');
export const RULES_AGENT = Symbol('RuleBasedDesignAgent');
