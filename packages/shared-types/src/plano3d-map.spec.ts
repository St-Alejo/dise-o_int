import { describe, expect, it } from 'vitest';
import type { FurniturePlacement } from './domain.js';
import {
  floorMaterialOp,
  furnitureOps,
  interioresFurnitureOf,
  interioresRoomType,
  linkedRooms,
  plano3dFloorMaterial,
  toPlano3dFurniture,
  touchesArchitecture,
  type Plano3dModel,
} from './plano3d-map.js';

/** Sala de 5 × 4 m en (2, 3) con una puerta abajo y una ventana arriba; y un garaje (no se diseña). */
const MODEL: Plano3dModel = {
  project_id: 'prj_demo',
  levels: [
    {
      id: 'L1',
      name: 'Piso 1',
      height: 2.8,
      walls: [
        // muro de arriba (y = 3), de izquierda a derecha, con una ventana de 1,2 m que empieza a 1 m
        { id: 'w-top', start: { x: 2, y: 3 }, end: { x: 7, y: 3 }, thickness: 0.15, openings: [{ id: 'v1', kind: 'window', offset: 1, width: 1.2, height: 1.2, sill: 1 }] },
        // muro de abajo (y = 7) de derecha a izquierda, con una puerta de 0,9 m que empieza a 0,5 m
        { id: 'w-bottom', start: { x: 7, y: 7 }, end: { x: 2, y: 7 }, thickness: 0.15, openings: [{ id: 'p1', kind: 'door', offset: 0.5, width: 0.9, height: 2.1 }] },
      ],
      rooms: [
        { id: 'r-sala', label: 'Sala', room_type: 'living', polygon: [{ x: 2, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 2, y: 7 }] },
        { id: 'r-garaje', label: 'Garaje', room_type: 'garage', polygon: [{ x: 7, y: 3 }, { x: 10, y: 3 }, { x: 10, y: 7 }, { x: 7, y: 7 }] },
      ],
      furniture: [
        { id: 'int-r-sala-p1', catalog_id: 'int_sofa-3', position: { x: 4, y: 5 }, width: 2, depth: 0.9, height: 0.8, rotation: 0 },
        { id: 'sofa-generico', catalog_id: 'sofa_3', position: { x: 5, y: 5 }, width: 2, depth: 0.9, height: 0.8, rotation: 0 },
      ],
    },
    {
      id: 'L2',
      name: 'Piso 2',
      rooms: [{ id: 'r-comedor', label: 'Comedor', room_type: 'living', polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] }],
    },
  ],
};

const placement = (over: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id: 'p1',
  catalogItemId: 'sofa-3',
  position: { x: 2, y: 0, z: 2 },
  rotationY: Math.PI / 2,
  lockedByUser: false,
  ...over,
});

describe('puente con Plano 3D', () => {
  it('cada ambiente diseñable es un cuarto con su piso y su origen', () => {
    const rooms = linkedRooms(MODEL);
    expect(rooms.map((r) => [r.levelId, r.roomId, r.roomType])).toEqual([
      ['L1', 'r-sala', 'living'],
      ['L2', 'r-comedor', 'dining'],
    ]);
    const sala = rooms[0]!;
    expect(sala.origin).toEqual({ x: 2, z: 3 });
    expect(sala.shell.widthM).toBe(5);
    expect(sala.shell.depthM).toBe(4);
    expect(sala.shell.heightM).toBe(2.8);
    expect(rooms[1]!.shell.heightM).toBe(2.6); // sin altura: la de un entrepiso normal
  });

  it('las aberturas caen en la pared que corresponde, medidas al centro', () => {
    const sala = linkedRooms(MODEL)[0]!;
    const byId = Object.fromEntries(sala.shell.openings.map((o) => [o.id, o]));
    const window = byId['p3d-v1']!;
    const door = byId['p3d-p1']!;
    expect(window.type).toBe('window');
    expect(window.wallId).toBe('w-back'); // y = 3 → z = 0, la pared del fondo
    expect(window.offsetM).toBeCloseTo(1.6); // 1 + 1,2 / 2 desde x = 2
    expect(window.sillHeightM).toBe(1);
    expect(door.type).toBe('door');
    expect(door.wallId).toBe('w-front');
    const front = sala.shell.walls.find((w) => w.id === 'w-front')!;
    // la puerta está a 0,95 m (centro) de x = 7 sobre el muro de Plano 3D: x local = 5 - 0,95
    const along = Math.abs(5 - 0.95 - front.start.x);
    expect(door.offsetM).toBeCloseTo(along);
  });

  it('tipos: comedor por nombre, estudio → oficina, el resto no se diseña', () => {
    expect(interioresRoomType({ label: 'Comedor', room_type: 'living' })).toBe('dining');
    expect(interioresRoomType({ label: 'Sala comedor', room_type: 'living' })).toBe('living');
    expect(interioresRoomType({ label: 'Estudio', room_type: 'study' })).toBe('office');
    expect(interioresRoomType({ label: 'Patio', room_type: 'patio' })).toBeNull();
  });

  it('un mueble vuelve al mundo de Plano 3D con el giro invertido', () => {
    const f = toPlano3dFurniture({ roomId: 'r-sala', origin: { x: 2, z: 3 } }, placement(), { x: 2, y: 0.8, z: 0.9 });
    expect(f).toEqual({
      id: 'int-r-sala-p1',
      catalog_id: 'int_sofa-3',
      position: { x: 4, y: 5 },
      width: 2,
      depth: 0.9,
      height: 0.8,
      rotation: -1.571,
    });
  });

  it('solo manda lo que cambió y borra lo que ya no está', () => {
    const room = { roomId: 'r-sala', origin: { x: 2, z: 3 }, levelId: 'L1' };
    const size = () => ({ x: 2, y: 0.8, z: 0.9 });
    const previous = interioresFurnitureOf(MODEL.levels[0]!, 'r-sala');
    expect([...previous.keys()]).toEqual(['int-r-sala-p1']); // el genérico no es de Interiores

    const same = furnitureOps(room, [placement({ rotationY: 0 })], size, previous);
    expect(same).toEqual([]);

    const moved = furnitureOps(room, [placement({ rotationY: 0, position: { x: 3, y: 0, z: 2 } }), placement({ id: 'p2' })], size, previous);
    expect(moved.map((o) => [o.t, o.id])).toEqual([
      ['put', 'int-r-sala-p1'],
      ['put', 'int-r-sala-p2'],
    ]);
    expect(furnitureOps(room, [], size, previous)).toEqual([{ t: 'del', k: 'furniture', level: 'L1', id: 'int-r-sala-p1' }]);
  });

  it('el acabado de piso viaja con prefijo y solo si cambió', () => {
    const room = MODEL.levels[0]!.rooms![0]!;
    expect(plano3dFloorMaterial('wood-oak')).toBe('int_wood-oak');
    const op = floorMaterialOp('L1', room, 'wood-oak');
    expect(op).toMatchObject({ t: 'put', k: 'room', id: 'r-sala', v: { floor_material: 'int_wood-oak', polygon: room.polygon } });
    expect(floorMaterialOp('L1', { ...room, floor_material: 'int_wood-oak' }, 'wood-oak')).toBeNull();
  });

  it('distingue lotes de muebles de cambios de arquitectura', () => {
    expect(touchesArchitecture([{ k: 'furniture' }])).toBe(false);
    expect(touchesArchitecture([{ k: 'furniture' }, { k: 'wall' }])).toBe(true);
  });
});
