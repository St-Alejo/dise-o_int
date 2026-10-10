import { describe, expect, it } from 'vitest';
import { alignDeltas, distributeDeltas, type ArrangeBox } from './arrange.js';

const box = (id: string, x: number, z: number, w = 1, d = 1): ArrangeBox => ({ id, minX: x, maxX: x + w, minZ: z, maxZ: z + d });
const a = box('a', 0, 0);
const b = box('b', 2, 1, 2, 1);
const c = box('c', 7, 3, 1, 2);
const moved = (deltas: Map<string, { x: number; z: number }>) => Object.fromEntries([...deltas].map(([id, d]) => [id, [d.x, d.z]]));

describe('alinear', () => {
  it('los bordes se alinean con el más extremo del grupo', () => {
    expect(moved(alignDeltas([a, b, c], 'left'))).toEqual({ a: [0, 0], b: [-2, 0], c: [-7, 0] });
    expect(moved(alignDeltas([a, b, c], 'right'))).toEqual({ a: [7, 0], b: [4, 0], c: [0, 0] });
    expect(moved(alignDeltas([a, b, c], 'back'))).toEqual({ a: [0, 0], b: [0, -1], c: [0, -3] });
    expect(moved(alignDeltas([a, b, c], 'front'))).toEqual({ a: [0, 4], b: [0, 3], c: [0, 0] });
  });

  it('los centros se alinean con el centro del conjunto', () => {
    // El conjunto va de x = 0 a 8 (centro 4) y de z = 0 a 5 (centro 2,5).
    expect(moved(alignDeltas([a, b, c], 'centre-x'))).toEqual({ a: [3.5, 0], b: [1, 0], c: [-3.5, 0] });
    expect(moved(alignDeltas([a, b, c], 'centre-z'))).toEqual({ a: [0, 2], b: [0, 1], c: [0, -1.5] });
  });

  it('con una sola pieza no hay nada que alinear', () => {
    expect(moved(alignDeltas([a], 'left'))).toEqual({ a: [0, 0] });
  });
});

describe('repartir', () => {
  it('deja la misma separación entre piezas sin mover las de los extremos', () => {
    // De 0 a 8 hay 8 m; las piezas ocupan 1 + 2 + 1: quedan 4 m para dos huecos de 2 m.
    const deltas = distributeDeltas([c, a, b], 'x');
    expect(moved(deltas)).toEqual({ a: [0, 0], b: [1, 0], c: [0, 0] });
    const z = distributeDeltas([a, b, c], 'z');
    // De 0 a 5: ocupan 1 + 1 + 2, queda 1 m para dos huecos de 0,5 m.
    expect(z.get('b')!.z).toBeCloseTo(0.5);
    expect(z.get('a')!.z).toBe(0);
    expect(z.get('c')!.z).toBeCloseTo(0);
  });

  it('con menos de tres piezas no hace nada', () => {
    expect(moved(distributeDeltas([a, b], 'x'))).toEqual({ a: [0, 0], b: [0, 0] });
  });
});
