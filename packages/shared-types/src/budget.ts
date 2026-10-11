/**
 * Presupuesto del cuarto (lógica pura): cuánto suma cada categoría y cómo va el total respecto al
 * tope que se puso la persona.
 */
import type { CatalogCategory, CatalogItem, FurniturePlacement } from './domain.js';
import { CATEGORY_LABELS_ES } from './shopping.js';

export interface CategoryTotal {
  category: CatalogCategory;
  label: string;
  pieces: number;
  total: number;
  /** Parte del total del cuarto, de 0 a 1. */
  share: number;
}

/** Total por categoría, de la más cara a la más barata. Lo que no tiene precio no cuenta. */
export function totalsByCategory(
  placements: readonly Pick<FurniturePlacement, 'catalogItemId'>[],
  catalog: ReadonlyMap<string, Pick<CatalogItem, 'category' | 'price'>>,
): CategoryTotal[] {
  const totals = new Map<CatalogCategory, { pieces: number; total: number }>();
  for (const placement of placements) {
    const item = catalog.get(placement.catalogItemId);
    if (!item?.price) continue;
    const entry = totals.get(item.category) ?? { pieces: 0, total: 0 };
    entry.pieces++;
    entry.total += item.price;
    totals.set(item.category, entry);
  }
  const sum = [...totals.values()].reduce((acc, t) => acc + t.total, 0);
  return [...totals.entries()]
    .map(([category, t]) => ({ category, label: CATEGORY_LABELS_ES[category], pieces: t.pieces, total: t.total, share: sum ? t.total / sum : 0 }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'es'));
}

export type BudgetLevel = 'none' | 'ok' | 'near' | 'over';

export interface BudgetStatus {
  level: BudgetLevel;
  /** Lo que queda (positivo) o lo que se pasa (negativo); 0 sin tope. */
  remaining: number;
  /** Parte del tope ya gastada, sin límite superior (1,2 = un 20 % por encima). */
  used: number;
}

/** A partir de qué parte del tope se avisa de que queda poco. */
export const BUDGET_NEAR = 0.9;

/** Cómo va el total respecto al tope; sin tope (o con uno que no es un número positivo), no se juzga. */
export function budgetStatus(total: number, cap: number | null): BudgetStatus {
  if (cap === null || !Number.isFinite(cap) || cap <= 0) return { level: 'none', remaining: 0, used: 0 };
  const used = total / cap;
  return { level: used > 1 ? 'over' : used >= BUDGET_NEAR ? 'near' : 'ok', remaining: cap - total, used };
}
