import { describe, expect, it } from 'vitest';
import { HOME_GAP_M, arrangeHome, boxesOverlap, homeBounds, outlineBounds, roomBox, shareWall, snapRoom, type HomeRoom, type RoomBox } from './home-plan.js';

const rect = (w: number, d: number) => [
  { x: 0, z: 0 },
  { x: w, z: 0 },
  { x: w, z: d },
  { x: 0, z: d },
];
const box = (id: string, x: number, z: number, widthM: number, depthM: number): RoomBox => ({ id, x, z, widthM, depthM });

describe('planta conjunta de una vivienda', () => {
  it('la caja de un contorno en L es la que lo encierra entero', () => {
    const l = [
      { x: 1, z: 2 },
      { x: 5, z: 2 },
      { x: 5, z: 4 },
      { x: 3, z: 4 },
      { x: 3, z: 6 },
      { x: 1, z: 6 },
    ];
    expect(outlineBounds(l)).toEqual({ minX: 1, minZ: 2, widthM: 4, depthM: 4 });
    expect(roomBox({ id: 'a', outline: l }, { x: 10, z: 0 })).toEqual(box('a', 11, 2, 4, 4));
    expect(outlineBounds([])).toEqual({ minX: 0, minZ: 0, widthM: 0, depthM: 0 });
  });

  it('los cuartos sin colocar van en fila, separados y sin pisarse', () => {
    const rooms: HomeRoom[] = [
      { id: 'sala', outline: rect(5, 4) },
      { id: 'cocina', outline: rect(3, 3) },
      { id: 'baño', outline: rect(2, 2) },
    ];
    const at = arrangeHome(rooms);
    expect(at.get('sala')).toEqual({ x: 0, z: 0 });
    expect(at.get('cocina')).toEqual({ x: 5 + HOME_GAP_M, z: 0 });
    const boxes = rooms.map((r) => roomBox(r, at.get(r.id)!));
    for (const a of boxes) for (const b of boxes) if (a.id < b.id) expect(boxesOverlap(a, b)).toBe(false);
  });

  it('una fila demasiado ancha salta a la siguiente', () => {
    const rooms: HomeRoom[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, outline: rect(6, 3) }));
    const at = arrangeHome(rooms);
    expect(at.get('b')!.z).toBe(0);
    expect(at.get('c')).toEqual({ x: 0, z: 3 + HOME_GAP_M });
  });

  it('lo colocado a mano no se mueve y lo nuevo cae debajo, sin pisarlo', () => {
    const rooms: HomeRoom[] = [
      { id: 'sala', outline: rect(5, 4), position: { x: 2, z: 1 } },
      { id: 'nuevo', outline: rect(3, 3) },
    ];
    const at = arrangeHome(rooms);
    expect(at.get('sala')).toEqual({ x: 2, z: 1 });
    expect(at.get('nuevo')).toEqual({ x: 2, z: 5 + HOME_GAP_M });
  });

  it('al arrastrar, un lado se pega al lado opuesto del vecino y el otro eje se alinea', () => {
    const sala = box('sala', 0, 0, 5, 4);
    // Casi tocando por la derecha y casi alineado por arriba.
    expect(snapRoom(box('cocina', 5.2, 0.15, 3, 3), [sala])).toEqual({ x: 5, z: 0 });
    // Lejos: no se corrige nada.
    expect(snapRoom(box('cocina', 7, 1, 3, 3), [sala])).toEqual({ x: 7, z: 1 });
    // Por debajo: su borde superior contra el inferior de la sala, alineando el lado derecho.
    expect(snapRoom(box('baño', 2.9, 4.2, 2, 2), [sala])).toEqual({ x: 3, z: 4 });
  });

  it('un cuarto lejano en el otro eje no atrae', () => {
    const lejos = box('lejos', 0, 20, 5, 4);
    expect(snapRoom(box('x', 5.1, 0, 3, 3), [lejos])).toEqual({ x: 5.1, z: 0 });
  });

  it('compartir pared es tocarse por un borde a lo largo de un tramo, no por una esquina', () => {
    const sala = box('sala', 0, 0, 5, 4);
    expect(shareWall(sala, box('cocina', 5, 1, 3, 3))).toBe(true);
    expect(shareWall(sala, box('baño', 2, 4, 2, 2))).toBe(true);
    expect(shareWall(sala, box('esquina', 5, 4, 2, 2))).toBe(false);
    expect(shareWall(sala, box('suelto', 6, 0, 2, 2))).toBe(false);
    expect(boxesOverlap(sala, box('cocina', 5, 1, 3, 3))).toBe(false);
    expect(boxesOverlap(sala, box('encima', 4, 1, 3, 3))).toBe(true);
  });

  it('el conjunto ocupa del primer borde al último', () => {
    expect(homeBounds([box('a', 1, 2, 5, 4), box('b', 6, 0, 3, 3)])).toEqual({ x: 1, z: 0, widthM: 8, depthM: 6 });
    expect(homeBounds([])).toEqual({ x: 0, z: 0, widthM: 0, depthM: 0 });
  });
});
