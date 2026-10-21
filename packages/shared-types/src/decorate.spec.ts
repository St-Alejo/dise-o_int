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
  item('estufa', 'kitchen', 'stove', [0.6, 0.9, 0.6]),
  item('cortinas', 'textile', 'curtains', [2.2, 2.4, 0.12], 'wall', { elevationDefaultM: 0 }),
  item('cortinas-verdes', 'textile', 'curtains', [2.6, 2.5, 0.15], 'wall', { elevationDefaultM: 0 }),
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
    // Entre dos cortinas igual de adecuadas, la más sobria (la primera), no la más grande.
    expect(curtains!.catalogItemId).toBe('cortinas');
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
    // Con estufa en medio de la hilera, encima de ella no va ninguna alacena.
    const wall = wallFrames(room).find((f) => f.id === freeWall)!;
    const row = [against(room, freeWall, 'bajo', 0.25, 'b1'), against(room, freeWall, 'estufa', 0.5), against(room, freeWall, 'bajo', 0.75, 'b2')];
    const stoveAt = alongOf(wall, row[1]!.position);
    const cabinets = only(decorate({ shell: room, roomType: 'kitchen', styleId: null, placements: row, items: CATALOG }), 'kitchen-wall');
    expect(cabinets.length).toBeGreaterThanOrEqual(2);
    for (const c of cabinets) expect(Math.abs(alongOf(wall, c.position) - stoveAt)).toBeGreaterThanOrEqual(0.3 + 0.4 - 0.03);
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

describe('decorate: baño y tocador', () => {
  const room = noWindows(createRectangularShell(4, 3, 2.6));
  const wallId = room.walls[0]!.id;
  const frame = wallFrames(room)[0]!;
  const EXTRA: DecorItem[] = [
    ...CATALOG,
    item('suspendido', 'bathroom', 'vanity', [0.8, 0.62, 0.46], 'wall', { elevationDefaultM: 0.38 }),
    item('ducha', 'bathroom', 'shower', [0.9, 2, 0.9]),
    item('toallero', 'bathroom', 'towel-rail', [0.6, 0.5, 0.1], 'wall', { elevationDefaultM: 0.95 }),
    item('alfombrilla', 'decor', 'rug', [0.8, 0.015, 0.5], 'floor', { roomTypes: ['bathroom'] }),
    item('tocador', 'table', 'dressing-table', [1, 1.45, 0.45]),
    item('banqueta', 'chair', 'vanity-stool', [0.45, 0.45, 0.35]),
  ];
  const ids = new Map(EXTRA.map((i) => [i.id, i]));
  const sub = (p: FurniturePlacement) => ids.get(p.catalogItemId)!.subcategory;

  it('espejo sobre el lavabo suspendido, alfombrilla delante y toallero junto a la ducha', () => {
    const hung: FurniturePlacement = {
      id: 'lav',
      catalogItemId: 'suspendido',
      position: positionOnWall(frame, 1, 0.38, 0.46),
      rotationY: frame.rotationY,
      lockedByUser: false,
      wallId,
      elevationM: 0.38,
    };
    const shower: FurniturePlacement = { ...against(room, wallId, 'lavamanos', 0.75, 'ducha'), catalogItemId: 'ducha', position: positionOnWall(frame, 3, 0, 0.94) };
    const added = decorate({ shell: room, roomType: 'bathroom', styleId: null, placements: [hung, shower], items: EXTRA });
    const mirror = added.find((p) => sub(p) === 'mirror')!;
    expect(mirror.elevationM).toBeCloseTo(0.38 + 0.62 + 0.2);
    const mat = added.find((p) => sub(p) === 'rug')!;
    // La alfombrilla queda delante del lavabo, en el piso y sin pisar la pared.
    expect(mat.position.y).toBe(0);
    expect(alongOf(frame, mat.position)).toBeCloseTo(1, 2);
    const rail = added.find((p) => sub(p) === 'towel-rail')!;
    expect(Math.abs(alongOf(frame, rail.position) - 3)).toBeCloseTo(0.45 + 0.3 + 0.15, 2);
    for (const a of added) {
      for (const b of [hung, shower, ...added]) {
        if (a !== b) expect(bodiesCollide(bodyOf(a, ids.get(a.catalogItemId)!), bodyOf(b, ids.get(b.catalogItemId)!))).toBe(false);
      }
    }
  });

  it('el tocador lleva su banqueta delante', () => {
    const table = { ...against(room, wallId, 'lavamanos', 0.5, 'toc'), catalogItemId: 'tocador', position: positionOnWall(frame, 2, 0, 0.49) };
    const added = decorate({ shell: room, roomType: 'bedroom', styleId: null, placements: [table], items: EXTRA });
    const stool = added.find((p) => sub(p) === 'vanity-stool')!;
    expect(alongOf(frame, stool.position)).toBeCloseTo(2, 2);
    expect(stool.rotationY).toBe(table.rotationY);
  });
});
