import { describe, expect, it } from 'vitest';
import { bodiesCollide, bodyOf } from './collision.js';
import { decorate, type DecorItem } from './decorate.js';
import type { FurniturePlacement, RoomShell, RoomType } from './domain.js';
import { createRectangularShell } from './geometry.js';
import { overlapsOpening, positionOnWall, wallFrames, alongOf } from './walls.js';

const ANY: RoomType[] = ['living', 'bedroom', 'dining', 'office', 'kitchen', 'bathroom'];
const item = (id: string, category: string, subcategory: string, dims: [number, number, number], mount: DecorItem['mount'] = 'floor', extra: Partial<DecorItem> = {}): DecorItem => ({
  id,
  category,
  subcategory,
  styleTags: [],
  roomTypes: ANY,
  dimensionsM: { x: dims[0], y: dims[1], z: dims[2] },
  mount,
  ...extra,
});

const CATALOG: DecorItem[] = [
  item('sofa', 'sofa', 'sofa', [2, 0.8, 0.9]),
  item('cama', 'bed', 'bed', [1.6, 1, 2]),
  item('mesita', 'table', 'nightstand', [0.45, 0.5, 0.4]),
  item('mueble-tv', 'storage', 'tv-stand', [1.6, 0.45, 0.4]),
  item('escritorio', 'table', 'desk', [1.4, 0.75, 0.65]),
  item('lavamanos', 'bathroom', 'vanity', [0.8, 0.85, 0.5]),
  item('fregadero', 'kitchen', 'sink', [1, 0.9, 0.6]),
  item('bajo', 'kitchen', 'kitchen-base', [0.8, 0.9, 0.6]),
  item('cortinas', 'textile', 'curtains', [2.2, 2.4, 0.12], 'wall', { elevationDefaultM: 0 }),
  item('cuadro-grande', 'wall-decor', 'wall-art', [1.2, 0.8, 0.035], 'wall', { elevationDefaultM: 1.2 }),
  item('cuadro-chico', 'wall-decor', 'wall-art', [0.5, 0.7, 0.03], 'wall', { elevationDefaultM: 1.3, styleTags: ['moderno'] }),
  item('tele', 'electronics', 'tv', [1.23, 0.71, 0.06], 'wall', { elevationDefaultM: 1 }),
  item('espejo', 'wall-decor', 'mirror', [0.7, 0.7, 0.03], 'wall', { elevationDefaultM: 1.2 }),
  item('alacena', 'kitchen', 'kitchen-wall', [0.8, 0.7, 0.35], 'wall', { elevationDefaultM: 1.45 }),
  item('repisa', 'wall-decor', 'wall-shelf', [0.8, 0.2, 0.22], 'wall', { elevationDefaultM: 1.4 }),
  item('lampara-mesa', 'lighting', 'table-lamp', [0.3, 0.5, 0.3], 'surface'),
  item('lampara-escritorio', 'lighting', 'desk-lamp', [0.18, 0.45, 0.4], 'surface'),
  item('planta-mesa', 'decor', 'plant', [0.25, 0.35, 0.25], 'surface'),
  item('libros', 'decor', 'books', [0.28, 0.12, 0.2], 'surface'),
];
const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

/** Coloca un mueble de piso contra una pared, centrado en `along` (por defecto, a la mitad). */
function against(shell: RoomShell, wallId: string, catalogItemId: string, t = 0.5, id = catalogItemId): FurniturePlacement {
  const wall = wallFrames(shell).find((f) => f.id === wallId)!;
  const dims = BY_ID.get(catalogItemId)!.dimensionsM;
  return { id, catalogItemId, position: positionOnWall(wall, wall.length * t, 0, dims.z + 0.04), rotationY: wall.rotationY, lockedByUser: false };
}

