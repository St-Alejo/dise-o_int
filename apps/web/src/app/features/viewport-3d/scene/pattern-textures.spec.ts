import { heightToNormal, patternPlan } from './pattern-textures';

describe('dibujos de los acabados propios', () => {
  it('la repetición cubre varias piezas del tamaño pedido', () => {
    expect(patternPlan({ pattern: 'grid', tileSizeM: 0.6 })).toMatchObject({ pieceM: 0.6, tileM: 2.4, aspect: 1 });
    expect(patternPlan({ pattern: 'subway' }).pieceM).toBe(0.15);
    expect(patternPlan({ pattern: 'herringbone', tileSizeM: 0.5 }).tileM).toBe(2);
    // Los hexágonos no calzan en un cuadrado: la repetición es un poco más alta que ancha.
    expect(patternPlan({ pattern: 'hex' }).aspect).toBeCloseTo(1.1547, 3);
  });

  it('una superficie plana da la normal hacia arriba y un borde la inclina', () => {
    const size = 4;
    const flat = new Uint8ClampedArray(size * size * 4).fill(255);
    const n = heightToNormal(flat, size);
    expect([n[0], n[1], n[2]]).toEqual([128, 128, 255]);
    const step = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 2; x < size; x++) step[(y * size + x) * 4] = 255;
    const tilted = heightToNormal(step, size);
    expect(tilted[(1 * size + 1) * 4]).toBeLessThan(128);
  });
});
