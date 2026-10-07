/**
 * Lógica pura del inspector (sin Angular): qué medidas se pueden cambiar, cómo queda la pieza
 * con un tamaño nuevo (reubicada para que siga cabiendo y pegada a su pared o soporte) y por qué
 * no se permite cuando no cabe.
 */
import {
  clampDimensions,
  clampToRoom,
  effectiveDimensions,
  mountY,
  type CatalogItem,
  type FurniturePlacement,
  type ResizeRanges,
  type RoomShell,
  type Vector3,
} from '@interiores/shared-types';
import { wallFrames } from '../viewport-3d/mounts/mount-strategies';

export type Axis = 'x' | 'y' | 'z';
export const AXES: readonly { axis: Axis; label: string }[] = [
  { axis: 'x', label: 'Ancho' },
  { axis: 'z', label: 'Fondo' },
  { axis: 'y', label: 'Alto' },
];

/** Rangos permitidos (los del catálogo; sin rangos, la pieza no se redimensiona). */
export function resizeRanges(item: CatalogItem): ResizeRanges {
  return item.resize ?? {};
}

export function isResizable(item: CatalogItem): boolean {
  const r = resizeRanges(item);
  return !!(r.x || r.y || r.z);
}

/**
 * Medidas nuevas al cambiar un eje. Con `keepRatio`, los demás ejes redimensionables se escalan en
 * la misma proporción; todo queda dentro de los rangos del catálogo.
 */
export function nextDimensions(item: CatalogItem, current: Vector3, axis: Axis, valueM: number, keepRatio: boolean): Vector3 {
  const ranges = resizeRanges(item);
  const wanted = { ...current, [axis]: valueM };
  if (keepRatio && current[axis] > 0) {
    const f = valueM / current[axis];
    for (const a of ['x', 'y', 'z'] as const) if (a !== axis && ranges[a]) wanted[a] = current[a] * f;
  }
  return clampDimensions(wanted, item.dimensionsM, ranges);
}

export interface ResizeContext {
  shell: RoomShell;
  isPoseValid: (id: string, itemId: string, pos: Vector3, rotationY: number, dims: Vector3) => boolean;
  /** Tope (y) del soporte de una pieza apoyada. */
  supportTopOf: (placement: FurniturePlacement) => number | null;
}

export interface ResizeProposal {
  dims: Vector3;
  position: Vector3;
  error: string | null;
  /** Por qué no cabe: en su lugar choca (se puede buscar otro hueco) o no pasa bajo el techo. */
  reason: 'collision' | 'ceiling' | null;
}

/**
 * Dónde queda la pieza con medidas nuevas: dentro del cuarto, a la altura de su montaje y, si
 * está colgada, pegada a su pared. Si choca, se explica.
 */
export function proposeResize(ctx: ResizeContext, p: FurniturePlacement, item: CatalogItem, dims: Vector3): ResizeProposal {
  const { shell } = ctx;
  let position = clampToRoom(p.position, dims, p.rotationY, shell);
  if (item.mount === 'wall' && p.wallId) {
    const wall = wallFrames(shell).find((w) => w.id === p.wallId);
    if (wall) {
      const offset = wall.fixed + wall.inward * (dims.z / 2 + 0.001);
      position = wall.along === 'x' ? { ...position, z: offset } : { ...position, x: offset };
    }
  }
  const y =
    item.mount === 'surface'
      ? (ctx.supportTopOf(p) ?? 0)
      : mountY(item.mount, dims, shell, { elevationM: p.elevationM ?? p.position.y, elevationDefaultM: item.elevationDefaultM });
  position = { ...position, y };
  if (position.y + dims.y > shell.heightM + 1e-6) {
    return { dims, position, error: `Con ${cm(dims.y)} de alto no cabe bajo el techo (${cm(shell.heightM)}).`, reason: 'ceiling' };
  }
  if (!ctx.isPoseValid(p.id, p.catalogItemId, position, p.rotationY, dims)) {
    return { dims, position, error: 'Con esas medidas choca con otro mueble o se sale del cuarto.', reason: 'collision' };
  }
  return { dims, position, error: null, reason: null };
}

/** Altura máxima de la base de un objeto de pared (que no atraviese el techo). */
export function elevationRange(shell: RoomShell, dims: Vector3): [number, number] {
  return [0, Math.max(0, shell.heightM - dims.y)];
}

export function cm(m: number): string {
  return `${Math.round(m * 100)} cm`;
}

/** Medidas actuales de la pieza. */
export function currentDimensions(item: CatalogItem, p: FurniturePlacement): Vector3 {
  return effectiveDimensions(item.dimensionsM, p);
}

/** ¿Las medidas propias son iguales a las del catálogo? (entonces no hace falta guardarlas). */
export function sameAsCatalog(item: CatalogItem, dims: Vector3): boolean {
  const d = item.dimensionsM;
  return Math.abs(d.x - dims.x) < 5e-4 && Math.abs(d.y - dims.y) < 5e-4 && Math.abs(d.z - dims.z) < 5e-4;
}
