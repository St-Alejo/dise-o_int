import { describe, expect, it } from 'vitest';
import { checkDesign, type DesignPiece } from './design-check.js';
import type { Opening, RoomShell } from './domain.js';
import { createRectangularShell } from './geometry.js';

/** Cuarto de 5 × 4 con la puerta en la pared del frente (z = 4) y una ventana al fondo. */
const door: Opening = { id: 'door', type: 'door', wallId: 'w-front', widthM: 0.9, heightM: 2.05, offsetM: 4, sillHeightM: 0 };
const window: Opening = { id: 'win', type: 'window', wallId: 'w-back', widthM: 1.4, heightM: 1.2, offsetM: 2.5, sillHeightM: 0.9 };
const room = (): RoomShell => ({ ...createRectangularShell(5, 4, 2.6, { door: false, window: false }), openings: [door, window] });

const piece = (id: string, x: number, z: number, dims: [number, number, number], extra: Partial<DesignPiece> = {}): DesignPiece => ({
  id,
  name: id,
  mount: 'floor',
  category: 'sofa',
  position: { x, y: 0, z },
  rotationY: 0,
  dims: { x: dims[0], y: dims[1], z: dims[2] },
  ...extra,
});
const lamp = piece('lámpara', 0.4, 0.4, [0.4, 1.6, 0.4], { category: 'lighting' });
const kinds = (pieces: DesignPiece[], shell = room()) => checkDesign(shell, pieces).map((i) => i.kind);

describe('revisión del diseño', () => {
  it('un cuarto bien resuelto no tiene avisos', () => {
    expect(checkDesign(room(), [piece('sofá', 2.5, 3.4, [2, 0.8, 0.9]), piece('mesa', 2.5, 2.2, [1, 0.45, 0.6]), lamp])).toEqual([]);
    expect(checkDesign(room(), [])).toEqual([]);
  });

  it('avisa si un mueble no deja entrar por la puerta, y dice cuál', () => {
    // La puerta del frente queda en x ≈ 1 (su pared va de derecha a izquierda): un armario justo delante.
    const issues = checkDesign(room(), [piece('armario', 1, 3.5, [1.4, 2, 0.6]), piece('sofá', 3.5, 0.6, [2, 0.8, 0.9]), lamp]);
    expect(issues[0]).toMatchObject({ kind: 'door-blocked', severity: 'problem', placementIds: ['armario'] });
    expect(issues[0]!.detail).toContain('armario');
  });

  it('avisa de un mueble al que no se puede llegar', () => {
    // Una butaca encerrada en la esquina del fondo por dos muebles largos.
    const issues = checkDesign(room(), [
      piece('butaca', 4.5, 0.5, [0.7, 0.9, 0.7]),
      piece('estantería', 3.2, 0.8, [0.6, 1.8, 1.6]),
      piece('cómoda', 4.2, 1.6, [1.6, 0.9, 0.6]),
      lamp,
    ]);
    expect(issues.filter((i) => i.kind === 'unreachable').map((i) => i.placementIds[0])).toEqual(['butaca']);
    expect(issues.every((i) => i.kind !== 'door-blocked')).toBe(true);
  });

  it('una alfombra, lo colgado y lo apoyado no estorban el paso', () => {
    const rug = piece('alfombra', 1.5, 2.6, [3, 0.02, 2.5], { subcategory: 'rug', category: 'decor' });
    const picture = piece('cuadro', 1, 3.98, [1, 0.6, 0.04], { mount: 'wall', position: { x: 1, y: 1.4, z: 3.98 } });
    const vase = piece('jarrón', 1, 3.4, [0.3, 0.4, 0.3], { supportId: 'mesa', position: { x: 1, y: 0.45, z: 3.4 } });
    expect(kinds([rug, picture, vase, lamp])).toEqual([]);
  });

  it('avisa cuando un mueble alto tapa la ventana, pero no por uno bajo', () => {
    expect(kinds([piece('armario', 2.5, 0.35, [1.6, 2, 0.6]), lamp])).toEqual(['window-blocked']);
    expect(kinds([piece('banco', 2.5, 0.3, [1.6, 0.45, 0.5]), lamp])).toEqual([]);
    // Alto, pero en otra parte de la pared: no la tapa.
    expect(kinds([piece('armario', 0.6, 0.35, [1, 2, 0.6]), lamp])).toEqual([]);
  });

  it('avisa si casi no queda piso para caminar', () => {
    const issues = checkDesign(room(), [
      piece('cama', 1.5, 1.2, [2.6, 0.6, 2.2]),
      piece('armario', 4.3, 1.2, [1.2, 2, 2.2]),
      piece('cómoda', 3.6, 3.1, [2.6, 0.9, 1.2]),
      lamp,
    ]);
    expect(issues.find((i) => i.kind === 'crowded')?.detail).toMatch(/\d+ %/);
  });

  it('un mueble fuera del cuarto es lo primero que se avisa; sin lámparas, lo último', () => {
    const issues = checkDesign(room(), [piece('sofá', 5.4, 2, [2, 0.8, 0.9]), piece('mesa', 2, 2, [1, 0.45, 0.6])]);
    expect(issues.map((i) => i.kind)).toEqual(['outside', 'no-light']);
    expect(issues[0]!.id).toBe('outside:sofá');
  });

  it('sin puerta no se inventa un recorrido: solo revisa lo demás', () => {
    const shell = { ...room(), openings: [window] };
    expect(kinds([piece('armario', 2.5, 0.35, [1.6, 2, 0.6]), lamp], shell)).toEqual(['window-blocked']);
  });
});
