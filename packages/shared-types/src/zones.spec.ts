import { describe, expect, it } from 'vitest';
import {
  DesignBriefSchema,
  RoomFinishesSchema,
  RoomShellSchema,
  type RoomShell,
  type Zone,
} from './domain.js';
import { customFinishId, FinishSpecSchema } from './finish-spec.js';
import { createRectangularShell, RoomGeometryError, validateRoomShell } from './geometry.js';
import { assertValidFinishes, DEFAULT_FINISHES, resolveFinishMaterial, UnknownMaterialError } from './materials.js';
import { cornerZone, partitions, partitionSolids, validateZones, zoneArea, zoneAt, zoneEdges } from './zones.js';

/** Baño privado de 2 × 1.8 m en la esquina del fondo a la derecha de un cuarto de 4.5 × 4. */
const bath = (patch: Partial<Zone> = {}): Zone => ({
  id: 'z-bath',
  kind: 'bathroom',
  name: 'Baño privado',
  outline: [
    { x: 2.5, z: 2.2 },
    { x: 4.5, z: 2.2 },
    { x: 4.5, z: 4 },
    { x: 2.5, z: 4 },
  ],
  open: false,
  door: { edge: 3, offsetM: 0.9, widthM: 0.75 },
  ...patch,
});

const shellWith = (...zones: Zone[]): RoomShell => ({ ...createRectangularShell(4.5, 4, 2.6), zones });

describe('zonas interiores', () => {
  it('distingue los tabiques de los lados que van sobre una pared', () => {
    const edges = zoneEdges(shellWith(), bath());
    expect(edges.map((e) => e.partition)).toEqual([true, false, false, true]);
    expect(edges[0]!.lengthM).toBeCloseTo(2);
    expect(zoneArea(bath())).toBeCloseTo(3.6);
  });

  it('una zona abierta no levanta tabiques', () => {
    expect(zoneEdges(shellWith(), bath({ open: true })).every((e) => !e.partition)).toBe(true);
  });

  it('acepta un baño privado bien puesto y lo valida con el cuarto', () => {
    const shell = shellWith(bath());
    expect(() => validateRoomShell(shell)).not.toThrow();
    expect(RoomShellSchema.parse(shell).zones).toHaveLength(1);
    expect(zoneAt(shell, { x: 3.5, z: 3 })?.id).toBe('z-bath');
    expect(zoneAt(shell, { x: 1, z: 1 })).toBeNull();
  });

  it('rechaza zonas fuera del cuarto, chicas, encimadas o con la puerta en una pared', () => {
    const outside = bath({ outline: [{ x: 3, z: 3 }, { x: 5, z: 3 }, { x: 5, z: 4 }, { x: 3, z: 4 }] });
    expect(() => validateZones(shellWith(outside))).toThrow(/se sale/);
    const tiny = bath({ outline: [{ x: 4, z: 3.5 }, { x: 4.5, z: 3.5 }, { x: 4.5, z: 4 }, { x: 4, z: 4 }], door: undefined });
    expect(() => validateZones(shellWith(tiny))).toThrow(/chica/);
    const other = bath({ id: 'z-closet', kind: 'closet', name: 'Vestidor', door: undefined });
    expect(() => validateZones(shellWith(bath(), other))).toThrow(/enciman/);
    expect(() => validateZones(shellWith(bath({ door: { edge: 1, offsetM: 0.9, widthM: 0.75 } })))).toThrow(RoomGeometryError);
    expect(() => validateZones(shellWith(bath({ door: { edge: 0, offsetM: 0.2, widthM: 0.75 } })))).toThrow(/no cabe/);
    expect(() => validateZones(shellWith(bath(), bath()))).toThrow(/mismo id/);
  });

  it('dos zonas que comparten un lado no se enciman', () => {
    const closet = bath({
      id: 'z-closet',
      kind: 'closet',
      door: undefined,
      // Desde x = 1,5: más a la izquierda, su tabique cortaría la puerta del cuarto.
      outline: [{ x: 1.5, z: 2.2 }, { x: 2.5, z: 2.2 }, { x: 2.5, z: 4 }, { x: 1.5, z: 4 }],
    });
    expect(() => validateZones(shellWith(bath(), closet))).not.toThrow();
  });
});

describe('acabados propios y por zona', () => {
  const tile = FinishSpecSchema.parse({ name: 'Baldosa azul y verde', kind: 'tile', colors: ['#a9d4ee', '#9bd3b0'], pattern: 'mosaic', gloss: 0.85, tileSizeM: 0.1 });
  const id = customFinishId(tile);

  it('el id de un acabado propio es estable y válido', () => {
    expect(id).toMatch(/^custom-tile-/);
    expect(customFinishId({ ...tile })).toBe(id);
    expect(customFinishId({ ...tile, colors: ['#ffffff'] })).not.toBe(id);
  });

  it('se resuelve como material brillante del color pedido', () => {
    const mat = resolveFinishMaterial({ custom: { [id]: tile } }, id)!;
    expect(mat.color).toBe('#a9d4ee');
    expect(mat.roughness).toBeLessThan(0.3);
    expect(mat.surfaces).toContain('floor');
    expect(resolveFinishMaterial(null, id)).toBeUndefined();
    expect(resolveFinishMaterial(null, 'wood-oak')?.name).toBe('Roble claro');
  });

  it('valida piso propio, revestimiento de pared y acabados de zona', () => {
    const finishes = RoomFinishesSchema.parse({
      ...DEFAULT_FINISHES,
      floor: id,
      custom: { [id]: tile },
      zones: { 'z-bath': { floor: 'ceramic-grey-tile', wallTiles: { material: id, heightM: 2.1 } } },
      lighting: { mood: 'calida', level: 'media' },
    });
    expect(() => assertValidFinishes(finishes, ['z-bath'])).not.toThrow();
    expect(() => assertValidFinishes(finishes, ['otra'])).toThrow(/zona que no existe/);
    expect(() => assertValidFinishes({ ...finishes, ceiling: id })).toThrow(UnknownMaterialError);
    expect(() => assertValidFinishes({ ...finishes, custom: {} })).toThrow(/desconocido/);
    expect(() => assertValidFinishes({ ...DEFAULT_FINISHES, wallTiles: { material: 'wood-oak', heightM: 1 } })).toThrow(/pared/);
  });
});

