/**
 * Diferencia entre dos estados de un cuarto (lógica pura): qué muebles hay de más, cuáles de
 * menos y cuáles cambiaron de sitio o de forma. Sirve para comparar una versión guardada con el
 * diseño actual antes de restaurarla.
 */
import type { FurniturePlacement, RoomFinishes, RoomShell } from './domain.js';

export interface SceneSide {
  roomShell: RoomShell | null;
  furniturePlacements: readonly FurniturePlacement[];
  finishes: RoomFinishes | null;
}

export interface SceneDiff {
  /** Están en `after` y no en `before`. */
  added: FurniturePlacement[];
  /** Estaban en `before` y ya no están. */
  removed: FurniturePlacement[];
  /** Siguen, pero en otro sitio o con otro giro (se da el de `after`). */
  moved: FurniturePlacement[];
  /** Siguen en su sitio, pero con otras medidas, otros materiales u otro producto. */
  changed: FurniturePlacement[];
  roomChanged: boolean;
  finishesChanged: boolean;
  /** No hay ninguna diferencia. */
  same: boolean;
}

const MOVE_M = 0.01;
const TURN_RAD = 0.01;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function diffScenes(before: SceneSide, after: SceneSide): SceneDiff {
  const old = new Map(before.furniturePlacements.map((p) => [p.id, p]));
  const added: FurniturePlacement[] = [];
  const moved: FurniturePlacement[] = [];
  const changed: FurniturePlacement[] = [];
  for (const piece of after.furniturePlacements) {
    const was = old.get(piece.id);
    old.delete(piece.id);
    if (!was) {
      added.push(piece);
      continue;
    }
    const distance = Math.hypot(piece.position.x - was.position.x, piece.position.y - was.position.y, piece.position.z - was.position.z);
    if (distance > MOVE_M || Math.abs(piece.rotationY - was.rotationY) > TURN_RAD) moved.push(piece);
    else if (piece.catalogItemId !== was.catalogItemId || !same(piece.dimensionsM, was.dimensionsM) || !same(piece.materials, was.materials)) changed.push(piece);
  }
  const removed = [...old.values()];
  const roomChanged = !same(before.roomShell, after.roomShell);
  const finishesChanged = !same(before.finishes, after.finishes);
  return {
    added,
    removed,
    moved,
    changed,
    roomChanged,
    finishesChanged,
    same: !added.length && !removed.length && !moved.length && !changed.length && !roomChanged && !finishesChanged,
  };
}
