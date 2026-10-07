import { describe, expect, it } from 'vitest';
import type { CatalogItem, FurniturePlacement } from './domain.js';
import { DesignOperationSchema } from './design-operations.js';
import { DesignToolbox } from './design-toolbox.js';
import { createRectangularShell } from './geometry.js';

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

const CATALOG: CatalogItem[] = [
  item({ id: 'bed', name: 'Cama doble', category: 'bed', tags: ['cama'], dimensionsM: { x: 1.6, y: 1.0, z: 2.1 } }),
  item({ id: 'nightstand', name: 'Mesa de noche', category: 'table', subcategory: 'nightstand', tags: ['mesita'], dimensionsM: { x: 0.5, y: 0.55, z: 0.4 } }),
  item({ id: 'lamp', name: 'Lámpara de mesa', category: 'lighting', subcategory: 'table-lamp', mount: 'surface', tags: ['lampara', 'luz'], dimensionsM: { x: 0.3, y: 0.5, z: 0.3 } }),
  item({
    id: 'sofa',
    name: 'Sofá tres puestos',
    category: 'sofa',
    tags: ['sofa'],
    dimensionsM: { x: 2.1, y: 0.84, z: 0.92 },
    resize: { x: [1.6, 2.6] },
    materialSlots: [{ slot: 'tapizado', label: 'Tapizado', default: 'fabric-linen-sand', allowedKinds: ['fabric', 'leather'] }],
  }),
];

const bedroom = (): FurniturePlacement[] => [{ id: 'b1', catalogItemId: 'bed', position: { x: 2.25, y: 0, z: 1.05 }, rotationY: 0, lockedByUser: true }];

function toolbox(placements = bedroom()) {
  let n = 0;
  return new DesignToolbox({ shell: createRectangularShell(4.5, 4, 2.6), placements, finishes: null, catalog: CATALOG, newId: () => `new-${++n}` });
}
const data = (content: string) => JSON.parse(content) as Record<string, unknown>;

