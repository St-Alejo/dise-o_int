/** Textos compartidos de la lista de compras (API, PDF y web dicen lo mismo). */
import type { CatalogCategory, CatalogItem, FurniturePlacement } from './domain.js';
import { getMaterial } from './materials.js';

export const CATEGORY_LABELS_ES: Record<CatalogCategory, string> = {
  sofa: 'Sofás',
  table: 'Mesas',
  chair: 'Sillas',
  bed: 'Camas',
  storage: 'Almacenamiento',
  lighting: 'Iluminación',
  decor: 'Decoración',
  kitchen: 'Cocina',
  bathroom: 'Baño',
  'wall-decor': 'Pared',
  textile: 'Textiles',
  electronics: 'Electrónica',
};

const cm = (m: number) => Math.round(m * 100);

/**
 * Qué tiene de particular esta pieza respecto al producto del catálogo: medidas propias
 * (ancho × fondo × alto) y materiales cambiados. null si es igual al de catálogo.
 * Dos piezas con la misma variante se agrupan en una sola línea de la lista.
 */
export function describeVariant(
  item: Pick<CatalogItem, 'dimensionsM' | 'materialSlots'>,
  p: Pick<FurniturePlacement, 'dimensionsM' | 'materials'>,
): string | null {
  const parts: string[] = [];
  const d = p.dimensionsM;
  const base = item.dimensionsM;
  if (d && (cm(d.x) !== cm(base.x) || cm(d.y) !== cm(base.y) || cm(d.z) !== cm(base.z))) {
    parts.push(`${cm(d.x)} × ${cm(d.z)} × ${cm(d.y)} cm`);
  }
  for (const slot of item.materialSlots ?? []) {
    const chosen = p.materials?.[slot.slot];
    if (chosen && chosen !== slot.default) parts.push(`${slot.label}: ${getMaterial(chosen)?.name ?? chosen}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
