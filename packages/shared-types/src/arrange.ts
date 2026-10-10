/**
 * Alinear y distribuir varios muebles a la vez (lógica pura): dadas sus cajas en planta, cuánto
 * hay que correr cada uno. Quien lo usa decide después si el resultado cabe en el cuarto.
 */
import type { Point2 } from './polygon.js';
import type { SnapBox } from './snapping.js';

export interface ArrangeBox extends SnapBox {
  id: string;
}

/** Con qué se alinean: un borde común o el centro, en cada eje del plano. */
export type AlignMode = 'left' | 'centre-x' | 'right' | 'back' | 'centre-z' | 'front';

export const ALIGN_LABELS: Record<AlignMode, string> = {
  left: 'Alinear a la izquierda',
  'centre-x': 'Centrar en horizontal',
  right: 'Alinear a la derecha',
  back: 'Alinear al fondo',
  'centre-z': 'Centrar en vertical',
  front: 'Alinear al frente',
};

const none = (boxes: readonly ArrangeBox[]) => new Map<string, Point2>(boxes.map((b) => [b.id, { x: 0, z: 0 }]));

/**
 * Cuánto mover cada caja para alinearlas. Los bordes se alinean con el más extremo del grupo (a
 * la izquierda, con la que está más a la izquierda); los centros, con el centro del conjunto.
 */
export function alignDeltas(boxes: readonly ArrangeBox[], mode: AlignMode): Map<string, Point2> {
  const out = none(boxes);
  if (boxes.length < 2) return out;
  const minX = Math.min(...boxes.map((b) => b.minX));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const minZ = Math.min(...boxes.map((b) => b.minZ));
  const maxZ = Math.max(...boxes.map((b) => b.maxZ));
  for (const b of boxes) {
    const delta = out.get(b.id)!;
    if (mode === 'left') delta.x = minX - b.minX;
    else if (mode === 'right') delta.x = maxX - b.maxX;
    else if (mode === 'centre-x') delta.x = (minX + maxX) / 2 - (b.minX + b.maxX) / 2;
    else if (mode === 'back') delta.z = minZ - b.minZ;
    else if (mode === 'front') delta.z = maxZ - b.maxZ;
    else delta.z = (minZ + maxZ) / 2 - (b.minZ + b.maxZ) / 2;
  }
  return out;
}

/**
 * Cuánto mover cada caja para que queden con la misma separación entre ellas a lo largo de un eje.
 * Las dos de los extremos no se mueven; hacen falta al menos tres.
 */
export function distributeDeltas(boxes: readonly ArrangeBox[], axis: 'x' | 'z'): Map<string, Point2> {
  const out = none(boxes);
  if (boxes.length < 3) return out;
  const lo = (b: ArrangeBox) => (axis === 'x' ? b.minX : b.minZ);
  const hi = (b: ArrangeBox) => (axis === 'x' ? b.maxX : b.maxZ);
  const sorted = [...boxes].sort((a, b) => lo(a) + hi(a) - (lo(b) + hi(b)));
  const span = hi(sorted.at(-1)!) - lo(sorted[0]!);
  const occupied = sorted.reduce((sum, b) => sum + (hi(b) - lo(b)), 0);
  const gap = (span - occupied) / (sorted.length - 1);
  let cursor = lo(sorted[0]!);
  for (const b of sorted) {
    out.get(b.id)![axis] = cursor - lo(b);
    cursor += hi(b) - lo(b) + gap;
  }
  return out;
}
