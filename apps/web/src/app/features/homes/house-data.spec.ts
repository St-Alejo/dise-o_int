import { createRectangularShell, type DesignProject } from '@interiores/shared-types';
import { houseRooms, type HouseLevelData } from './house-data';

const shell = createRectangularShell(3, 4, 2.6);
const level: HouseLevelData = {
  levelId: 'L1',
  index: 0,
  name: 'Piso 1',
  elevation: 0,
  heightM: 2.6,
  rooms: [
    { roomId: 'sala', name: 'Sala', roomType: 'living', origin: { x: 0, z: 0 }, shell, projectId: 'p-sala' },
    { roomId: 'cocina', name: 'Cocina', roomType: 'kitchen', origin: { x: 3, z: 0 }, shell, projectId: 'p-cocina' },
    { roomId: 'hall', name: 'Hall', roomType: null, origin: { x: 0, z: 4 }, shell, projectId: null },
  ],
};

const project = (id: string, over: Partial<DesignProject> = {}) =>
  ({
    id,
    roomShell: shell,
    finishes: null,
    selectedStyleId: null,
    furniturePlacements: [{ id: 'f1', catalogItemId: 'sofa', position: { x: 1, y: 0, z: 1 }, rotationY: 0 }],
    ...over,
  }) as unknown as DesignProject;

describe('houseRooms', () => {
  it('los cuartos amueblables traen sus muebles y acabados; el hall va vacío', async () => {
    const loaded: string[] = [];
    const rooms = await houseRooms(level, async (id) => {
      loaded.push(id);
      return project(id);
    });
    expect(loaded.sort()).toEqual(['p-cocina', 'p-sala']);
    expect(rooms.map((r) => r.name)).toEqual(['Sala', 'Cocina', 'Hall']);
    expect(rooms[0]!.placements).toHaveLength(1);
    expect(rooms[0]!.finishes).toBeTruthy(); // la paleta por defecto si no eligió acabados
    expect(rooms[2]!.placements).toBeUndefined();
  });

  it('se salta el cuarto que se está editando y aguanta uno que no carga', async () => {
    const rooms = await houseRooms(
      level,
      async (id) => {
        if (id === 'p-cocina') throw new Error('404');
        return project(id);
      },
      'p-sala',
    );
    expect(rooms.map((r) => r.roomId)).toEqual(['cocina', 'hall']);
    expect(rooms[0]!.placements).toBeUndefined();
  });
});
