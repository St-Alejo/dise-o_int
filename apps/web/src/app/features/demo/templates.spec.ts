import { existsSync, readFileSync } from 'node:fs';
import { FURNISHED_TEMPLATES, FurnishedSceneSchema, buildRoomFromSpec, furnishedTemplateInfo } from '@interiores/shared-types';

/**
 * Las plantillas son archivos generados (`e2e/scripts/make-templates.mjs`): esta prueba avisa si
 * a una ficha le falta su escena o su imagen, o si la escena dejó de cumplir el contrato.
 */
describe('plantillas amuebladas', () => {
  it('hay varias, con ids únicos', () => {
    expect(FURNISHED_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(new Set(FURNISHED_TEMPLATES.map((t) => t.id)).size).toBe(FURNISHED_TEMPLATES.length);
    expect(furnishedTemplateInfo('no-existe')).toBeUndefined();
  });

  for (const template of FURNISHED_TEMPLATES) {
    it(`${template.id}: su escena es válida, está amueblada y tiene imagen`, () => {
      const scene = FurnishedSceneSchema.parse(JSON.parse(readFileSync(`public/escenas/${template.id}.json`, 'utf8')));
      expect(scene).toMatchObject({ id: template.id, name: template.name, roomType: template.roomType, styleId: template.styleId });
      expect(scene.furniturePlacements.length).toBeGreaterThanOrEqual(6);
      // Decorada: algo colgado en la pared, no solo muebles de piso.
      expect(scene.furniturePlacements.some((p) => p.wallId)).toBe(true);
      const expected = buildRoomFromSpec(template.spec);
      expect(scene.roomShell.widthM).toBeCloseTo(expected.widthM, 5);
      expect(scene.roomShell.walls).toHaveLength(expected.walls.length);
      expect(existsSync(`public/escenas/${template.id}.webp`)).toBe(true);
    });
  }
});
