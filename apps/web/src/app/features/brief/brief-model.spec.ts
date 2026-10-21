import { describe, expect, it } from 'vitest';
import { customFinishId, DesignBriefSchema } from '@interiores/shared-types';
import { briefChips, emptyBrief, hasLocks, pinLighting, pinStyle, pinSurface, removeChip, toggleLock, wish } from './brief-model';

const TILE = { name: 'Baldosa brillante azul y verde', kind: 'tile' as const, colors: ['#a9d4ee', '#9bd3b0'], pattern: 'mosaic' as const, gloss: 0.85, tileSizeM: 0.1 };

describe('Brief en chips', () => {
  it('sin Brief no hay chips ni candados', () => {
    expect(briefChips(null)).toEqual([]);
    expect(hasLocks(emptyBrief())).toBe(false);
  });

  it('fijar el piso actual guarda su acabado propio; el chip lo nombra con sus colores', () => {
    const id = customFinishId(TILE);
    const finishes = { floor: id, walls: { all: 'paint-white' }, ceiling: 'paint-white', custom: { [id]: TILE } };
    const brief = pinSurface(null, 'floor', finishes);
    expect(brief.surfaces.floor).toEqual({ spec: TILE, locked: true });
    expect(() => DesignBriefSchema.parse(brief)).not.toThrow();
    const [chip] = briefChips(brief);
    expect(chip).toMatchObject({ key: 'surface:floor', label: 'Piso', detail: TILE.name, locked: true, swatches: TILE.colors });
    // Un material de la biblioteca se fija por su id.
    expect(pinSurface(brief, 'walls', finishes).surfaces.walls).toEqual({ material: 'paint-white', locked: true });
  });

  it('el candado se suelta y se vuelve a cerrar; quitar borra solo ese chip', () => {
    let brief = pinStyle(pinLighting(null, { mood: 'calida', level: 'tenue' }), 'industrial');
    expect(briefChips(brief).map((c) => c.detail)).toEqual(['Industrial', 'cálida, tenue']);
    brief = toggleLock(brief, 'style');
    expect(brief.style?.locked).toBe(false);
    expect(hasLocks(brief)).toBe(true);
    brief = toggleLock(brief, 'lighting');
    expect(hasLocks(brief)).toBe(false);
    brief = removeChip(brief, 'lighting');
    expect(brief.lighting).toBeUndefined();
    expect(brief.style?.id).toBe('industrial');
  });

  it('"quiero" y "sin" se excluyen y no se repiten', () => {
    let brief = wish(null, 'rug', 'want');
    brief = wish(brief, 'rug', 'want');
    expect(brief.mustHave).toEqual([{ subcategory: 'rug' }]);
    brief = wish(brief, 'rug', 'avoid');
    expect(brief.mustHave).toEqual([]);
    expect(brief.avoid).toEqual(['rug']);
    brief = wish(brief, 'dressing-table', 'want');
    expect(briefChips(brief).map((c) => `${c.label} ${c.detail}`)).toEqual(['Quiero Tocador de maquillaje', 'Sin Alfombra']);
    expect(removeChip(brief, 'avoid:0').avoid).toEqual([]);
  });
});
