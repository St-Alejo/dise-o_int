import { describe, expect, it } from 'vitest';
import { bodiesCollide, bodyOf } from './collision.js';
import type { CatalogItem, FurniturePlacement } from './domain.js';
import { createRectangularShell } from './geometry.js';
import { SpatialResolver, type SceneModel } from './spatial-resolver.js';

const item = (over: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'category' | 'dimensionsM'>): CatalogItem => ({
  name: over.id,
  styleTags: [],
  roomTypes: [],
  mount: 'floor',
  modelUrl: '/m.glb',
  currency: 'USD',
  license: 'cc0',
  tags: [],
  synonyms: [],
  ...over,
});

const CATALOG = [
  item({ id: 'bed', name: 'Cama', category: 'bed', dimensionsM: { x: 1.6, y: 1.0, z: 2.1 } }),
  item({ id: 'nightstand', name: 'Mesa de noche', category: 'table', subcategory: 'nightstand', dimensionsM: { x: 0.5, y: 0.55, z: 0.4 } }),
  item({ id: 'lamp', name: 'Lámpara de mesa', category: 'lighting', subcategory: 'table-lamp', mount: 'surface', dimensionsM: { x: 0.3, y: 0.5, z: 0.3 } }),
  item({ id: 'art', name: 'Cuadro', category: 'wall-decor', mount: 'wall', elevationDefaultM: 1.3, dimensionsM: { x: 0.9, y: 0.6, z: 0.03 } }),
  item({ id: 'sofa', name: 'Sofá', category: 'sofa', dimensionsM: { x: 2.1, y: 0.84, z: 0.92 } }),
  item({ id: 'coffee', name: 'Mesa de centro', category: 'table', subcategory: 'coffee-table', dimensionsM: { x: 1.1, y: 0.42, z: 0.6 } }),
  item({ id: 'tvstand', name: 'Mueble TV', category: 'storage', subcategory: 'tv-stand', dimensionsM: { x: 1.6, y: 0.5, z: 0.42 } }),
  item({ id: 'pendant', name: 'Colgante', category: 'lighting', subcategory: 'pendant', mount: 'ceiling', dimensionsM: { x: 0.45, y: 0.9, z: 0.45 } }),
];
const catalog = new Map(CATALOG.map((c) => [c.id, c]));
const shell = createRectangularShell(4.5, 4, 2.6);
const at = (id: string, catalogItemId: string, x: number, z: number, rotationY = 0, extra: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id,
  catalogItemId,
  position: { x, y: 0, z },
  rotationY,
  lockedByUser: true,
  ...extra,
});

/** Dormitorio: cama contra la pared del fondo, mirando al frente (+Z). */
const bedroom = (): SceneModel => ({ shell, catalog, placements: [at('b1', 'bed', 2.25, 1.05)] });
/** Sala: sofá contra la pared del fondo. */
const living = (): SceneModel => ({ shell, catalog, placements: [at('s1', 'sofa', 2.25, 0.46)] });

function collidesWithScene(scene: SceneModel, id: string, itemId: string, pose: { position: { x: number; y: number; z: number }; rotationY: number; supportId?: string }) {
  const me = bodyOf({ id, ...pose }, catalog.get(itemId)!);
  return scene.placements.some((o) => bodiesCollide(me, bodyOf(o, catalog.get(o.catalogItemId)!)));
}

