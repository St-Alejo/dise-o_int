import { describe, expect, it } from 'vitest';
import {
  CatalogItemSchema,
  DesignProjectSchema,
  FurniturePlacementSchema,
  RoomShellSchema,
} from './domain.js';
import { CreateProjectFieldsSchema, UpdateRoomRequestSchema, UpdateSceneRequestSchema } from './api.js';
import {
  RoomGeometryError,
  clampDimensions,
  createRectangularShell,
  defaultResizeRanges,
  fitPlacementsToRoom,
  mountY,
  resizeRoomShell,
  validateOpenings,
  wallLength,
} from './geometry.js';
import {
  DEFAULT_FINISHES,
  MATERIALS,
  STYLE_FINISHES,
  UnknownMaterialError,
  assertValidFinishes,
  getMaterial,
  wallMaterialId,
} from './materials.js';
import { STYLE_IDS } from './domain.js';

const at = (x: number, z: number) => ({ x, y: 0, z });

describe('compatibilidad hacia atrás (proyectos guardados con el esquema v2)', () => {
  it('un placement viejo sigue siendo válido y sin campos nuevos', () => {
    const old = { id: 'p1', catalogItemId: 'sofa', position: at(1, 1), rotationY: 0, lockedByUser: false };
    expect(FurniturePlacementSchema.parse(old)).toEqual(old);
  });

  it('un ítem de catálogo viejo recibe tags y sinónimos vacíos', () => {
    const item = CatalogItemSchema.parse({
      id: 'sofa',
      name: 'Sofá',
      category: 'sofa',
      styleTags: [],
      roomTypes: ['living'],
      dimensionsM: { x: 2, y: 0.8, z: 0.9 },
      modelUrl: '/m.glb',
      license: 'cc0',
    });
    expect(item.tags).toEqual([]);
    expect(item.synonyms).toEqual([]);
    expect(item.mount).toBe('floor');
  });

  it('un proyecto sin acabados se lee con finishes = null', () => {
    const project = DesignProjectSchema.parse({
      id: 'x',
      ownerId: 'u',
      name: 'n',
      roomType: 'living',
      status: 'ready',
      lastError: null,
      sourcePhotoUrl: null,
      roomShell: null,
      stylePreviews: [],
      selectedStyleId: null,
      furniturePlacements: [],
      versions: [],
      visibility: 'private',
      saved: false,
      revision: 0,
      createdAt: 'a',
      updatedAt: 'b',
    });
    expect(project.finishes).toBeNull();
  });

  it('los campos nuevos del placement se validan (medidas positivas)', () => {
    const base = { id: 'p', catalogItemId: 'c', position: at(0, 0), rotationY: 0, lockedByUser: true };
    expect(FurniturePlacementSchema.safeParse({ ...base, dimensionsM: { x: 1, y: 1, z: 0 } }).success).toBe(false);
    expect(FurniturePlacementSchema.safeParse({ ...base, origin: 'chat', materials: { tela: 'fabric-wool-grey' } }).success).toBe(true);
  });
});

