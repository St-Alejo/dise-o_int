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
import { validateZones, zoneArea, zoneAt, zoneEdges } from './zones.js';

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
      outline: [{ x: 0.5, z: 2.2 }, { x: 2.5, z: 2.2 }, { x: 2.5, z: 4 }, { x: 0.5, z: 4 }],
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
