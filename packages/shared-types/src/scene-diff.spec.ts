import { describe, expect, it } from 'vitest';
import type { FurniturePlacement } from './domain.js';
import { createRectangularShell } from './geometry.js';
import { diffScenes } from './scene-diff.js';

const shell = createRectangularShell(4, 3, 2.6);
const piece = (id: string, x: number, extra: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id,
  catalogItemId: 'sofa',
  position: { x, y: 0, z: 1 },
  rotationY: 0,
  lockedByUser: false,
  ...extra,
});
const side = (pieces: FurniturePlacement[], extra = {}) => ({ roomShell: shell, furniturePlacements: pieces, finishes: null, ...extra });

describe('diffScenes', () => {
  it('dos estados iguales no tienen diferencias', () => {
    const diff = diffScenes(side([piece('a', 1)]), side([piece('a', 1)]));
    expect(diff.same).toBe(true);
  });

  it('distingue lo añadido, lo quitado, lo movido y lo cambiado', () => {
    const before = side([piece('a', 1), piece('b', 2), piece('c', 3), piece('d', 3.5)]);
    const after = side([piece('a', 1.5), piece('c', 3, { materials: { tapizado: 'fabric-velvet-green' } }), piece('d', 3.5), piece('e', 0.5)]);
    const diff = diffScenes(before, after);
    expect(diff.added.map((p) => p.id)).toEqual(['e']);
    expect(diff.removed.map((p) => p.id)).toEqual(['b']);
    expect(diff.moved.map((p) => p.id)).toEqual(['a']);
    expect(diff.changed.map((p) => p.id)).toEqual(['c']);
    expect(diff.same).toBe(false);
  });

  it('un giro cuenta como movimiento; un temblor de milímetros, no', () => {
    expect(diffScenes(side([piece('a', 1)]), side([piece('a', 1, { rotationY: Math.PI / 2 })])).moved).toHaveLength(1);
    expect(diffScenes(side([piece('a', 1)]), side([piece('a', 1.004)])).same).toBe(true);
  });

  it('avisa si cambió la planta o los acabados aunque los muebles sigan igual', () => {
    const pieces = [piece('a', 1)];
    const wider = createRectangularShell(5, 3, 2.6);
    expect(diffScenes(side(pieces), side(pieces, { roomShell: wider }))).toMatchObject({ roomChanged: true, finishesChanged: false, same: false });
    const painted = { floor: 'wood-oak', walls: { all: 'paint-sage' }, ceiling: 'paint-white' };
    expect(diffScenes(side(pieces), side(pieces, { finishes: painted }))).toMatchObject({ roomChanged: false, finishesChanged: true });
  });
});
