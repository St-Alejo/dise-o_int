import { describe, expect, it } from 'vitest';
import { DEFAULT_FINISHES, STYLE_FINISHES, assertValidFinishes } from '@interiores/shared-types';
import { effectiveFinishes, sameFinishes, selectedMaterial, withFinish } from './finishes-model';

describe('acabados', () => {
  it('sin acabados guardados se usa la paleta del estilo (o la neutra)', () => {
    expect(effectiveFinishes(null, 'industrial')).toEqual(STYLE_FINISHES.industrial);
    expect(effectiveFinishes(null, null)).toEqual(DEFAULT_FINISHES);
    expect(effectiveFinishes(DEFAULT_FINISHES, 'industrial')).toEqual(DEFAULT_FINISHES);
  });

  it('cambia piso, techo y una pared concreta sin tocar el resto', () => {
    let f = withFinish(DEFAULT_FINISHES, 'floor', 'wood-walnut');
    f = withFinish(f, 'ceiling', 'paint-greige');
    f = withFinish(f, 'wall', 'paint-navy', 'w-back');
    expect(f).toEqual({ floor: 'wood-walnut', ceiling: 'paint-greige', walls: { all: 'paint-white', 'w-back': 'paint-navy' } });
    expect(() => assertValidFinishes(f)).not.toThrow();
    expect(selectedMaterial(f, 'wall', 'w-back')).toBe('paint-navy');
    expect(selectedMaterial(f, 'wall', 'w-left')).toBe('paint-white');
  });

  it('pintar "todas" quita las excepciones; una pared igual a "todas" no guarda excepción', () => {
    const f = withFinish(STYLE_FINISHES.industrial, 'wall', 'paint-sage', 'all');
    expect(f.walls).toEqual({ all: 'paint-sage' });
    const g = withFinish({ ...f, walls: { all: 'paint-sage', 'w-back': 'paint-navy' } }, 'wall', 'paint-sage', 'w-back');
    expect(g.walls).toEqual({ all: 'paint-sage' });
  });

  it('comparación de acabados', () => {
    expect(sameFinishes(DEFAULT_FINISHES, { ...DEFAULT_FINISHES })).toBe(true);
    expect(sameFinishes(DEFAULT_FINISHES, null)).toBe(false);
  });
});
