import { describe, expect, it } from 'vitest';
import { createRectangularShell, type CatalogItem, type FurniturePlacement } from '@interiores/shared-types';
import { elevationRange, isResizable, nextDimensions, proposeResize, sameAsCatalog, type ResizeContext } from './inspector-model';

const shell = createRectangularShell(4, 3.5, 2.6);
const base: Pick<CatalogItem, 'styleTags' | 'roomTypes' | 'modelUrl' | 'currency' | 'license' | 'tags' | 'synonyms'> = {
  styleTags: [],
  roomTypes: [],
  modelUrl: '/m.glb',
  currency: 'USD',
  license: 'cc0',
  tags: [],
  synonyms: [],
};
const sofa = { ...base, id: 'sofa', name: 'Sofá', category: 'sofa', mount: 'floor', dimensionsM: { x: 2, y: 0.8, z: 0.9 }, resize: { x: [1.4, 2.6], y: [0.7, 0.95], z: [0.8, 1.1] } } as CatalogItem;
const art = { ...base, id: 'art', name: 'Cuadro', category: 'wall-decor', mount: 'wall', dimensionsM: { x: 0.8, y: 0.6, z: 0.03 }, resize: { x: [0.4, 1.6], y: [0.3, 1.2] } } as CatalogItem;
const glbNoRanges = { ...base, id: 'glb', name: 'GLB', category: 'sofa', mount: 'floor', dimensionsM: { x: 2, y: 0.8, z: 0.9 } } as CatalogItem;

const at = (over: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id: 'p',
  catalogItemId: 'sofa',
  position: { x: 2, y: 0, z: 1.5 },
  rotationY: 0,
  lockedByUser: true,
  ...over,
});
const ctx = (valid = true): ResizeContext => ({ shell, isPoseValid: () => valid, supportTopOf: () => 0.55 });

describe('nextDimensions', () => {
  it('cambia un eje dentro de su rango y respeta los ejes fijos', () => {
    expect(nextDimensions(sofa, sofa.dimensionsM, 'x', 9, false)).toEqual({ x: 2.6, y: 0.8, z: 0.9 });
    expect(nextDimensions(art, art.dimensionsM, 'z', 0.5, false).z).toBe(0.03); // el fondo de un cuadro no cambia
  });

  it('con proporción, escala los demás ejes redimensionables (acotados)', () => {
    const d = nextDimensions(art, art.dimensionsM, 'x', 1.2, true);
    expect(d.x).toBeCloseTo(1.2);
    expect(d.y).toBeCloseTo(0.9);
    expect(d.z).toBe(0.03);
  });

  it('sin rangos en el catálogo, la pieza no es redimensionable', () => {
    expect(isResizable(glbNoRanges)).toBe(false);
    expect(isResizable(sofa)).toBe(true);
    expect(nextDimensions(glbNoRanges, glbNoRanges.dimensionsM, 'x', 3, false).x).toBe(2);
  });
});

describe('proposeResize', () => {
  it('reubica la pieza para que siga dentro del cuarto', () => {
    const p = at({ position: { x: 3, y: 0, z: 0.45 } });
    const r = proposeResize(ctx(), p, sofa, { x: 2.6, y: 0.8, z: 0.9 });
    expect(r.error).toBeNull();
    expect(r.position.x).toBeCloseTo(2.7); // 4 − 2.6/2
  });

  it('un cuadro más profundo sigue pegado a su pared y no atraviesa el techo', () => {
    const p = at({ catalogItemId: 'art', wallId: 'w-back', position: { x: 2, y: 2.0, z: 0.016 }, elevationM: 2.0 });
    const r = proposeResize(ctx(), p, art, { x: 0.8, y: 1.2, z: 0.03 });
    expect(r.position.z).toBeCloseTo(0.016, 3);
    expect(r.position.y + 1.2).toBeLessThanOrEqual(2.6 + 1e-9);
  });

  it('lo apoyado queda a la altura de su soporte', () => {
    const lamp = { ...art, id: 'lamp', mount: 'surface' } as CatalogItem;
    const r = proposeResize(ctx(), at({ supportId: 'mesa' }), lamp, { x: 0.3, y: 0.5, z: 0.3 });
    expect(r.position.y).toBeCloseTo(0.55);
  });

  it('explica por qué no se puede: choque o techo', () => {
    expect(proposeResize(ctx(false), at(), sofa, sofa.dimensionsM)).toMatchObject({ reason: 'collision', error: expect.stringMatching(/choca/) });
    const tall = { ...sofa, resize: { y: [0.5, 5] } } as CatalogItem;
    expect(proposeResize(ctx(), at(), tall, { x: 2, y: 3, z: 0.9 }).error).toMatch(/techo/);
  });
});

describe('utilidades', () => {
  it('rango de altura en la pared y medidas iguales a las del catálogo', () => {
    expect(elevationRange(shell, { x: 1, y: 0.6, z: 0.03 })).toEqual([0, 2]);
    expect(sameAsCatalog(sofa, { x: 2.0002, y: 0.8, z: 0.9 })).toBe(true);
    expect(sameAsCatalog(sofa, { x: 2.1, y: 0.8, z: 0.9 })).toBe(false);
  });
});