const subOf = (p: FurniturePlacement) => BY_ID.get(p.catalogItemId)!.subcategory;
const only = (added: FurniturePlacement[], sub: string) => added.filter((p) => subOf(p) === sub);
const noWindows = (shell: RoomShell): RoomShell => ({ ...shell, openings: shell.openings.filter((o) => o.type !== 'window') });

describe('decorate', () => {
  const shell = createRectangularShell(5, 4, 2.6);
  const windowWall = shell.openings.find((o) => o.type === 'window')!.wallId;
  const freeWall = shell.walls.find((w) => !shell.openings.some((o) => o.wallId === w.id))!.id;

  it('cuelga un cuadro centrado sobre el sofá, por encima del respaldo', () => {
    const sofa = against(shell, freeWall, 'sofa');
    const added = decorate({ shell, roomType: 'living', styleId: null, placements: [sofa], items: CATALOG });
    const [art] = only(added, 'wall-art');
    const wall = wallFrames(shell).find((f) => f.id === freeWall)!;
    expect(art).toMatchObject({ wallId: freeWall, origin: 'layout', lockedByUser: false });
    expect(alongOf(wall, art!.position)).toBeCloseTo(alongOf(wall, sofa.position), 3);
    expect(art!.elevationM).toBeGreaterThanOrEqual(0.8 + 0.2);
    // Cabe sobre el sofá: el grande (1,2 m) antes que el chico.
    expect(art!.catalogItemId).toBe('cuadro-grande');
  });

  it('prefiere la pieza del estilo elegido', () => {
    const added = decorate({ shell, roomType: 'living', styleId: 'moderno', placements: [against(shell, freeWall, 'sofa')], items: CATALOG });
    expect(only(added, 'wall-art')[0]!.catalogItemId).toBe('cuadro-chico');
  });

  it('pone cortinas a la medida de cada ventana, aunque haya un sofá delante', () => {
    const under = shell.openings.find((o) => o.type === 'window')!.offsetM / wallFrames(shell).find((f) => f.id === windowWall)!.length;
    const added = decorate({ shell, roomType: 'living', styleId: null, placements: [against(shell, windowWall, 'sofa', under)], items: CATALOG });
    const window = shell.openings.find((o) => o.type === 'window')!;
    const [curtains] = only(added, 'curtains');
    expect(curtains!.wallId).toBe(windowWall);
    expect(curtains!.dimensionsM!.x).toBeGreaterThan(window.widthM);
    expect(curtains!.dimensionsM!.x).toBeLessThanOrEqual(2.2 * 1.3 + 1e-9);
    expect(curtains!.elevationM! + curtains!.dimensionsM!.y).toBeGreaterThan(window.sillHeightM + window.heightM);
  });

  it('un cuadro nunca tapa una ventana: si no cabe sobre el sofá, va a otra pared', () => {
    const sofa = against(shell, windowWall, 'sofa', shell.openings.find((o) => o.type === 'window')!.offsetM / wallFrames(shell).find((f) => f.id === windowWall)!.length);
    const added = decorate({ shell, roomType: 'living', styleId: null, placements: [sofa], items: CATALOG });
    const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));
    for (const art of only(added, 'wall-art')) {
      const wall = frames.get(art.wallId!)!;
      const dims = BY_ID.get(art.catalogItemId)!.dimensionsM;
      expect(overlapsOpening(shell, wall, alongOf(wall, art.position), dims.x, art.elevationM!, dims.y)).toBe(false);
    }
    expect(only(added, 'wall-art')).toHaveLength(1);
  });

  it('dormitorio: una lámpara sobre cada mesita, a la altura de su tapa', () => {
    const room = noWindows(shell);
    const placements = [against(room, freeWall, 'cama'), against(room, freeWall, 'mesita', 0.2, 'm1'), against(room, freeWall, 'mesita', 0.8, 'm2')];
    const added = decorate({ shell: room, roomType: 'bedroom', styleId: null, placements, items: CATALOG });
    const lamps = only(added, 'table-lamp');
    expect(lamps.map((l) => l.supportId).sort()).toEqual(['m1', 'm2']);
    for (const lamp of lamps) expect(lamp.position.y).toBeCloseTo(0.5);
    expect(only(added, 'wall-art')).toHaveLength(1);
  });

  it('sala con mueble de tele: la tele va en la pared, encima', () => {
    const stand = against(noWindows(shell), freeWall, 'mueble-tv');
    const added = decorate({ shell: noWindows(shell), roomType: 'living', styleId: null, placements: [stand], items: CATALOG });
    const [tv] = only(added, 'tv');
    expect(tv!.wallId).toBe(freeWall);
    expect(tv!.elevationM).toBeCloseTo(0.45 + 0.18);
  });

  it('cocina y baño: alacenas sobre la hilera y espejo sobre el lavamanos', () => {
    const room = noWindows(shell);
    // Con ventana y todo, ni la cocina ni el baño llevan cortinas.
    expect(only(decorate({ shell, roomType: 'kitchen', styleId: null, placements: [], items: CATALOG }), 'curtains')).toHaveLength(0);
    const kitchen = decorate({ shell: room, roomType: 'kitchen', styleId: null, placements: [against(room, freeWall, 'fregadero', 0.3), against(room, freeWall, 'bajo', 0.6)], items: CATALOG });
    expect(only(kitchen, 'kitchen-wall').length).toBeGreaterThanOrEqual(2);
    expect(only(kitchen, 'wall-art')).toHaveLength(0);
    const bath = decorate({ shell: room, roomType: 'bathroom', styleId: null, placements: [against(room, freeWall, 'lavamanos')], items: CATALOG });
    expect(only(bath, 'mirror')[0]!.elevationM).toBeCloseTo(0.85 + 0.2);
  });

  it('oficina: repisa sobre el escritorio y, encima de él, lámpara y libros', () => {
    const room = noWindows(shell);
    const added = decorate({ shell: room, roomType: 'office', styleId: null, placements: [against(room, freeWall, 'escritorio')], items: CATALOG });
    expect(only(added, 'wall-shelf')).toHaveLength(1);
    expect(only(added, 'desk-lamp')[0]!.supportId).toBe('escritorio');
    expect(only(added, 'books')[0]!.supportId).toBe('escritorio');
  });

  it('nada de lo añadido choca entre sí ni con lo que había', () => {
    const placements = [against(shell, freeWall, 'sofa'), against(shell, windowWall, 'mueble-tv', 0.5)];
    const added = decorate({ shell, roomType: 'living', styleId: null, placements, items: CATALOG });
    const bodies = [...placements, ...added].map((p) => bodyOf(p, BY_ID.get(p.catalogItemId)!));
    for (const a of bodies) for (const b of bodies) expect(bodiesCollide(a, b), `${a.id} / ${b.id}`).toBe(false);
    expect(added.length).toBeGreaterThan(2);
  });

  it('es repetible, varía con la semilla y no vuelve a decorar lo ya decorado', () => {
    const placements = [against(shell, freeWall, 'sofa')];
    const base = { shell, roomType: 'living' as const, styleId: null, placements, items: CATALOG };
    const first = decorate(base);
    expect(decorate(base)).toEqual(first);
    expect(decorate({ ...base, seed: 3 }).map((p) => p.id)).not.toEqual(first.map((p) => p.id));
    const again = decorate({ ...base, placements: [...placements, ...first] });
    expect(only(again, 'curtains')).toHaveLength(0);
    expect(only(again, 'wall-art')).toHaveLength(0);
  });

  it('sin piezas de decoración en el catálogo no añade nada', () => {
    const floorOnly = CATALOG.filter((i) => i.mount === 'floor');
    expect(decorate({ shell, roomType: 'living', styleId: null, placements: [against(shell, freeWall, 'sofa')], items: floorOnly })).toEqual([]);
  });
});
