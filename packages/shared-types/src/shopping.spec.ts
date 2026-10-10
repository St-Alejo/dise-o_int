import { describe, expect, it } from 'vitest';
import type { CatalogItem, FurniturePlacement } from './domain.js';
import { shoppingCsv, shoppingRows } from './shopping.js';

const item = (id: string, name: string, category: CatalogItem['category'], price: number | undefined, extra: Partial<CatalogItem> = {}): CatalogItem =>
  ({ id, name, category, mount: 'floor', dimensionsM: { x: 1, y: 1, z: 1 }, styleTags: [], roomTypes: [], currency: 'USD', ...(price === undefined ? {} : { price }), ...extra }) as unknown as CatalogItem;

const catalog = new Map<string, CatalogItem>([
  ['silla', item('silla', 'Silla de roble', 'chair', 120, { productUrl: 'https://tienda.test/silla' })],
  ['mesa', item('mesa', 'Mesa "grande"; 6 puestos', 'table', 480.5)],
  ['planta', item('planta', '=Planta', 'decor', undefined)],
]);
const piece = (id: string, catalogItemId: string, extra: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id,
  catalogItemId,
  position: { x: 1, y: 0, z: 1 },
  rotationY: 0,
  lockedByUser: false,
  ...extra,
});

describe('lista de compras', () => {
  const placements = [piece('a', 'silla'), piece('b', 'silla'), piece('c', 'mesa'), piece('d', 'silla', { dimensionsM: { x: 0.5, y: 1, z: 0.5 } }), piece('e', 'planta'), piece('f', 'no-existe')];

  it('agrupa las piezas iguales y separa las que tienen otra medida', () => {
    const rows = shoppingRows(placements, catalog);
    expect(rows.map((r) => [r.name, r.quantity, r.variant])).toEqual([
      ['=Planta', 1, null],
      ['Mesa "grande"; 6 puestos', 1, null],
      ['Silla de roble', 2, null],
      ['Silla de roble', 1, '50 × 50 × 100 cm'],
    ]);
  });

  it('el CSV se abre bien en una hoja de cálculo en español', () => {
    const csv = shoppingCsv(shoppingRows(placements, catalog));
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Mueble;Categoría;Detalle;Cantidad;Precio unitario;Subtotal;Moneda;Enlace');
    // Las comillas y el punto y coma del nombre no rompen las columnas.
    expect(lines[2]).toBe('"Mesa ""grande""; 6 puestos";Mesas;;1;480,50;480,50;USD;');
    expect(lines[3]).toBe('Silla de roble;Sillas;;2;120,00;240,00;USD;https://tienda.test/silla');
    // Un nombre que empieza por "=" no se ejecuta como fórmula; sin precio, las celdas van vacías.
    expect(lines[1]).toBe("'=Planta;Decoración;;1;;;USD;");
    expect(lines.at(-1)).toBe('Total;;;5;;840,50;USD;');
  });

  it('un cuarto vacío da solo la cabecera y un total en cero', () => {
    expect(shoppingCsv([]).slice(1).trimEnd().split('\r\n')).toEqual(['Mueble;Categoría;Detalle;Cantidad;Precio unitario;Subtotal;Moneda;Enlace', 'Total;;;0;;0,00;;']);
  });
});