describe('resizeRoomShell (medidas exactas del cuarto)', () => {
  const shell = createRectangularShell(4, 3, 2.6);

  it('cambia ancho, largo y alto por separado y confirma la escala', () => {
    const r = resizeRoomShell(shell, { widthM: 5.2, depthM: 3.4, heightM: 2.4 });
    expect([r.widthM, r.depthM, r.heightM]).toEqual([5.2, 3.4, 2.4]);
    expect(r.scaleConfidence).toBe(1);
    expect(r.needsCalibration).toBe(false);
    expect(RoomShellSchema.safeParse(r).success).toBe(true);
    const back = r.walls.find((w) => w.id === 'w-back')!;
    const right = r.walls.find((w) => w.id === 'w-right')!;
    expect(wallLength(back)).toBeCloseTo(5.2);
    expect(wallLength(right)).toBeCloseTo(3.4);
  });

  it('las aberturas conservan su posición relativa en la pared', () => {
    const window = shell.openings.find((o) => o.type === 'window')!;
    const r = resizeRoomShell(shell, { widthM: 8, depthM: 3, heightM: 2.6 });
    const moved = r.openings.find((o) => o.id === window.id)!;
    expect(moved.offsetM / 8).toBeCloseTo(window.offsetM / 4);
  });

  it('al encoger mucho, las aberturas se recortan para caber', () => {
    const r = resizeRoomShell(shell, { widthM: 1, depthM: 1, heightM: 2 });
    expect(() => validateOpenings(r)).not.toThrow();
    for (const o of r.openings) expect(o.sillHeightM + o.heightM).toBeLessThanOrEqual(2);
  });

  it('un proyecto viejo con la misma ventana duplicada se puede redimensionar (se limpia el duplicado)', () => {
    // Regresión: datos reales del detector mock (dos ventanas idénticas en w-back).
    const win = { id: 'o-window-1', type: 'window' as const, wallId: 'w-back', widthM: 0.89, heightM: 0.81, offsetM: 2.72, sillHeightM: 0.93 };
    const legacy = { ...createRectangularShell(3.88, 3.56, 2.7, { window: false }), openings: [win, { ...win, id: 'o-window-2' }] };
    const r = resizeRoomShell(legacy, { widthM: 3.2, depthM: 2.9, heightM: 2.45 });
    expect(r.openings.filter((o) => o.type === 'window')).toHaveLength(1);
    expect(() => validateOpenings(r)).not.toThrow();
  });

  it('rechaza medidas fuera de rango con un mensaje claro', () => {
    expect(() => resizeRoomShell(shell, { widthM: 0.5, depthM: 3, heightM: 2.5 })).toThrow(/ancho/);
    expect(() => resizeRoomShell(shell, { widthM: 4, depthM: 3, heightM: 9 })).toThrow(RoomGeometryError);
  });

  it('acepta aberturas explícitas y rechaza las que no caben o se solapan', () => {
    const door = { id: 'd', type: 'door' as const, wallId: 'w-front', widthM: 0.9, heightM: 2.05, offsetM: 1, sillHeightM: 0 };
    const ok = resizeRoomShell(shell, { widthM: 4, depthM: 3, heightM: 2.6 }, [door]);
    expect(ok.openings).toEqual([door]);
    expect(ok.walls.find((w) => w.id === 'w-back')!.hasWindow).toBe(false);
    expect(() => resizeRoomShell(shell, { widthM: 4, depthM: 3, heightM: 2.6 }, [{ ...door, offsetM: 3.9 }])).toThrow(/no cabe/);
    expect(() =>
      resizeRoomShell(shell, { widthM: 4, depthM: 3, heightM: 2.6 }, [door, { ...door, id: 'd2', offsetM: 1.5 }]),
    ).toThrow(/solapan/);
    expect(() => resizeRoomShell(shell, { widthM: 4, depthM: 3, heightM: 2.6 }, [{ ...door, wallId: 'w-x' }])).toThrow(
      /inexistente/,
    );
  });
});

describe('fitPlacementsToRoom', () => {
  it('mete los muebles en el cuarto nuevo sin borrarlos y reporta los que no caben', () => {
    const placements = [
      { id: 'a', catalogItemId: 'sofa', position: at(3.5, 2.5), rotationY: 0, lockedByUser: false },
      { id: 'b', catalogItemId: 'cama', position: at(1, 1), rotationY: 0, lockedByUser: false },
    ];
    const dims = (p: { catalogItemId: string }) => (p.catalogItemId === 'sofa' ? { x: 2, y: 0.8, z: 0.9 } : { x: 3, y: 0.5, z: 2.2 });
    const res = fitPlacementsToRoom(placements, dims, { widthM: 2.5, depthM: 2.5 });
    expect(res.placements).toHaveLength(2);
    expect(res.moved).toContain('a');
    expect(res.tooBig).toEqual(['b']);
    const sofa = res.placements[0]!;
    expect(sofa.position.x + 1).toBeLessThanOrEqual(2.5 + 1e-9);
  });

  it('usa las medidas propias del mueble si las tiene', () => {
    const p = { id: 'a', catalogItemId: 'x', position: at(1, 1), rotationY: 0, lockedByUser: false, dimensionsM: { x: 1, y: 1, z: 1 } };
    const res = fitPlacementsToRoom([p], (q) => q.dimensionsM, { widthM: 3, depthM: 3 });
    expect(res.moved).toEqual([]);
  });
});

