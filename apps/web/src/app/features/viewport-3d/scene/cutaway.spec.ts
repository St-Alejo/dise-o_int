import { createRectangularShell } from '@interiores/shared-types';
import { describe, expect, it } from 'vitest';
import { buildRoom } from '../room-builder';
import { hidesRoom } from './cutaway';

describe('hidesRoom', () => {
  const room = buildRoom(createRectangularShell(4, 3, 2.6));
  const cut = (camera: { x: number; z: number }) => room.walls.filter((w) => hidesRoom(w, camera)).map((w) => w.wallId);

  it('desde el frente solo estorba la pared de delante', () => {
    expect(cut({ x: 2, z: 9 })).toEqual(['w-front']);
  });

  it('desde una esquina estorban las dos paredes que la forman', () => {
    expect(cut({ x: 9, z: 9 }).sort()).toEqual(['w-front', 'w-right']);
  });

  it('con la cámara sobre el cuarto no se corta ninguna', () => {
    expect(cut({ x: 2, z: 1.5 })).toEqual([]);
  });

  it('cada pared cortada tiene su murete, oculto hasta que hace falta', () => {
    for (const wall of room.walls) {
      expect(wall.stub.visible).toBe(false);
      expect(wall.stub.children.length).toBeGreaterThan(0);
    }
  });
});
