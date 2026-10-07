import { describe, expect, it } from 'vitest';
import { CatalogQuerySchema } from './api.js';
import {
  decodeCursor,
  encodeCursor,
  normalizeText,
  paginate,
  searchCatalog,
  similarity,
  stem,
  tokenize,
  type SearchableItem,
} from './catalog-search.js';

const item = (over: Partial<SearchableItem> & Pick<SearchableItem, 'id' | 'name' | 'category'>): SearchableItem => ({
  styleTags: [],
  roomTypes: ['living'],
  mount: 'floor',
  dimensionsM: { x: 1, y: 1, z: 1 },
  tags: [],
  synonyms: [],
  ...over,
});

const CATALOG: SearchableItem[] = [
  item({ id: 'lampara-mesa', name: 'Lámpara de mesa cerámica', category: 'lighting', subcategory: 'table-lamp', mount: 'surface', tags: ['lampara', 'velador'], synonyms: ['table lamp'], price: 60, dimensionsM: { x: 0.3, y: 0.5, z: 0.3 } }),
  item({ id: 'lampara-pie', name: 'Lámpara de pie arco', category: 'lighting', subcategory: 'floor-lamp', tags: ['lampara'], synonyms: ['floor lamp'], price: 180 }),
  item({ id: 'colgante', name: 'Colgante de ratán', category: 'lighting', subcategory: 'pendant', mount: 'ceiling', price: 90 }),
  item({ id: 'mesa-centro', name: 'Mesa de centro de roble', category: 'table', subcategory: 'coffee-table', styleTags: ['escandinavo'], price: 250, dimensionsM: { x: 1.1, y: 0.4, z: 0.6 } }),
  item({ id: 'mesa-comedor', name: 'Mesa de comedor extensible', category: 'table', subcategory: 'dining-table', roomTypes: ['dining'], price: 600, dimensionsM: { x: 1.8, y: 0.75, z: 0.9 } }),
  item({ id: 'sillon', name: 'Sillón de terciopelo verde', category: 'sofa', tags: ['sofa'], synonyms: ['couch'], price: 900, dimensionsM: { x: 2.2, y: 0.8, z: 0.9 } }),
  item({ id: 'armario', name: 'Armario de 3 puertas', category: 'storage', subcategory: 'wardrobe', synonyms: ['closet', 'ropero'], roomTypes: ['bedroom'], price: 700 }),
  item({ id: 'muebles-tv', name: 'Mueble TV bajo', category: 'storage', subcategory: 'tv-stand', price: 300 }),
];

const ids = (q: Parameters<typeof searchCatalog>[1]) => searchCatalog(CATALOG, q).map((r) => r.item.id);

describe('normalización', () => {
  it('quita acentos, mayúsculas y signos', () => {
    expect(normalizeText('  LÁMPARA, de Pié! ')).toBe('lampara de pie');
  });

  it('singulares en español e inglés', () => {
    expect(stem('lamparas')).toBe('lampara');
    expect(stem('luces')).toBe('luz');
    expect(stem('sillones')).toBe('sillon');
    expect(stem('muebles')).toBe('mueble');
    expect(stem('tables')).toBe('table');
    expect(stem('lamps')).toBe('lamp');
    expect(stem('mesa')).toBe('mesa');
  });

  it('descarta palabras vacías', () => {
    expect(tokenize('una lámpara para la mesa')).toEqual(['lampara', 'mesa']);
  });

  it('similitud de trigramas tolera errores de tipeo', () => {
    expect(similarity('lampara', 'lampra')).toBeGreaterThan(0.42);
    expect(similarity('lampara', 'sillon')).toBeLessThan(0.2);
  });
});

describe('searchCatalog', () => {
  it('sin acentos, en plural o en inglés encuentra lo mismo', () => {
    for (const q of ['lámpara', 'LAMPARAS', 'lamp', 'lamps']) {
      const found = ids({ q });
      expect(found, q).toContain('lampara-mesa');
      expect(found, q).toContain('lampara-pie');
    }
  });

  it('todas las palabras deben coincidir y el nombre pesa más que las etiquetas', () => {
    expect(ids({ q: 'lámpara de mesa' })[0]).toBe('lampara-mesa');
    expect(ids({ q: 'lampara pie' })).toEqual(['lampara-pie']);
  });

  it('los sinónimos de categoría encuentran ítems sin etiquetas propias', () => {
    expect(ids({ q: 'luz' })).toContain('colgante'); // "luz" → iluminación
    // El sinónimo propio del armario pesa más que el de la categoría (almacenaje).
    expect(ids({ q: 'closet' })[0]).toBe('armario');
    expect(ids({ q: 'couch' })).toEqual(['sillon']);
  });

  it('tolera errores de tipeo', () => {
    expect(ids({ q: 'lampra' })).toContain('lampara-mesa');
    expect(ids({ q: 'armari' })).toContain('armario');
  });

  it('combina texto y filtros (categoría, estilo, montaje, ancho y precio)', () => {
    expect(ids({ q: 'mesa', category: 'table' })).toEqual(expect.arrayContaining(['mesa-centro', 'mesa-comedor']));
    expect(ids({ q: 'mesa', category: 'table', maxWidthM: 1.2 })).toEqual(['mesa-centro']);
    expect(ids({ style: 'escandinavo' })).toEqual(['mesa-centro']);
    expect(ids({ mount: 'surface' })).toEqual(['lampara-mesa']);
    expect(ids({ category: 'lighting', maxPrice: 100 })).toEqual(expect.arrayContaining(['lampara-mesa', 'colgante']));
    expect(ids({ category: 'lighting', maxPrice: 100 })).not.toContain('lampara-pie');
  });

  it('sin texto ordena por categoría y nombre (estable para paginar)', () => {
    const all = searchCatalog(CATALOG, {}).map((r) => r.item);
    const sorted = [...all].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'es'));
    expect(all).toEqual(sorted);
  });

  it('una búsqueda sin coincidencias devuelve vacío', () => {
    expect(ids({ q: 'nave espacial' })).toEqual([]);
  });
});

describe('paginación', () => {
  it('recorre todos los resultados sin repetir ni saltar', () => {
    const all = searchCatalog(CATALOG, {}).map((r) => r.item.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = paginate(all, 3, cursor);
      expect(page.total).toBe(all.length);
      seen.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(all);
  });

  it('cursores opacos y validados', () => {
    expect(decodeCursor(encodeCursor(37))).toBe(37);
    expect(decodeCursor(undefined)).toBe(0);
    expect(() => decodeCursor('hack')).toThrow(RangeError);
  });

  it('el schema convierte los parámetros de la URL', () => {
    const q = CatalogQuerySchema.parse({ maxWidthM: '1.5', maxPrice: '200', limit: '10' });
    expect(q).toMatchObject({ maxWidthM: 1.5, maxPrice: 200, limit: 10 });
    expect(CatalogQuerySchema.parse({}).limit).toBe(24);
    expect(CatalogQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});