describe('medidas por pieza y montajes', () => {
  const catalogDims = { x: 2, y: 0.8, z: 0.9 };

  it('clampDimensions respeta rangos y fija los ejes no redimensionables', () => {
    const r = clampDimensions({ x: 5, y: 0.1, z: 1 }, catalogDims, { x: [1.6, 2.6], y: [0.6, 1] });
    expect(r).toEqual({ x: 2.6, y: 0.6, z: 0.9 });
  });

  it('defaultResizeRanges da ±30 %', () => {
    const r = defaultResizeRanges(catalogDims);
    expect(r.x).toEqual([1.4, 2.6]);
  });

  it('mountY: pared a la altura pedida sin atravesar el techo; superficie sobre su soporte', () => {
    const shell = { heightM: 2.5 };
    const art = { x: 0.8, y: 0.6, z: 0.04 };
    expect(mountY('wall', art, shell, { elevationM: 1.2 })).toBeCloseTo(1.2);
    expect(mountY('wall', art, shell, { elevationM: 3 })).toBeCloseTo(1.9);
    expect(mountY('wall', art, shell)).toBeCloseTo(1.2); // centrado a 1.5 m
    expect(mountY('surface', { x: 0.3, y: 0.5, z: 0.3 }, shell, { supportTopY: 0.55 })).toBeCloseTo(0.55);
    expect(mountY('ceiling', { x: 0.4, y: 0.9, z: 0.4 }, shell)).toBeCloseTo(1.6);
    expect(mountY('floor', art, shell)).toBe(0);
  });
});

describe('DTOs v3', () => {
  it('crear proyecto acepta medidas como texto (coma decimal) y exige las tres juntas', () => {
    const ok = CreateProjectFieldsSchema.parse({ widthM: '4,2', depthM: '3.5', heightM: '2.6' });
    expect([ok.widthM, ok.depthM, ok.heightM]).toEqual([4.2, 3.5, 2.6]);
    expect(CreateProjectFieldsSchema.parse({ widthM: '' }).widthM).toBeUndefined();
    expect(CreateProjectFieldsSchema.safeParse({ widthM: '4' }).success).toBe(false);
    expect(CreateProjectFieldsSchema.safeParse({ widthM: '40', depthM: '3', heightM: '2.5' }).success).toBe(false);
  });

  it('el schema del multipart es idempotente: parsear su propia salida da lo mismo', () => {
    // El pipe del controlador y el caso de uso lo aplican en serie.
    const once = CreateProjectFieldsSchema.parse({ name: 'x', styles: 'moderno,bohemio', widthM: '4', depthM: '3', heightM: '2.5' });
    expect(CreateProjectFieldsSchema.parse(once)).toEqual(once);
    expect(once.styles).toEqual(['moderno', 'bohemio']);
  });

  it('PUT room valida rangos; PUT scene acepta acabados opcionales', () => {
    expect(UpdateRoomRequestSchema.safeParse({ revision: 1, widthM: 4, depthM: 3, heightM: 2.5 }).success).toBe(true);
    expect(UpdateRoomRequestSchema.safeParse({ revision: 1, widthM: 4, depthM: 3, heightM: 1.5 }).success).toBe(false);
    expect(UpdateSceneRequestSchema.parse({ revision: 0, furniturePlacements: [], finishes: DEFAULT_FINISHES }).finishes).toEqual(
      DEFAULT_FINISHES,
    );
  });
});

describe('materiales', () => {
  it('ids únicos y propiedades PBR en rango', () => {
    expect(new Set(MATERIALS.map((m) => m.id)).size).toBe(MATERIALS.length);
    for (const m of MATERIALS) {
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(m.roughness).toBeGreaterThanOrEqual(0);
      expect(m.roughness).toBeLessThanOrEqual(1);
    }
  });

  it('cada estilo tiene una paleta de acabados válida', () => {
    for (const id of STYLE_IDS) expect(() => assertValidFinishes(STYLE_FINISHES[id])).not.toThrow();
    expect(() => assertValidFinishes(DEFAULT_FINISHES)).not.toThrow();
  });

  it('rechaza materiales inexistentes o en la superficie equivocada', () => {
    expect(() => assertValidFinishes({ ...DEFAULT_FINISHES, floor: 'nope' })).toThrow(UnknownMaterialError);
    expect(() => assertValidFinishes({ ...DEFAULT_FINISHES, floor: 'paint-white' })).toThrow(/piso|floor/);
  });

  it('una pared sin material propio hereda el de "all"', () => {
    const f = STYLE_FINISHES.industrial;
    expect(wallMaterialId(f, { id: 'w-back' })).toBe('paint-brick');
    expect(wallMaterialId(f, { id: 'w-left' })).toBe('paint-charcoal');
    expect(getMaterial('paint-brick')?.kind).toBe('paint');
  });
});
