import { DEFAULT_FINISHES, customFinishId } from '@interiores/shared-types';
import { applySpec, buildSpec, defaultName, kindsFor, pruneCustom } from './finish-spec-model';

describe('acabado a medida', () => {
  const tile = buildSpec({ name: 'Baldosa azul y verde', kind: 'tile', colors: ['#a9d4ee', '#4f8a52'], pattern: 'mosaic', gloss: 0.85 })!;

  it('cada superficie ofrece solo lo que le va', () => {
    expect(kindsFor('floor')).toContain('carpet');
    expect(kindsFor('floor')).not.toContain('paint');
    expect(kindsFor('walls')).toEqual(expect.arrayContaining(['paint', 'brick', 'tile']));
    expect(kindsFor('ceiling')).not.toContain('tile');
    expect(kindsFor('wallTiles')).toEqual(['tile', 'stone']);
  });

  it('valida con el esquema y pone un nombre que se entiende', () => {
    expect(tile.pattern).toBe('mosaic');
    expect(buildSpec({ name: 'x', kind: 'tile', colors: [] })).toBeNull();
    expect(buildSpec({ name: 'x', kind: 'tile', colors: ['azul'] })).toBeNull();
    expect(defaultName('tile', 'herringbone', 0.8)).toBe('Baldosa brillante espiga');
    expect(defaultName('paint', 'plain', 0.1)).toBe('Pintura mate');
  });

  it('se pone en la superficie, con su id, y lo que deja de usarse se descarta', () => {
    const id = customFinishId(tile);
    const floor = applySpec(DEFAULT_FINISHES, 'floor', tile);
    expect(floor.floor).toBe(id);
    expect(floor.custom?.[id]).toEqual(tile);
    const oneWall = applySpec(floor, 'walls', { ...tile, kind: 'paint', pattern: 'plain', colors: ['#f4f4f1'] }, { wall: 'w2' });
    expect(oneWall.walls['w2']).toMatch(/^custom-/);
    expect(oneWall.walls['all']).toBe(DEFAULT_FINISHES.walls['all']);
    const tiles = applySpec(oneWall, 'wallTiles', tile, { heightM: 9, roomHeightM: 2.6 });
    expect(tiles.wallTiles).toEqual({ material: id, heightM: 2.6 });
    // Otro piso: el acabado sigue vivo porque el revestimiento lo usa.
    expect(pruneCustom({ ...tiles, floor: 'wood-oak' }).custom?.[id]).toEqual(tile);
    expect(pruneCustom({ ...floor, floor: 'wood-oak' }).custom).toBeUndefined();
  });
});
