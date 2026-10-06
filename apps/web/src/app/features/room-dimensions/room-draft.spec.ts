import { describe, expect, it } from 'vitest';
import { createRectangularShell, type FurniturePlacement } from '@interiores/shared-types';
import { draftFromShell, newOpening, openingsFromDraft, previewRoom, wallLengthsFor, withDimension } from './room-draft';

const shell = createRectangularShell(4, 3.5, 2.6);
const sofa: FurniturePlacement = { id: 's', catalogItemId: 'sofa', position: { x: 3, y: 0, z: 3 }, rotationY: 0, lockedByUser: true };
const dims = () => ({ x: 2, y: 0.8, z: 0.9 });

describe('room-draft', () => {
  it('ida y vuelta: borrador ↔ aberturas canónicas sin perder información', () => {
    const draft = draftFromShell(shell);
    expect(draft.widthM).toBe(4);
    const back = openingsFromDraft(draft);
    for (const o of shell.openings) {
      const same = back.find((b) => b.id === o.id)!;
      expect(same.offsetM).toBeCloseTo(o.offsetM, 2);
      expect(same.wallId).toBe(o.wallId);
    }
  });

  it('la posición se escribe desde la esquina: centro = esquina + ancho/2', () => {
    const draft = { ...draftFromShell(shell), openings: [{ ...newOpening('door', []), fromCornerM: 1, widthM: 0.8 }] };
    expect(openingsFromDraft(draft)[0]!.offsetM).toBeCloseTo(1.4);
  });

  it('las puertas nunca tienen alféizar', () => {
    const draft = { ...draftFromShell(shell), openings: [{ ...newOpening('door', []), sillHeightM: 0.5 }] };
    expect(openingsFromDraft(draft)[0]!.sillHeightM).toBe(0);
  });

  it('newOpening no repite ids', () => {
    const a = newOpening('window', []);
    const b = newOpening('window', [a]);
    expect(a.id).not.toBe(b.id);
  });

  it('vista previa: cuenta los muebles que se moverán y los que no caben', () => {
    const draft = { ...draftFromShell(shell), widthM: 2.5, depthM: 2.5, openings: [] };
    const pv = previewRoom(shell, draft, [sofa], dims);
    expect(pv.error).toBeNull();
    expect(pv.moved).toBe(1);
    expect(pv.tooBig).toBe(0);
    expect(pv.shell!.widthM).toBe(2.5);
  });

  it('vista previa: mismo mensaje de error que el servidor', () => {
    const tooHigh = previewRoom(shell, { ...draftFromShell(shell), heightM: 9 }, [], dims);
    expect(tooHigh.error).toMatch(/alto/);
    const door = { ...newOpening('door', []), fromCornerM: 3.8 };
    const outside = previewRoom(shell, { ...draftFromShell(shell), openings: [door] }, [], dims);
    expect(outside.error).toMatch(/no cabe/);
  });

  it('vista previa: campos vacíos o aberturas repetidas', () => {
    expect(previewRoom(shell, { ...draftFromShell(shell), widthM: Number.NaN }, [], dims).error).toMatch(/Completa/);
    const d = newOpening('door', []);
    expect(previewRoom(shell, { ...draftFromShell(shell), openings: [d, d] }, [], dims).error).toMatch(/repetida/);
  });

  it('largo de cada pared según el borrador', () => {
    expect(wallLengthsFor({ ...draftFromShell(shell), widthM: 5, depthM: 3 })).toEqual({
      'w-back': 5,
      'w-front': 5,
      'w-right': 3,
      'w-left': 3,
    });
  });

  it('achicar el cuarto reubica las aberturas existentes en proporción (como el servidor)', () => {
    // Regresión E2E: una ventana cerca del borde derecho quedaba fuera al achicar el ancho.
    const base = { ...draftFromShell(shell), openings: [{ ...newOpening('window', []), fromCornerM: 2.6, widthM: 1.2 }] };
    const smaller = withDimension(base, 'widthM', 3.1);
    const w = smaller.openings[0]!;
    expect(w.fromCornerM + w.widthM).toBeLessThanOrEqual(3.1);
    expect(previewRoom(shell, smaller, [], dims).error).toBeNull();
  });

  it('bajar el techo recorta la altura de puertas y ventanas', () => {
    const lower = withDimension(draftFromShell(shell), 'heightM', 2.0);
    for (const o of openingsFromDraft(lower)) expect(o.sillHeightM + o.heightM).toBeLessThanOrEqual(2.0);
    expect(previewRoom(shell, lower, [], dims).error).toBeNull();
  });

  it('una ventana nueva busca un hueco libre y no choca con las existentes', () => {
    const d = draftFromShell(createRectangularShell(4, 3.5, 2.6));
    const added = newOpening('window', d.openings, wallLengthsFor(d));
    const draft = { ...d, openings: [...d.openings, added] };
    expect(previewRoom(shell, draft, [], dims).error).toBeNull();
  });

  it('si la pared preferida está llena, prueba otra pared', () => {
    const d = { ...draftFromShell(shell), widthM: 1.7, openings: [] }; // cabe una ventana de 1.2 m, no dos
    const first = newOpening('window', [], wallLengthsFor(d));
    const second = newOpening('window', [first], wallLengthsFor(d));
    expect(first.wallId).toBe('w-back');
    expect(second.wallId).not.toBe('w-back');
  });
});