describe('SpatialResolver', () => {
  it('junto a la cama: al lado, con el respaldo alineado y sin chocar', () => {
    const scene = bedroom();
    const r = new SpatialResolver(scene).resolve('n', catalog.get('nightstand')!, { relation: 'next-to', nearId: 'b1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs(r.pose.position.x - 2.25)).toBeCloseTo(0.8 + 0.08 + 0.25, 2);
    expect(r.pose.position.z).toBeCloseTo(0.2, 2); // respaldo contra la pared, como la cama
    expect(collidesWithScene(scene, 'n', 'nightstand', r.pose)).toBe(false);
  });

  it('a la izquierda y a la derecha quedan en lados opuestos', () => {
    const resolver = new SpatialResolver(bedroom());
    const left = resolver.resolve('l', catalog.get('nightstand')!, { relation: 'left-of', nearId: 'b1' });
    const right = resolver.resolve('r', catalog.get('nightstand')!, { relation: 'right-of', nearId: 'b1' });
    expect(left.ok && right.ok).toBe(true);
    if (left.ok && right.ok) expect(Math.sign(left.pose.position.x - 2.25)).toBe(-Math.sign(right.pose.position.x - 2.25));
  });

  it('una lámpara "junto a la cama" va SOBRE la mesa de noche más cercana', () => {
    const scene = bedroom();
    scene.placements = [...scene.placements, at('n1', 'nightstand', 3.4, 0.2)];
    const r = new SpatialResolver(scene).resolve('l', catalog.get('lamp')!, { relation: 'next-to', nearId: 'b1' });
    expect(r).toMatchObject({ ok: true, pose: { supportId: 'n1', position: { y: 0.55 } } });
  });

  it('sobre un soporte ocupado o demasiado chico, lo explica', () => {
    const scene = bedroom();
    scene.placements = [...scene.placements, at('n1', 'nightstand', 3.4, 0.2), at('l1', 'lamp', 3.4, 0.2, 0, { supportId: 'n1', position: { x: 3.4, y: 0.55, z: 0.2 } })];
    const r = new SpatialResolver(scene).resolve('l2', catalog.get('lamp')!, { relation: 'on-top-of', nearId: 'n1' });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/Ya hay algo encima/) });
  });

  it('frente al sofá: mesa de centro mirando al sofá, separada 45 cm', () => {
    const r = new SpatialResolver(living()).resolve('c', catalog.get('coffee')!, { relation: 'in-front-of', nearId: 's1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pose.position.z).toBeCloseTo(0.92 + 0.45 + 0.3, 2);
    expect(r.pose.rotationY).toBeCloseTo(Math.PI);
  });

  it('enfrente del sofá (al otro lado): el mueble TV va contra la pared opuesta mirando al sofá', () => {
    const r = new SpatialResolver(living()).resolve('t', catalog.get('tvstand')!, { relation: 'facing', nearId: 's1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pose.position.z).toBeGreaterThan(3.2);
    expect(r.pose.rotationY).toBeCloseTo(Math.PI);
  });

  it('un cuadro "sobre el sofá" se cuelga en la pared detrás del sofá, por encima de él', () => {
    const noWindow = createRectangularShell(4.5, 4, 2.6, { window: false });
    const r = new SpatialResolver({ ...living(), shell: noWindow }).resolve('a', catalog.get('art')!, { relation: 'next-to', nearId: 's1' });
    expect(r).toMatchObject({ ok: true, pose: { wallId: 'w-back', rotationY: 0 } });
    if (!r.ok) return;
    expect(r.pose.position.x).toBeCloseTo(2.25, 1);
    expect(r.pose.position.y).toBeGreaterThanOrEqual(0.84 + 0.2 - 1e-9);
  });

  it('si detrás del sofá hay una ventana, lo cuelga en el lugar libre más cercano y lo explica', () => {
    const r = new SpatialResolver(living()).resolve('a', catalog.get('art')!, { relation: 'above', nearId: 's1' });
    expect(r).toMatchObject({ ok: true, note: expect.stringMatching(/ocupada/) });
  });

  it('el cuadro no tapa la ventana: se corre a un lado', () => {
    // La ventana está centrada en la pared del fondo: el cuadro centrado chocaría con ella.
    const r = new SpatialResolver({ shell, catalog, placements: [] }).resolve('a', catalog.get('art')!, { relation: 'against-wall', wallId: 'w-back' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.pose.position.x - 2.25) > 0.5 || r.pose.wallId !== 'w-back').toBe(true);
  });

  it('una lámpara de techo "encima de la mesa" cuelga sobre ella', () => {
    const scene = living();
    scene.placements = [...scene.placements, at('c1', 'coffee', 2.25, 1.6)];
    const r = new SpatialResolver(scene).resolve('p', catalog.get('pendant')!, { relation: 'above', nearId: 'c1' });
    expect(r).toMatchObject({ ok: true, pose: { position: { x: 2.25, z: 1.6, y: expect.closeTo(1.7, 3) } } });
  });

  it('en cualquier lugar busca un hueco libre; en un cuarto lleno lo explica', () => {
    const empty = new SpatialResolver({ shell, catalog, placements: [] }).resolve('s', catalog.get('sofa')!, { relation: 'anywhere' });
    expect(empty.ok).toBe(true);
    const tiny = createRectangularShell(1.5, 1.5, 2.5);
    const full = new SpatialResolver({ shell: tiny, catalog, placements: [] }).resolve('s', catalog.get('sofa')!, { relation: 'anywhere' });
    expect(full).toMatchObject({ ok: false, reason: expect.stringMatching(/espacio/) });
  });

  it('errores claros: referencia inexistente o falta la referencia', () => {
    const r = new SpatialResolver(living());
    expect(r.resolve('x', catalog.get('coffee')!, { relation: 'in-front-of', nearId: 'nada' })).toMatchObject({ ok: false, reason: expect.stringMatching(/No existe/) });
    expect(r.resolve('x', catalog.get('coffee')!, { relation: 'in-front-of' })).toMatchObject({ ok: false, reason: expect.stringMatching(/Falta/) });
  });

  it('si el lado pedido está ocupado, se corre un poco antes de rendirse', () => {
    const scene = bedroom();
    scene.placements = [...scene.placements, at('n1', 'nightstand', 2.25 + 0.8 + 0.08 + 0.25, 0.2)];
    const r = new SpatialResolver(scene).resolve('n2', catalog.get('nightstand')!, { relation: 'right-of', nearId: 'b1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(collidesWithScene(scene, 'n2', 'nightstand', r.pose)).toBe(false);
  });
});
