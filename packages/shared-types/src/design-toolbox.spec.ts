import { describe, expect, it } from 'vitest';
import type { CatalogItem, FurniturePlacement } from './domain.js';
import { DesignOperationSchema } from './design-operations.js';
import { DesignToolbox } from './design-toolbox.js';
import { createRectangularShell } from './geometry.js';
import { DEFAULT_FINISHES } from './materials.js';
import { addPrivateBathroom } from './zone-presets.js';

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
  it('set_finishes conserva acabados propios, revestimiento, zonas y luz', () => {
    let n = 0;
    const spec = { name: 'Baldosa azul', kind: 'tile' as const, colors: ['#a9d4ee'], pattern: 'grid' as const, gloss: 0.8 };
    const finishes = {
      floor: 'custom-x',
      walls: { all: 'paint-white' },
      ceiling: 'paint-white',
      custom: { 'custom-x': spec },
      wallTiles: { material: 'ceramic-subway-white', heightM: 1.2 },
      lighting: { mood: 'calida' as const, level: 'media' as const },
    };
    const tb = new DesignToolbox({ shell: createRectangularShell(4, 4, 2.6), placements: [], finishes, catalog: CATALOG, newId: () => `n${++n}` });
    expect(tb.run('set_finishes', { walls: 'paint-sage' }).ok).toBe(true);
    expect(tb.currentFinishes).toMatchObject({ floor: 'custom-x', custom: { 'custom-x': spec }, wallTiles: finishes.wallTiles, lighting: finishes.lighting });
    // Al cambiar el piso, el acabado propio que ya nadie usa se descarta.
    tb.run('set_finishes', { floor: 'wood-walnut' });
    expect(tb.currentFinishes?.custom).toBeUndefined();
  });

  it('acabado descrito con palabras: queda puesto y fijado en el Brief', () => {
    const tb = toolbox();
    const spec = { name: 'Baldosa brillante azul y verde', kind: 'tile', colors: ['#a9d4ee', '#4f8a52'], pattern: 'mosaic', gloss: 0.85 };
    const out = tb.run('set_finish_spec', { surface: 'floor', spec });
    expect(out.ok).toBe(true);
    expect(out.summary).toMatch(/fijado/);
    const ops = tb.operations();
    const fin = ops.find((o) => o.op === 'finishes');
    const brief = ops.find((o) => o.op === 'brief');
    expect(fin && fin.op === 'finishes' && fin.finishes.floor).toMatch(/^custom-/);
    expect(brief && brief.op === 'brief' && brief.brief.surfaces.floor).toMatchObject({ locked: true, spec: { colors: ['#a9d4ee', '#4f8a52'] } });
    for (const o of ops) expect(DesignOperationSchema.safeParse(o).success).toBe(true);
    // Una moqueta no va en la pared.
    expect(tb.run('set_finish_spec', { surface: 'walls', spec: { ...spec, kind: 'carpet' } }).ok).toBe(false);
  });

  it('revestimiento, luz, candados y piezas pedidas', () => {
    const tb = toolbox();
    expect(tb.run('set_wall_tiles', { materialId: 'ceramic-subway-white', fullHeight: true }).summary).toMatch(/2.6 m/);
    expect(tb.run('set_wall_tiles', { materialId: 'paint-sage' }).ok).toBe(false);
    expect(tb.run('set_lighting', { mood: 'calida', level: 'tenue', pin: true }).ok).toBe(true);
    expect(tb.run('pin', { target: 'walls' }).ok).toBe(true);
    expect(tb.run('pin', { target: 'style', styleId: 'industrial' }).ok).toBe(true);
    expect(tb.run('unpin', { target: 'style' }).ok).toBe(true);
    tb.run('want_item', { subcategory: 'dressing-table' });
    tb.run('want_item', { subcategory: 'rug', avoid: true });
    const brief = tb.currentBrief!;
    expect(brief.lighting).toEqual({ mood: 'calida', level: 'tenue', locked: true });
    expect(brief.surfaces.walls).toEqual({ material: 'paint-white', locked: true });
    expect(brief.style).toEqual({ id: 'industrial', locked: false });
    expect(brief.mustHave).toEqual([{ subcategory: 'dressing-table' }]);
    expect(brief.avoid).toEqual(['rug']);
    expect(tb.currentFinishes?.wallTiles).toEqual({ material: 'ceramic-subway-white', heightM: 2.6 });
  });

  it('baño privado: zona nueva, quita lo suelto que queda dentro y pide Recomendar al final', () => {
    // La mesita suelta queda en el centro de donde irá el baño; la cama (fijada) se queda.
    const { zone } = addPrivateBathroom(createRectangularShell(4.5, 4, 2.6), DEFAULT_FINISHES, 'spa-marmol');
    const c = zone.outline.reduce((a, p) => ({ x: a.x + p.x / zone.outline.length, z: a.z + p.z / zone.outline.length }), { x: 0, z: 0 });
    const loose: FurniturePlacement = { id: 'n1', catalogItemId: 'nightstand', position: { x: c.x, y: 0, z: c.z }, rotationY: 0 };
    const tb = toolbox([...bedroom(), loose]);
    const out = tb.run('add_zone', { kind: 'bathroom', preset: 'spa-marmol' });
    expect(out.ok).toBe(true);
    expect(tb.run('add_zone', { kind: 'bathroom', preset: 'nope' }).ok).toBe(false);
    tb.run('recommend', { intensity: 'suave' });
    const ops = tb.operations();
    expect(ops.map((o) => o.op)[0]).toBe('zones');
    expect(ops.at(-1)).toEqual({ op: 'recommend', intensity: 'suave' });
    const zoneId = (data(out.content) as { zoneId: string }).zoneId;
    const zones = ops[0]!.op === 'zones' ? ops[0]!.zones : [];
    expect(zones.map((z) => z.id)).toEqual([zoneId]);
    expect(ops).toContainEqual({ op: 'remove', id: 'n1' });
    expect(ops.some((o) => o.op === 'remove' && o.id === 'b1')).toBe(false);
    // Con zona, el acabado descrito puede ir solo al baño.
    expect(tb.run('set_finish_spec', { surface: 'floor', zoneId, spec: { name: 'Hex blanco', kind: 'tile', colors: ['#ffffff'], pattern: 'hex' } }).ok).toBe(true);
    expect(tb.currentFinishes?.zones?.[zoneId]?.floor).toMatch(/^custom-/);
    expect(tb.run('set_finish_spec', { surface: 'floor', zoneId: 'nada', spec: { name: 'x', kind: 'tile', colors: ['#ffffff'] } }).summary).toMatch(/No existe la zona/);
  });
});
