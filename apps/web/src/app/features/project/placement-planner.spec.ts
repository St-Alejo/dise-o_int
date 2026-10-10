import { describe, expect, it } from 'vitest';
import {
  clampToRoom,
  createRectangularShell,
  distanceFromWall,
  footprint,
  footprintsOverlap,
  wallFrames,
  type CatalogItem,
  type FurniturePlacement,
  type Vector3,
} from '@interiores/shared-types';
import { planPlacement, type PlannerContext } from './placement-planner';

const shell = createRectangularShell(4, 3.5, 2.6);
const item = (over: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'category'>): CatalogItem =>
  ({
    name: over.id,
    styleTags: [],
    roomTypes: [],
    dimensionsM: { x: 0.5, y: 0.5, z: 0.5 },
    mount: 'floor',
    modelUrl: '/m.glb',
    currency: 'USD',
    license: 'cc0',
    tags: [],
    synonyms: [],
    ...over,
  }) as CatalogItem;

const nightstand = item({ id: 'mn', category: 'table', subcategory: 'nightstand', dimensionsM: { x: 0.5, y: 0.55, z: 0.4 } });
const desk = item({ id: 'desk', category: 'table', subcategory: 'desk', dimensionsM: { x: 1.3, y: 0.75, z: 0.65 } });
const lamp = item({ id: 'lamp', category: 'lighting', subcategory: 'table-lamp', mount: 'surface', dimensionsM: { x: 0.3, y: 0.5, z: 0.3 } });
const art = item({ id: 'art', category: 'wall-decor', subcategory: 'wall-art', mount: 'wall', elevationDefaultM: 1.3, dimensionsM: { x: 1.2, y: 0.8, z: 0.03 } });
const tv = item({ id: 'tv', category: 'electronics', subcategory: 'tv', mount: 'surface', dimensionsM: { x: 1.4, y: 0.9, z: 0.25 } });

/** Contexto con un validador equivalente al del store (misma capa = mismo montaje). */
function ctx(placements: FurniturePlacement[], items: CatalogItem[]): PlannerContext {
  const catalog = new Map(items.map((i) => [i.id, i]));
  const isPoseValid = (id: string, it: CatalogItem, pos: Vector3, rot: number) => {
    const c = clampToRoom(pos, it.dimensionsM, rot, shell);
    if (Math.abs(c.x - pos.x) > 1e-3 || Math.abs(c.z - pos.z) > 1e-3) return false;
    const fp = footprint(pos, it.dimensionsM, rot);
    return !placements.some((o) => {
      const oi = catalog.get(o.catalogItemId)!;
      return o.id !== id && oi.mount === it.mount && footprintsOverlap(fp, footprint(o.position, oi.dimensionsM, o.rotationY));
    });
  };
  return { shell, placements, catalog, isPoseValid, findFreeSpot: (_id, _it, near) => near };
}

const at = (id: string, catalogItemId: string, x: number, z: number, extra: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id,
  catalogItemId,
  position: { x, y: 0, z },
  rotationY: 0,
  lockedByUser: true,
  ...extra,
});

describe('planPlacement', () => {
  it('una lámpara de mesa va encima de la mesa de noche (antes que del escritorio)', () => {
    const plan = planPlacement('new', lamp, ctx([at('d', 'desk', 2, 1), at('n', 'mn', 0.5, 0.3)], [desk, nightstand, lamp]))!;
    expect(plan.supportId).toBe('n');
    expect(plan.position).toEqual({ x: 0.5, y: 0.55, z: 0.3 });
  });

  it('no apila dos objetos sobre el mismo soporte', () => {
    const placements = [at('n', 'mn', 0.5, 0.3), at('l1', 'lamp', 0.5, 0.3, { supportId: 'n' }), at('d', 'desk', 2, 1)];
    expect(planPlacement('new', lamp, ctx(placements, [desk, nightstand, lamp]))!.supportId).toBe('d');
  });

  it('sin soporte apropiado, un objeto de superficie va al piso; la TV nunca sobre la cama', () => {
    const bed = item({ id: 'bed', category: 'bed', dimensionsM: { x: 1.6, y: 0.6, z: 2 } });
    const plan = planPlacement('new', tv, ctx([at('b', 'bed', 2, 1.5)], [bed, tv]))!;
    expect(plan.supportId).toBeUndefined();
    expect(plan.position.x).toBeCloseTo(2);
  });

  it('un cuadro va contra la pared del fondo, mirando al cuarto y a su altura', () => {
    const plan = planPlacement('new', art, ctx([], [art]))!;
    expect(plan.wallId).toBe('w-back');
    expect(plan.rotationY).toBe(0);
    expect(plan.position.z).toBeCloseTo(0.015, 2);
    expect(plan.position.y).toBeCloseTo(1.3);
  });

  it('si la pared está ocupada, busca otro hueco o la siguiente pared, sin solaparse', () => {
    const placements: FurniturePlacement[] = [];
    for (let i = 0; i < 6; i++) {
      const plan = planPlacement(`a${i}`, art, ctx(placements, [art]));
      expect(plan, `cuadro ${i}`).not.toBeNull();
      placements.push(at(`a${i}`, 'art', plan!.position.x, plan!.position.z, { rotationY: plan!.rotationY, wallId: plan!.wallId! }));
    }
    expect(new Set(placements.map((p) => p.wallId)).size).toBeGreaterThan(1);
    // El que pasó a otra pared queda pegado a ella y mirando al cuarto.
    const other = placements.find((p) => p.wallId !== 'w-back')!;
    const frame = wallFrames(shell).find((w) => w.id === other.wallId)!;
    expect(other.rotationY).toBeCloseTo(frame.rotationY);
    expect(distanceFromWall(frame, other.position)).toBeCloseTo(0.015, 2);
  });

  it('si no cabe derecho, lo prueba girado 90°', () => {
    const sofa = item({ id: 'sofa', category: 'sofa', dimensionsM: { x: 2, y: 0.8, z: 0.9 } });
    const tried: number[] = [];
    const c: PlannerContext = {
      ...ctx([], [sofa]),
      findFreeSpot: (_id, _it, near, rot) => {
        tried.push(rot);
        return rot === 0 ? null : near; // derecho no cabe; girado sí
      },
    };
    const plan = planPlacement('new', sofa, c)!;
    expect(tried).toEqual([0, Math.PI / 2]);
    expect(plan.rotationY).toBeCloseTo(Math.PI / 2);
  });
});
