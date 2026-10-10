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

/** Una línea de la lista de compras: piezas iguales (mismo producto y misma variante) van juntas. */
export interface ShoppingRow {
  name: string;
  category: string;
  variant: string | null;
  quantity: number;
  unitPrice: number | null;
  currency: string;
  url: string | null;
}

/** Agrupa lo que hay en el cuarto en líneas de compra, ordenadas por categoría y nombre. */
export function shoppingRows(placements: readonly FurniturePlacement[], catalog: ReadonlyMap<string, CatalogItem>): ShoppingRow[] {
  const rows = new Map<string, ShoppingRow>();
  for (const p of placements) {
    const item = catalog.get(p.catalogItemId);
    if (!item) continue;
    const variant = describeVariant(item, p);
    const key = `${item.id}|${variant ?? ''}`;
    const row = rows.get(key);
    if (row) row.quantity += 1;
    else {
      rows.set(key, {
        name: item.name,
        category: CATEGORY_LABELS_ES[item.category],
        variant,
        quantity: 1,
        unitPrice: item.price ?? null,
        currency: item.currency ?? 'USD',
        url: item.productUrl ?? null,
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));
}

/**
 * La lista de compras como CSV para abrir en una hoja de cálculo: separado por punto y coma (el
 * que espera Excel en español), con BOM para que los acentos se lean bien y una fila de total.
 * Las celdas que empiezan por =, +, - o @ se neutralizan para que no se ejecuten como fórmulas.
 */
export function shoppingCsv(rows: readonly ShoppingRow[]): string {
  const cell = (value: string | number | null): string => {
    let text = value === null ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const money = (v: number | null) => (v === null ? '' : v.toFixed(2).replace('.', ','));
  const lines = [['Mueble', 'Categoría', 'Detalle', 'Cantidad', 'Precio unitario', 'Subtotal', 'Moneda', 'Enlace']];
  let total = 0;
  for (const r of rows) {
    const subtotal = r.unitPrice === null ? null : r.unitPrice * r.quantity;
    total += subtotal ?? 0;
    lines.push([r.name, r.category, r.variant ?? '', String(r.quantity), money(r.unitPrice), money(subtotal), r.currency, r.url ?? '']);
  }
  lines.push(['Total', '', '', String(rows.reduce((n, r) => n + r.quantity, 0)), '', money(total), rows[0]?.currency ?? '', '']);
  return `\uFEFF${lines.map((line) => line.map(cell).join(';')).join('\r\n')}\r\n`;
}
