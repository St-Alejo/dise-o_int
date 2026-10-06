import { createRectangularShell } from '@interiores/shared-types';
import * as THREE from 'three';
import { buildRoom, disposeObject, wallPieces } from './room-builder';

describe('wallPieces', () => {
  it('pared sin aberturas = un solo tramo', () => {
    expect(wallPieces(4, 2.5, [])).toEqual([{ x0: 0, x1: 4, y0: 0, y1: 2.5 }]);
  });

  it('una ventana parte la pared en izquierda, bajo, sobre y derecha', () => {
    const pieces = wallPieces(4, 2.5, [{ offsetM: 2, widthM: 1, heightM: 1, sillHeightM: 0.9 }]);
    expect(pieces).toEqual([
      { x0: 0, x1: 1.5, y0: 0, y1: 2.5 },
      { x0: 1.5, x1: 2.5, y0: 0, y1: 0.9 },
      { x0: 1.5, x1: 2.5, y0: 1.9, y1: 2.5 },
      { x0: 2.5, x1: 4, y0: 0, y1: 2.5 },
    ]);
  });

  it('una puerta (sin alféizar) no genera tramo inferior', () => {
    const pieces = wallPieces(3, 2.5, [{ offsetM: 1, widthM: 0.8, heightM: 2, sillHeightM: 0 }]);
    expect(pieces.some((p) => p.x0 === 0.6 && p.y0 === 0)).toBe(false);
    expect(pieces).toContainEqual({ x0: 0.6, x1: 1.4, y0: 2, y1: 2.5 });
  });

  it('el área maciza = área total − área de aberturas', () => {
    const openings = [
      { offsetM: 1, widthM: 0.8, heightM: 2, sillHeightM: 0 },
      { offsetM: 3, widthM: 1.2, heightM: 1.2, sillHeightM: 0.9 },
    ];
    const area = wallPieces(4.5, 2.6, openings).reduce((a, p) => a + (p.x1 - p.x0) * (p.y1 - p.y0), 0);
    expect(area).toBeCloseTo(4.5 * 2.6 - 0.8 * 2 - 1.2 * 1.2);
  });
});

describe('buildRoom', () => {
  it('construye piso y 4 paredes con normales hacia el interior', () => {
    const shell = createRectangularShell(4, 3, 2.5);
    const room = buildRoom(shell);
    expect(room.walls).toHaveLength(4);
    const back = room.walls.find((w) => w.wallId === 'w-back')!;
    expect(back.normal.y).toBeCloseTo(1); // la pared del fondo (z=0) mira hacia +z
    const left = room.walls.find((w) => w.wallId === 'w-left')!;
    expect(left.normal.x).toBeCloseTo(1);
    const box = new THREE.Box3().setFromObject(room.group);
    expect(box.max.y).toBeCloseTo(2.5);
    expect(box.min.x).toBeLessThan(0); // el grosor de pared queda por fuera del cuarto
  });

  it('la cara interior de las paredes coincide con el borde del cuarto (los muebles caben)', () => {
    const shell = createRectangularShell(4, 3, 2.5, { window: false, door: false });
    const room = buildRoom(shell);
    const back = room.group.getObjectByName('wall-w-back')!;
    const box = new THREE.Box3().setFromObject(back);
    expect(box.max.z).toBeCloseTo(0);
  });

  it('disposeObject libera geometrías y materiales', () => {
    const room = buildRoom(createRectangularShell(4, 3, 2.5));
    let disposed = 0;
    room.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.addEventListener('dispose', () => disposed++);
    });
    disposeObject(room.group);
    expect(disposed).toBeGreaterThan(5);
  });
});