describe('DesignToolbox', () => {
  it('busca en el catálogo por texto y devuelve medidas en cm', () => {
    const out = toolbox().run('search_catalog', { query: 'lampara' });
    expect(out.ok).toBe(true);
    expect(data(out.content)['results']).toEqual([expect.objectContaining({ id: 'lamp', sizeCm: { width: 30, height: 50, depth: 30 } })]);
  });

  it('valida la entrada como haría con la del modelo', () => {
    const out = toolbox().run('add_item', { catalogItemId: 'nightstand', relation: 'cerca' });
    expect(out.ok).toBe(false);
    expect(out.summary).toMatch(/Entrada inválida/);
    expect(toolbox().run('borrar_todo', {}).ok).toBe(false);
  });

  it('agrega con relaciones y las operaciones salen como diferencia', () => {
    const tb = toolbox();
    expect(tb.run('add_item', { catalogItemId: 'nightstand', relation: 'right-of', nearId: 'b1' }).ok).toBe(true);
    const lamp = tb.run('add_item', { catalogItemId: 'lamp', relation: 'next-to', nearId: 'b1' });
    expect(data(lamp.content)).toMatchObject({ ok: true, onTopOf: 'new-1' });
    const ops = tb.operations();
    expect(ops.map((o) => o.op)).toEqual(['add', 'add']);
    for (const op of ops) expect(DesignOperationSchema.safeParse(op).success).toBe(true);
    expect(ops[0]).toMatchObject({ placement: { id: 'new-1', origin: 'chat', lockedByUser: true } });
  });

  it('mover un soporte se lleva lo que tiene encima', () => {
    const tb = toolbox();
    tb.run('add_item', { catalogItemId: 'nightstand', relation: 'right-of', nearId: 'b1' });
    tb.run('add_item', { catalogItemId: 'lamp', relation: 'on-top-of', nearId: 'new-1' });
    expect(tb.run('move_item', { id: 'new-1', relation: 'left-of', nearId: 'b1' }).ok).toBe(true);
    const [stand, lamp] = ['new-1', 'new-2'].map((id) => tb.scenePlacements.find((p) => p.id === id)!);
    expect(stand!.position.x).toBeLessThan(2.25);
    expect(lamp!.position.x).toBeCloseTo(stand!.position.x);
    expect(lamp!.position.y).toBeCloseTo(0.55);
  });

  it('quitar un soporte quita lo que tiene encima; quitar algo original es un remove', () => {
    const tb = toolbox();
    tb.run('add_item', { catalogItemId: 'nightstand', relation: 'right-of', nearId: 'b1' });
    tb.run('add_item', { catalogItemId: 'lamp', relation: 'on-top-of', nearId: 'new-1' });
    expect(data(tb.run('remove_item', { id: 'new-1' }).content)['removed']).toEqual(['new-1', 'new-2']);
    tb.run('remove_item', { id: 'b1' });
    // Lo agregado y luego quitado no genera operaciones; la cama original sí.
    expect(tb.operations()).toEqual([{ op: 'remove', id: 'b1' }]);
  });

  it('cambiar tamaño respeta el rango del mueble y lo avisa', () => {
    const tb = toolbox([{ id: 's1', catalogItemId: 'sofa', position: { x: 2.25, y: 0, z: 2.5 }, rotationY: 0, lockedByUser: true }]);
    const out = tb.run('resize_item', { id: 's1', widthCm: 400 });
    expect(data(out.content)).toMatchObject({ ok: true, sizeCm: { width: 260 }, note: expect.stringMatching(/rango/) });
    expect(tb.operations()).toEqual([{ op: 'update', placement: expect.objectContaining({ id: 's1', dimensionsM: { x: 2.6, y: 0.84, z: 0.92 } }) }]);
  });

  it('materiales: solo los que admite la parte del mueble', () => {
    const tb = toolbox([{ id: 's1', catalogItemId: 'sofa', position: { x: 2.25, y: 0, z: 2.5 }, rotationY: 0, lockedByUser: true }]);
    expect(tb.run('set_material', { id: 's1', slot: 'tapizado', materialId: 'wood-oak' }).summary).toMatch(/no sirve/);
    expect(tb.run('set_material', { id: 's1', slot: 'patas', materialId: 'wood-oak' }).summary).toMatch(/Partes: tapizado/);
    expect(tb.run('set_material', { id: 's1', slot: 'tapizado', materialId: 'leather-cognac' }).ok).toBe(true);
    expect(tb.operations()[0]).toMatchObject({ op: 'update', placement: { materials: { tapizado: 'leather-cognac' } } });
  });

  it('acabados y medidas del cuarto', () => {
    const tb = toolbox();
    expect(tb.run('set_finishes', { walls: 'paint-sage', floor: 'wood-walnut' }).ok).toBe(true);
    expect(tb.run('set_finishes', { floor: 'paint-sage' }).summary).toMatch(/no sirve para el piso/);
    expect(tb.run('set_room_size', { widthM: 2.4, depthM: 2.5 }).ok).toBe(true);
    const ops = tb.operations();
    expect(ops[0]).toEqual({ op: 'room', widthM: 2.4, depthM: 2.5, heightM: 2.6 });
    expect(ops[1]).toEqual({ op: 'finishes', finishes: { floor: 'wood-walnut', walls: { all: 'paint-sage' }, ceiling: 'paint-white' } });
    // La cama se re-encajó dentro del cuarto más chico.
    expect(ops.some((o) => o.op === 'update' && o.placement.id === 'b1')).toBe(true);
  });

  it('get_scene describe piezas e ids para el modelo', () => {
    const scene = data(toolbox().run('get_scene', {}).content) as { room: { widthM: number }; placements: { id: string; name: string }[] };
    expect(scene.room.widthM).toBe(4.5);
    expect(scene.placements).toEqual([expect.objectContaining({ id: 'b1', name: 'Cama doble' })]);
  });

  it('si no cabe, explica el motivo y no cambia nada', () => {
    const tb = toolbox();
    const out = tb.run('add_item', { catalogItemId: 'sofa', relation: 'in-front-of', nearId: 'nada' });
    expect(out).toMatchObject({ ok: false, summary: expect.stringMatching(/No existe/) });
    expect(tb.operations()).toEqual([]);
  });
});
