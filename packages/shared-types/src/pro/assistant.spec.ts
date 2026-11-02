import { describe, expect, it } from 'vitest';
import { DesignToolbox } from '../design-toolbox.js';
import { createRectangularShell } from '../geometry.js';
import { answerDrawings } from './assistant.js';
import { defaultTechnicalSpec } from './technical.js';

const shell = createRectangularShell(4, 3, 2.5);
const toolbox = () => new DesignToolbox({ shell, placements: [], finishes: null, catalog: [], newId: () => 'x', roomType: 'bedroom' });

describe('el chat responde lo del Modo Pro', () => {
  it('cómputo: total de obra, días y las compras del material pedido', () => {
    const all = toolbox().run('estimate_works', {});
    expect(all.ok).toBe(true);
    expect(all.summary).toMatch(/^Obra: .* con AIU, unos [\d,]+ días de trabajo \(piso de 12 m²\)/);
    const paint = toolbox().run('estimate_works', { material: 'pintura' });
    expect(paint.summary).toMatch(/^Para pintura: \d+ galon/);
    expect(toolbox().run('estimate_works', { material: 'mármol' }).summary).toMatch(/no hay compras de mármol/);
  });

  it('normativa: resume con el perfil y lo más grave', () => {
    const out = toolbox().run('check_compliance', {});
    expect(out.ok).toBe(true);
    expect(out.summary).toMatch(/perfil "Buenas prácticas \(Neufert\)"/);
  });

  it('instalaciones: propone sin guardar y dice cómo guardarlas', () => {
    const tb = toolbox();
    const out = tb.run('suggest_installations', {});
    expect(out.summary).toMatch(/× toma doble/);
    expect(out.summary).toMatch(/Proponer instalaciones/);
    expect(tb.operations()).toEqual([]);
  });

  it('planos: lista las láminas o nombra el alzado de una pared', () => {
    const spec = defaultTechnicalSpec();
    expect(answerDrawings({ shell, technical: spec }).summary).toMatch(/láminas: Planta arquitectónica/);
    const back = answerDrawings({ shell, technical: spec }, 'la pared del fondo');
    expect(back.data['elevation']).toMatch(/^E\d$/);
    expect(back.summary).toMatch(/La pared del fondo es el alzado E\d/);
  });
});