describe('brief de diseño', () => {
  it('lo fijado queda bloqueado por defecto y lo vacío es válido', () => {
    expect(DesignBriefSchema.parse({})).toEqual({ surfaces: {}, mustHave: [], avoid: [], zones: [] });
    const brief = DesignBriefSchema.parse({
      style: { id: 'moderno' },
      surfaces: { floor: { spec: { name: 'Azul', kind: 'tile', colors: ['#a9d4ee'] } } },
      mustHave: [{ subcategory: 'dressing-table' }],
      zones: [{ kind: 'bathroom', preset: 'banera-mampara' }],
    });
    expect(brief.style?.locked).toBe(true);
    expect(brief.surfaces.floor?.locked).toBe(true);
  });

  it('un acabado fijado lleva material o descripción, no los dos', () => {
    expect(() => DesignBriefSchema.parse({ surfaces: { floor: {} } })).toThrow();
    expect(() =>
      DesignBriefSchema.parse({ surfaces: { floor: { material: 'wood-oak', spec: { name: 'x', kind: 'wood', colors: ['#000000'] } } } }),
    ).toThrow();
  });
});

describe('tabiques y plantilla de baño en esquina', () => {
  it('cada tabique sabe dónde va su puerta y los tramos macizos dejan el hueco', () => {
    const shell = shellWith(bath());
    const walls = partitions(shell);
    expect(walls.map((p) => p.edge)).toEqual([0, 3]);
    expect(walls.find((p) => p.edge === 3)!.door).toEqual({ offsetM: 0.9, widthM: 0.75 });
    const solids = partitionSolids(shell);
    // El tabique 0 entero y el 3 en dos tramos, a cada lado de la puerta.
    expect(solids).toHaveLength(3);
    const gap = solids.slice(1).map((s) => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z));
    expect(gap.reduce((a, b) => a + b, 0)).toBeCloseTo(1.8 - 0.75);
    expect(partitions(shellWith(bath({ open: true })))).toEqual([]);
  });

  it('la plantilla pone el baño en la esquina más lejos de la puerta del cuarto, y es válida', () => {
    const shell = createRectangularShell(4.5, 4, 2.6);
    const zone = cornerZone(shell, { id: 'z', kind: 'bathroom', widthM: 2, depthM: 1.6 })!;
    expect(zone).not.toBeNull();
    expect(() => validateZones({ ...shell, zones: [zone] })).not.toThrow();
    expect(zoneArea(zone)).toBeCloseTo(3.2);
    const door = shell.openings.find((o) => o.type === 'door')!;
    const wall = shell.walls.find((w) => w.id === door.wallId)!;
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
    const doorAt = { x: wall.start.x + ((wall.end.x - wall.start.x) * door.offsetM) / len, z: wall.start.z + ((wall.end.z - wall.start.z) * door.offsetM) / len };
    expect(zoneAt({ zones: [zone] }, { x: doorAt.x + 0.01, z: doorAt.z + 0.01 })).toBeNull();
    expect(zone.door!.widthM).toBeCloseTo(0.7);
    // No cabe: más grande que el cuarto.
    expect(cornerZone(shell, { id: 'z', kind: 'bathroom', widthM: 5, depthM: 5 })).toBeNull();
  });
});

describe('tabiques y aberturas del cuarto', () => {
  it('un tabique no puede cortar una ventana; la plantilla busca otro rincón o se corre', () => {
    const base = createRectangularShell(4.5, 4, 2.6);
    const win = base.openings.find((o) => o.type === 'window');
    const zone = cornerZone(base, { id: 'z', kind: 'bathroom', widthM: 2, depthM: 1.6 })!;
    expect(() => validateZones({ ...base, zones: [zone] })).not.toThrow();
    if (win) {
      // Un baño cuyo tabique cae justo en el centro de la ventana se rechaza.
      const wall = base.walls.find((w) => w.id === win.wallId)!;
      const len = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
      const t = win.offsetM / len;
      const cut = { x: wall.start.x + (wall.end.x - wall.start.x) * t, z: wall.start.z + (wall.end.z - wall.start.z) * t };
      const inward = { x: -(wall.end.z - wall.start.z) / len, z: (wall.end.x - wall.start.x) / len };
      const along = { x: (wall.end.x - wall.start.x) / len, z: (wall.end.z - wall.start.z) / len };
      const pts = [cut, { x: cut.x + along.x * 1.6, z: cut.z + along.z * 1.6 }];
      const outline = [...pts, { x: pts[1]!.x + inward.x * 1.5, z: pts[1]!.z + inward.z * 1.5 }, { x: cut.x + inward.x * 1.5, z: cut.z + inward.z * 1.5 }];
      const bad = { id: 'bad', kind: 'bathroom' as const, outline, open: false };
      const fixed = validateZonesSafe({ ...base, zones: [bad] }) ?? validateZonesSafe({ ...base, zones: [{ ...bad, outline: [...outline].reverse() }] });
      expect(fixed).toMatch(/corta una puerta o una ventana|se sale/);
    }
  });
});

function validateZonesSafe(shell: Parameters<typeof validateZones>[0]): string | null {
  try {
    validateZones(shell);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
