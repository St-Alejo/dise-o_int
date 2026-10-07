/** Lógica pura de los acabados del cuarto (sin Angular). */
import { finishesForStyle, wallMaterialId, type RoomFinishes, type StyleId } from '@interiores/shared-types';

export type FinishSurface = 'floor' | 'ceiling' | 'wall';
/** Pared concreta o 'all' (todas las que no tengan una propia). */
export type WallTarget = string;

/** Acabados vigentes: los guardados o, si no hay, la paleta del estilo (o los neutros). */
export function effectiveFinishes(saved: RoomFinishes | null, styleId: StyleId | null): RoomFinishes {
  return saved ?? finishesForStyle(styleId);
}

/**
 * Acabados con un material cambiado. Al pintar "todas" las paredes se quitan los colores propios
 * de cada pared (lo esperado al elegir "todas"); una pared igual a "todas" no guarda excepción.
 */
export function withFinish(current: RoomFinishes, surface: FinishSurface, materialId: string, wall: WallTarget = 'all'): RoomFinishes {
  if (surface === 'floor') return { ...current, floor: materialId };
  if (surface === 'ceiling') return { ...current, ceiling: materialId };
  if (wall === 'all') return { ...current, walls: { all: materialId } };
  const walls = { ...current.walls };
  if (materialId === (walls['all'] ?? undefined)) delete walls[wall];
  else walls[wall] = materialId;
  return { ...current, walls };
}

/** Material actual de una superficie (para marcar la muestra elegida). */
export function selectedMaterial(current: RoomFinishes, surface: FinishSurface, wall: WallTarget = 'all'): string {
  if (surface === 'floor') return current.floor;
  if (surface === 'ceiling') return current.ceiling;
  return wall === 'all' ? (current.walls['all'] ?? '') : wallMaterialId(current, { id: wall });
}

export function sameFinishes(a: RoomFinishes | null, b: RoomFinishes | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
