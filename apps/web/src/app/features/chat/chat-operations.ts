/**
 * Traduce las operaciones del asistente a UN comando del editor (MacroCommand): un Ctrl+Z
 * deshace todo lo que hizo la IA en ese mensaje. Puro (sin Angular): se prueba sin navegador.
 *
 * Las medidas del cuarto no son un comando local: se aplican antes en el servidor
 * (PUT /room), así que vienen aparte en `room`. Lo mismo el Brief (se guarda aparte, no se
 * deshace con la escena) y el pedido de Recomendar, que se hace al final.
 */
import type { DesignBrief, DesignOperation, RecommendIntensity, RoomDimensions } from '@interiores/shared-types';
import {
  AddCommand,
  MacroCommand,
  RemoveCommand,
  ReplacePlacementCommand,
  SetFinishesCommand,
  SetRoomCommand,
  type SceneCommand,
  type SceneState,
} from '../viewport-3d/commands';

/** Etiqueta del paso de deshacer que deja el asistente. */
export const CHAT_COMMAND_LABEL = 'Cambios del asistente';

export interface ChatPlan {
  /** null si no hay cambios de escena. */
  command: MacroCommand | null;
  /** Piezas agregadas o modificadas (para resaltarlas). */
  touched: string[];
  /** Cambiaron las zonas (un baño nuevo): hay que redistribuir los muebles. */
  zonesChanged: boolean;
}

/** Medidas nuevas del cuarto, si el asistente las cambió. */
export function roomFromOperations(ops: readonly DesignOperation[]): RoomDimensions | null {
  const room = ops.find((o) => o.op === 'room');
  return room ? { widthM: room.widthM, depthM: room.depthM, heightM: room.heightM } : null;
}

/** El Brief nuevo, si el asistente fijó o pidió algo. */
export function briefFromOperations(ops: readonly DesignOperation[]): DesignBrief | null {
  const brief = [...ops].reverse().find((o) => o.op === 'brief');
  return brief?.op === 'brief' ? brief.brief : null;
}

/** Si el asistente pidió una propuesta de Recomendar al terminar, con qué intensidad. */
export function recommendFromOperations(ops: readonly DesignOperation[]): RecommendIntensity | null {
  const rec = [...ops].reverse().find((o) => o.op === 'recommend');
  return rec?.op === 'recommend' ? rec.intensity : null;
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
  let zonesChanged = false;
  for (const op of ops) {
    switch (op.op) {
      case 'room':
      case 'brief':
      case 'recommend':
        break;
      case 'zones': {
        if (!state.shell) break;
        // Va antes que los remove (el orden de las operaciones lo garantiza): solo cambia la planta.
        const room = { shell: state.shell, placements: state.placements };
        commands.push(new SetRoomCommand(CHAT_COMMAND_LABEL, room, { ...room, shell: { ...state.shell, zones: op.zones } }));
        zonesChanged = true;
        break;
      }
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
  return { command: commands.length ? new MacroCommand(CHAT_COMMAND_LABEL, commands) : null, touched, zonesChanged };
}
