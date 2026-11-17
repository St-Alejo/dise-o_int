import { createRectangularShell } from '@interiores/shared-types';
import * as THREE from 'three';
import { HouseView, houseOffset, type HouseRoomData } from './house-view';

const room = (roomId: string, x: number, z: number, projectId: string | null = `p-${roomId}`): HouseRoomData => ({
  roomId,
  name: roomId,
  projectId,
  origin: { x, z },
  shell: createRectangularShell(3, 4, 2.6),
});

function setup(walls: 'auto' | 'cut' = 'auto') {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  let frames = 0;
  const view = new HouseView({ scene, camera, invalidate: () => frames++ }, null, walls);
  return { scene, camera, view, frames: () => frames };
}

describe('HouseView', () => {
  it('cada cuarto va en su sitio respecto al centro, sin techo', () => {
    const { view } = setup();
    view.sync([room('sala', 0, 0), room('cocina', 3.15, 0), room('hall', 0, 4.15, null)], new Map(), { x: 3.15, z: 0 });
    expect(view.count).toBe(3);
    const holders = view.root.children;
    expect(holders.map((h) => [h.position.x, h.position.z])).toEqual([
      [-3.15, 0],
      [0, 0],
      [-3.15, 4.15],
    ]);
    holders.forEach((h) => expect(h.getObjectByName('ceiling')!.visible).toBe(false));
    // los rótulos van en el centro de cada cuarto, ya en su sitio
    expect(view.labels().map((l) => [l.name, Math.round(l.at.x * 100) / 100, Math.round(l.at.z * 100) / 100])).toEqual([
      ['sala', -1.65, 2],
      ['cocina', 1.5, 2],
      ['hall', -1.65, 6.15],
    ]);
    const box = view.bounds();
    expect([box.min.x, box.max.x]).toEqual([-3.15, 3]);
  });

  it('en modo corte todas las paredes quedan a ras; enteras al recorrer', () => {
    const { view, camera } = setup('cut');
    camera.position.set(1.5, 8, 2);
    view.sync([room('sala', 0, 0)], new Map());
    const stubs = () => {
      const out: boolean[] = [];
      view.root.traverse((o) => {
        if (o.name.startsWith('stub-')) out.push(o.visible);
      });
      return out;
    };
    const cut = stubs();
    expect(cut.length).toBeGreaterThanOrEqual(4);
    expect(cut.every(Boolean)).toBe(true);
    view.setWalls('full');
    expect(stubs().every((v) => !v)).toBe(true);
  });

  it('el rayo sobre un piso dice qué cuarto es', () => {
    const { view } = setup();
    view.sync([room('sala', 0, 0), room('cocina', 3.15, 0)], new Map());
    const ray = new THREE.Raycaster(new THREE.Vector3(4.5, 5, 2), new THREE.Vector3(0, -1, 0));
    expect(view.pick(ray)?.roomId).toBe('cocina');
    const miss = new THREE.Raycaster(new THREE.Vector3(20, 5, 20), new THREE.Vector3(0, -1, 0));
    expect(view.pick(miss)).toBeNull();
  });

  it('resaltar un cuarto pinta su piso y volver a sincronizar limpia lo anterior', () => {
    const { view } = setup();
    view.sync([room('sala', 0, 0), room('cocina', 3.15, 0)], new Map());
    view.setHover('cocina');
    const floor = view.root.children[1]!.getObjectByName('floor') as THREE.Mesh;
    expect((floor.material as THREE.MeshStandardMaterial).emissive.getHex()).not.toBe(0);
    view.sync([room('sala', 0, 0)], new Map());
    expect(view.root.children).toHaveLength(1);
    expect(view.labels().map((l) => l.name)).toEqual(['sala']);
  });

  it('houseOffset redondea al milímetro', () => {
    expect(houseOffset({ x: 7.1234, z: 2 }, { x: 3.1, z: 0.5 })).toEqual({ x: 4.023, z: 1.5 });
  });
});
