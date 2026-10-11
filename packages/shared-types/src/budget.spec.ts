import { describe, expect, it } from 'vitest';
import { budgetStatus, totalsByCategory } from './budget.js';

const catalog = new Map([
  ['sofa', { category: 'sofa' as const, price: 900 }],
  ['silla', { category: 'chair' as const, price: 100 }],
  ['lampara', { category: 'lighting' as const, price: 100 }],
  ['regalo', { category: 'decor' as const }],
]);
const pieces = (...ids: string[]) => ids.map((catalogItemId) => ({ catalogItemId }));

describe('totalsByCategory', () => {
  it('suma por categoría, de la más cara a la más barata, con su parte del total', () => {
    const totals = totalsByCategory(pieces('silla', 'sofa', 'silla', 'lampara'), catalog);
    expect(totals.map((t) => [t.label, t.pieces, t.total])).toEqual([
      ['Sofás', 1, 900],
      ['Sillas', 2, 200],
      ['Iluminación', 1, 100],
    ]);
    expect(totals[0]!.share).toBeCloseTo(0.75);
    expect(totals.reduce((sum, t) => sum + t.share, 0)).toBeCloseTo(1);
  });

  it('lo que no tiene precio o no está en el catálogo no cuenta', () => {
    expect(totalsByCategory(pieces('regalo', 'no-existe'), catalog)).toEqual([]);
  });
});

describe('budgetStatus', () => {
  it('sin tope no se juzga', () => {
    expect(budgetStatus(500, null).level).toBe('none');
    expect(budgetStatus(500, 0).level).toBe('none');
    expect(budgetStatus(500, Number.NaN).level).toBe('none');
  });

  it('va bien, queda poco o se pasó, y dice por cuánto', () => {
    expect(budgetStatus(500, 1000)).toEqual({ level: 'ok', remaining: 500, used: 0.5 });
    expect(budgetStatus(900, 1000).level).toBe('near');
    expect(budgetStatus(1000, 1000).level).toBe('near');
    expect(budgetStatus(1200, 1000)).toMatchObject({ level: 'over', remaining: -200 });
    expect(budgetStatus(1200, 1000).used).toBeCloseTo(1.2);
  });
});
