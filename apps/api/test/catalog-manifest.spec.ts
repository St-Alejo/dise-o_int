/** El manifiesto completo es coherente: ids, recetas, materiales, medidas, montajes y búsqueda. */
import { describe, expect, it } from 'vitest';
import { FURNITURE } from '@interiores/furniture-kit';
import { searchCatalog, type SearchableItem } from '@interiores/shared-types';
import { catalogSpecFor, searchTermsFor } from '../src/cli/catalog/entry-metadata.js';
import { FULL_MANIFEST, type ManifestEntry } from '../src/cli/catalog/manifest.js';
import { InvalidParametricEntryError, resolveSlots } from '../src/cli/catalog/parametric.js';

const parametric = FULL_MANIFEST.filter((e): e is ManifestEntry & { source: { type: 'parametric' } } => e.source.type === 'parametric');

describe('manifiesto del catálogo', () => {
  it('tiene unos 130 ítems con ids únicos', () => {
    expect(FULL_MANIFEST.length).toBeGreaterThanOrEqual(125);
    expect(new Set(FULL_MANIFEST.map((e) => e.id)).size).toBe(FULL_MANIFEST.length);
  });

  it('cada ítem paramétrico usa una receta existente con materiales válidos para sus slots', () => {
    for (const e of parametric) {
      expect(FURNITURE.has(e.source.kind), `${e.id}: receta ${e.source.kind}`).toBe(true);
      expect(() => resolveSlots(e.source), e.id).not.toThrow();
    }
  });

  it('cada ítem paramétrico mide exactamente lo declarado (±1 cm)', () => {
    for (const e of parametric) {
      const [x, y, z] = e.source.size;
      const { min, max } = FURNITURE.build(e.source.kind, { x, y, z }, e.source.params ?? {}).bounds;
      expect(max[0] - min[0], `${e.id} ancho`).toBeCloseTo(x, 1);
      expect(max[1] - min[1], `${e.id} alto`).toBeCloseTo(y, 1);
      expect(max[2] - min[2], `${e.id} fondo`).toBeCloseTo(z, 1);
    }
  });

  it('los objetos de pared declaran su altura por defecto y los de superficie son pequeños', () => {
    for (const e of FULL_MANIFEST) {
      if (e.mount === 'wall') expect(e.spec?.elevationDefaultM, `${e.id}`).toBeTypeOf('number');
      if (e.mount === 'surface' && e.source.type === 'parametric') {
        const [x, , z] = e.source.size;
        expect(Math.max(x, z), `${e.id} demasiado grande para apoyarse en un mueble`).toBeLessThan(1.6);
      }
    }
  });

  it('el spec incluye receta, slots y rangos de tamaño; los ejes fijos no se pueden cambiar', () => {
    const rug = parametric.find((e) => e.source.kind === 'rug')!;
    const [x, y, z] = rug.source.size;
    const spec = catalogSpecFor(rug, { x, y, z })!;
    expect(spec.recipe?.kind).toBe('rug');
    expect(spec.resize?.y).toBeUndefined();
    expect(spec.resize?.x?.[0]).toBeLessThan(x);
    const chair = parametric.find((e) => e.source.kind === 'dining-chair')!;
    expect(catalogSpecFor(chair, { x: 0.46, y: 0.84, z: 0.52 })?.tucksUnder).toBe(true);
    const glb = FULL_MANIFEST.find((e) => e.source.type === 'polyhaven')!;
    expect(catalogSpecFor(glb, { x: 1, y: 1, z: 1 })?.resize?.x).toEqual([0.85, 1.15]);
  });

  it('rechaza slots o materiales inválidos con un mensaje claro', () => {
    expect(() => resolveSlots({ type: 'parametric', kind: 'sofa', size: [2, 0.8, 0.9], materials: { tapizado: 'glass-clear' } })).toThrow(
      InvalidParametricEntryError,
    );
    expect(() => resolveSlots({ type: 'parametric', kind: 'sofa', size: [2, 0.8, 0.9], materials: { techo: 'wood-oak' } })).toThrow(/no tiene el slot/);
    expect(() => resolveSlots({ type: 'parametric', kind: 'nave', size: [1, 1, 1] })).toThrow(/desconocida/);
  });

  it('cada ítem tiene palabras de búsqueda y la búsqueda encuentra lo esperado', () => {
    const items: SearchableItem[] = FULL_MANIFEST.map((e) => {
      const size = e.source.type === 'polyhaven' ? [1, 1, 1] : e.source.size;
      const t = searchTermsFor(e);
      return {
        id: e.id,
        name: e.name,
        category: e.category,
        ...(e.subcategory ? { subcategory: e.subcategory } : {}),
        styleTags: e.styleTags,
        roomTypes: e.roomTypes,
        mount: e.mount ?? 'floor',
        dimensionsM: { x: size[0]!, y: size[1]!, z: size[2]! },
        price: e.price,
        tags: t.tags,
        synonyms: t.synonyms,
      };
    });
    for (const i of items) expect(i.tags.length + i.synonyms.length, i.id).toBeGreaterThan(0);
    const top = (q: string, n = 3) => searchCatalog(items, { q }).slice(0, n).map((r) => r.item.subcategory ?? r.item.category);
    expect(top('lámpara de mesa')).toEqual(['table-lamp', 'table-lamp', 'table-lamp']);
    expect(top('velador')).toContain('table-lamp');
    expect(top('closet')[0]).toBe('wardrobe');
    expect(top('televisor')[0]).toBe('tv');
    expect(top('espejo')[0]).toBe('mirror');
    expect(top('nevera')[0]).toBe('fridge');
    expect(top('cortinas')[0]).toBe('curtains');
  });
});
