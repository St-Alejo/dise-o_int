/**
 * Contrato del chat de diseño: lo que pide el usuario y las operaciones ya resueltas (con
 * coordenadas válidas) que devuelve el agente. El servidor NO guarda nada: la web aplica las
 * operaciones como un solo comando (un Ctrl+Z deshace todo lo que hizo la IA).
 */
import { z } from 'zod';
import { FurniturePlacementSchema, RoomFinishesSchema } from './domain.js';
import { RoomDimensionsSchema } from './api.js';

export const DesignOperationSchema = z.discriminatedUnion('op', [
  /** Cambia las medidas del cuarto (la web lo aplica primero, con PUT /room). */
  RoomDimensionsSchema.extend({ op: z.literal('room') }),
  z.object({ op: z.literal('finishes'), finishes: RoomFinishesSchema }),
  z.object({ op: z.literal('add'), placement: FurniturePlacementSchema }),
  /** Estado final completo de una pieza existente. */
  z.object({ op: z.literal('update'), placement: FurniturePlacementSchema }),
  z.object({ op: z.literal('remove'), id: z.string().min(1).max(64) }),
]);
export type DesignOperation = z.infer<typeof DesignOperationSchema>;

export const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(2000),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

/** `POST /projects/:id/chat` */
export const ChatRequestSchema = z.object({
  revision: z.number().int().nonnegative(),
  message: z.string().trim().min(1, 'Escribe un mensaje').max(500),
  /** Conversación previa (solo texto), para que "ponla más cerca" sepa de qué se habla. */
  history: z.array(ChatTurnSchema).max(20).default([]),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatAgentKindSchema = z.enum(['claude', 'rules']);
export type ChatAgentKind = z.infer<typeof ChatAgentKindSchema>;

export const ChatResponseSchema = z.object({
  reply: z.string(),
  operations: z.array(DesignOperationSchema).max(100),
  /** Qué agente respondió (sin API key, o si Claude falla, responde el de reglas). */
  agent: ChatAgentKindSchema,
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
