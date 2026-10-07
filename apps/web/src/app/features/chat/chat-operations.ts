/**
 * Traduce las operaciones del asistente a UN comando del editor (MacroCommand): un Ctrl+Z
 * deshace todo lo que hizo la IA en ese mensaje. Puro (sin Angular): se prueba sin navegador.
 *
 * Las medidas del cuarto no son un comando local: se aplican antes en el servidor
 * (PUT /room), así que vienen aparte en `room`.
 */
import type { DesignOperation, RoomDimensions } from '@interiores/shared-types';
import {
  AddCommand,
  MacroCommand,
  RemoveCommand,
  ReplacePlacementCommand,
  SetFinishesCommand,
  type SceneCommand,
  type SceneState,
} from '../viewport-3d/commands';

export interface ChatPlan {
  /** null si no hay cambios de escena. */
  command: MacroCommand | null;
  /** Piezas agregadas o modificadas (para resaltarlas). */
  touched: string[];
}

/** Medidas nuevas del cuarto, si el asistente las cambió. */
export function roomFromOperations(ops: readonly DesignOperation[]): RoomDimensions | null {
  const room = ops.find((o) => o.op === 'room');
  return room ? { widthM: room.widthM, depthM: room.depthM, heightM: room.heightM } : null;
}

/**
 * Comando para el estado ACTUAL del editor (tras aplicar las medidas del cuarto). Se construye
 * contra lo que hay ahora: una pieza que ya no existe se agrega; un remove de algo ya quitado se
 * ignora.
 */
export function commandFromOperations(ops: readonly DesignOperation[], state: SceneState): ChatPlan {
  const byId = new Map(state.placements.map((p) => [p.id, p]));
  const commands: SceneCommand[] = [];
  const touched: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'room':
        break;
      case 'finishes':
        commands.push(new SetFinishesCommand(state.finishes, op.finishes));
        break;
      case 'remove': {
        const current = byId.get(op.id);
        if (current) commands.push(new RemoveCommand(current));
        break;
      }
      case 'add':
      case 'update': {
        const current = byId.get(op.placement.id);
        commands.push(current ? new ReplacePlacementCommand(current, op.placement) : new AddCommand(op.placement));
        touched.push(op.placement.id);
        break;
      }
    }
  }
  return { command: commands.length ? new MacroCommand('Cambios del asistente', commands) : null, touched };
}
