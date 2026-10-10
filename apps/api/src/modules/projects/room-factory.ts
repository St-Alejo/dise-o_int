import { RoomGeometryError, buildRoomFromSpec, type RoomDimensions, type RoomShell, type RoomSpec } from '@interiores/shared-types';
import { ValidationError } from '../../common/errors.js';

/** Cómo arranca el cuarto de un proyecto nuevo y qué trabajo lo termina de montar. */
export interface NewRoom {
  /** Cuarto ya definido (a mano), o null si saldrá del análisis de la foto. */
  shell: RoomShell | null;
  /** Medidas exactas que dio el usuario: mandan sobre lo que se estime de la foto. */
  requestedRoom: RoomDimensions | null;
  /** Con foto se analiza; sin foto se amuebla directamente el cuarto definido. */
  firstJob: 'analyze-room' | 'build-scene';
}

interface NewRoomInput {
  hasPhoto: boolean;
  roomSpec?: RoomSpec | undefined;
  widthM?: number | undefined;
  depthM?: number | undefined;
  heightM?: number | undefined;
}

/**
 * Fábrica del cuarto inicial. Dos orígenes:
 * - **a mano** (`roomSpec`: forma, medidas y aberturas): el cuarto queda definido desde ya y la
 *   foto, si la hay, solo sirve para las propuestas de estilo;
 * - **de la foto**: el cuarto lo estima el análisis; si además se dieron medidas, se le aplican.
 */
export function newRoomFor(input: NewRoomInput): NewRoom {
  if (!input.hasPhoto && !input.roomSpec) {
    throw new ValidationError('Sube una foto del cuarto (campo "photo") o define su forma y medidas (campo "roomSpec")');
  }
  if (input.roomSpec) {
    const { widthM, depthM, heightM } = input.roomSpec;
    return { shell: shellFromSpec(input.roomSpec), requestedRoom: { widthM, depthM, heightM }, firstJob: input.hasPhoto ? 'analyze-room' : 'build-scene' };
  }
  const { widthM, depthM, heightM } = input;
  const requestedRoom = widthM !== undefined && depthM !== undefined && heightM !== undefined ? { widthM, depthM, heightM } : null;
  return { shell: null, requestedRoom, firstJob: 'analyze-room' };
}

function shellFromSpec(spec: RoomSpec): RoomShell {
  try {
    return buildRoomFromSpec(spec);
  } catch (err) {
    // Aberturas que no caben o que apuntan a una pared que la forma no tiene: es un dato del usuario.
    if (err instanceof RoomGeometryError) throw new ValidationError(err.message);
    throw err;
  }
}

/** ¿El cuarto lo definió el usuario (forma elegida) en vez de salir de la foto? */
export function isUserDefinedRoom(shell: RoomShell | null): boolean {
  return shell?.shape !== undefined;
}
