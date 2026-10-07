/**
 * Colisiones en 3D entre piezas de la escena: huella en planta (SAT) + rango vertical, por capas.
 *
 * - `floor`: muebles de piso. Excepción: lo que "cabe debajo" (sillas, taburetes) puede entrar bajo
 *   lo que "deja espacio debajo" (mesas, escritorios, islas).
 * - `rug`: alfombras; solo chocan entre sí (los muebles van encima).
 * - `ceiling`: lámparas de techo; solo entre sí.
 * - `wall`: objetos colgados; chocan solo si se solapan en planta Y en altura (dos cuadros a distinta
 *   altura en la misma pared no chocan).
 * - `surface`: objetos apoyados; solo chocan con otros sobre el MISMO soporte.
 */
import type { CatalogItem, FurniturePlacement, Vector3 } from './domain.js';
import { footprint, footprintsOverlap } from './geometry.js';

export type CollisionLayer = 'floor' | 'rug' | 'ceiling' | 'wall' | 'surface';

export interface Body {
  id: string;
  position: Vector3;
  rotationY: number;
  dims: Vector3;
  layer: CollisionLayer;
  tucksUnder?: boolean | undefined;
  allowsUnder?: boolean | undefined;
  supportId?: string | undefined;
}

export function layerOf(item: Pick<CatalogItem, 'mount' | 'subcategory'>): CollisionLayer {
  if (item.mount !== 'floor') return item.mount;
  return item.subcategory === 'rug' ? 'rug' : 'floor';
}

/** Cuerpo de colisión de una pieza colocada (con sus medidas propias si las tiene). */
export function bodyOf(
  p: Pick<FurniturePlacement, 'id' | 'position' | 'rotationY' | 'dimensionsM' | 'supportId'>,
  item: Pick<CatalogItem, 'mount' | 'subcategory' | 'dimensionsM' | 'tucksUnder' | 'allowsUnder'>,
): Body {
  return {
    id: p.id,
    position: p.position,
    rotationY: p.rotationY,
    dims: p.dimensionsM ?? item.dimensionsM,
    layer: layerOf(item),
    tucksUnder: item.tucksUnder,
    allowsUnder: item.allowsUnder,
    supportId: p.supportId,
  };
}

const verticalOverlap = (a: Body, b: Body, tolerance: number) =>
  Math.min(a.position.y + a.dims.y, b.position.y + b.dims.y) - Math.max(a.position.y, b.position.y) > tolerance;

export function bodiesCollide(a: Body, b: Body, tolerance = 0.01): boolean {
  if (a.id === b.id || a.layer !== b.layer) return false;
  if (a.layer === 'surface' && a.supportId !== b.supportId) return false;
  if (a.layer === 'floor' && ((a.tucksUnder && b.allowsUnder) || (b.tucksUnder && a.allowsUnder))) return false;
  if (!footprintsOverlap(footprint(a.position, a.dims, a.rotationY), footprint(b.position, b.dims, b.rotationY), tolerance)) return false;
  // Los de piso y techo comparten siempre su rango vertical; en pared se compara de verdad.
  return a.layer !== 'wall' || verticalOverlap(a, b, tolerance);
}

/** Primer cuerpo con el que choca `body`, o null. */
export function firstCollision(body: Body, others: readonly Body[]): Body | null {
  return others.find((o) => bodiesCollide(body, o)) ?? null;
}
