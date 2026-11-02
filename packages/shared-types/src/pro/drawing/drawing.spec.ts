import { describe, expect, it } from 'vitest';
import type { DesignPiece } from '../../design-check.js';
import { createPolygonShell, createRectangularShell } from '../../geometry.js';
import { defaultTechnicalSpec, type TechnicalSpec } from '../technical.js';
import { parseDxfEntities, renderDxf } from './dxf.js';
import { elevationView, sectionView } from './elevation.js';
import { hatchGeometry } from './hatch.js';
import { boundsOf, dimensionGeometry, formatMeters, walk, type DimensionEntity, type Drawing } from './model.js';
import { planView, PLAN_KINDS } from './plan-view.js';
import { drawingSet, sheetFor, PAPER_MM } from './sheet.js';
import { renderSvg } from './svg.js';

const spec = defaultTechnicalSpec();
const shell = createRectangularShell(4, 3, 2.6);
const sofa: DesignPiece = {
  id: 's1',
  name: 'Sofá',
  mount: 'floor',
  category: 'sofa',
  position: { x: 2, y: 0, z: 0.5 },
  rotationY: 0,
  dims: { x: 2, y: 0.85, z: 0.9 },
};
const lamp: DesignPiece = { id: 'l1', name: 'Lámpara colgante', mount: 'ceiling', category: 'lighting', position: { x: 2, y: 2.2, z: 1.5 }, rotationY: 0, dims: { x: 0.4, y: 0.4, z: 0.4 } };
const art: DesignPiece = { id: 'a1', name: 'Cuadro', mount: 'wall', category: 'wall-decor', position: { x: 1.5, y: 1.3, z: 0.02 }, rotationY: 0, dims: { x: 0.8, y: 0.6, z: 0.03 } };
const pieces = [sofa, lamp, art];

const dims = (d: Drawing): DimensionEntity[] => {
  const out: DimensionEntity[] = [];
  walk(d.entities, (e) => {
    if (e.kind === 'dimension') out.push(e);
  });
  return out;
};
const count = (d: Drawing, kind: string, layer?: string) => {
  let n = 0;
  walk(d.entities, (e) => {
    if (e.kind === kind && (!layer || e.layer === layer)) n++;
  });
  return n;
};

describe('modelo de dibujo', () => {
  it('acota en metros con coma decimal', () => {
    expect(formatMeters(3.456)).toBe('3,46');
    expect(formatMeters(4)).toBe('4,00');
  });

  it('el texto de una cota nunca queda boca abajo', () => {
    const g = dimensionGeometry({ a: { x: 4, y: 0 }, b: { x: 0, y: 0 }, offset: 0.5, height: 0.1 });
    expect(Math.abs(g.angle)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
  });

  it('el achurado diagonal queda dentro del contorno', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const g = hatchGeometry(square, 'diagonal', 0.1);
    expect(g.lines.length).toBeGreaterThan(10);
    for (const [a, b] of g.lines) for (const p of [a, b]) expect(p.x >= -1e-9 && p.x <= 1 + 1e-9 && p.y >= -1e-9 && p.y <= 1 + 1e-9).toBe(true);
  });
});

describe('plantas', () => {
  it('la planta arquitectónica encadena las cotas de cada muro y suman su largo', () => {
    const d = planView('architectural', { shell, spec, pieces, roomName: 'Sala' });
    const all = dims(d);
    // Pared del fondo (4 m) con su ventana: tramos encadenados + total.
    const back = all.filter((e) => Math.abs(e.a.y) < 1e-9 && Math.abs(e.b.y) < 1e-9);
    const total = back.find((e) => Math.abs(Math.abs(e.b.x - e.a.x) - 4) < 1e-9);
    expect(total?.text).toBe('4,00');
    const chain = back.filter((e) => e !== total).reduce((s, e) => s + Math.abs(e.b.x - e.a.x), 0);
    expect(chain).toBeCloseTo(4);
  });

  it('cada tipo de planta dibuja lo suyo', () => {
    const arch = planView('architectural', { shell, spec, pieces, roomName: 'Sala' });
    expect(count(arch, 'arc', 'door')).toBe(1);
    expect(count(arch, 'line', 'glazing')).toBe(2);
    const ceiling = planView('ceiling', { shell, spec, pieces, roomName: 'Sala' });
    expect(count(ceiling, 'circle', 'lighting')).toBe(1);
    expect(count(ceiling, 'arc', 'door')).toBe(0);
    const furniture = planView('furniture', { shell, spec, pieces, roomName: 'Sala' });
    let named = false;
    walk(furniture.entities, (e) => {
      if (e.kind === 'text' && e.text === 'Sofá') named = true;
    });
    expect(named).toBe(true);
    for (const kind of PLAN_KINDS) expect(planView(kind, { shell, spec, pieces, roomName: 'Sala' }).entities.length).toBeGreaterThan(10);
  });

  it('un cuarto en L también se dibuja con sus muros achurados', () => {
    const l = createPolygonShell(
      [
        { x: 0, z: 0 },
        { x: 5, z: 0 },
        { x: 5, z: 2 },
        { x: 3, z: 2 },
        { x: 3, z: 4 },
        { x: 0, z: 4 },
      ],
      2.6,
    );
    const d = planView('architectural', { shell: l, spec, pieces: [], roomName: 'Estudio' });
    expect(count(d, 'hatch', 'wallHatch')).toBe(6);
    const b = boundsOf(d.entities);
    expect(b.minX).toBeLessThan(-0.15);
    expect(b.maxX).toBeGreaterThan(5.15);
  });
});

describe('alzados y corte', () => {
  it('el alzado de la pared del fondo tiene su ventana, el cuadro y las cotas de largo y alto', () => {
    const d = elevationView('w-back', { shell, spec, pieces });
    expect(d.title).toBe('Alzado E1');
    const texts = dims(d).map((e) => e.text);
    expect(texts).toContain('4,00');
    expect(texts).toContain('2,60');
    // El cuadro va a 1,30 del piso y se acota.
    expect(texts).toContain('1,30');
    expect(count(d, 'polyline', 'glazing')).toBe(2);
  });

  it('el corte achura los dos muros que cruza', () => {
    const s: TechnicalSpec = { ...spec, section: { a: { x: -1, z: 1.5 }, b: { x: 5, z: 1.5 } } };
    const d = sectionView(s.section!, { shell, spec: s, pieces });
    // Dos muros + piso y techo.
    expect(count(d, 'hatch', 'wallHatch')).toBe(4);
    expect(dims(d).map((e) => e.text)).toContain('4,00');
  });
});

describe('láminas y exportación', () => {
  const input = { shell, spec, pieces, roomName: 'Sala', date: '2026-11-01' };

  it('el juego de planos numera las láminas y cabe en el papel', () => {
    const set = drawingSet(input);
    expect(set.map((s) => s.number)).toEqual(set.map((_, i) => `A-${String(i + 1).padStart(2, '0')}`));
    expect(set[0]!.title).toBe('Planta arquitectónica');
    const paper = PAPER_MM.A3;
    for (const sheet of set) {
      const b = boundsOf(sheet.entities);
      expect(b.maxX).toBeLessThanOrEqual(paper.w);
      expect(b.maxY).toBeLessThanOrEqual(paper.h);
      expect(b.minX).toBeGreaterThanOrEqual(0);
    }
  });

  it('si a la escala pedida no cabe, la lámina usa una menor y lo dice', () => {
    const big = createRectangularShell(14, 10, 2.6);
    const sheet = sheetFor('architectural', { ...input, shell: big, spec: { ...spec, sheet: { paper: 'A4', scale: 25 } } })!;
    expect(sheet.scale).toBeGreaterThan(25);
    expect(sheet.scaleAdjusted).toBe(true);
  });

  it('el SVG de una lámina mide su papel y lleva el cajetín', () => {
    const sheet = sheetFor('architectural', { ...input, spec: { ...spec, titleBlock: { revision: 'B', client: 'Ana <Ruiz>' } } })!;
    const svg = renderSvg(sheet);
    expect(svg).toContain('width="420mm" height="297mm"');
    expect(svg).toContain('Ana &lt;Ruiz&gt;');
    expect(svg).toContain('ESC. 1:50');
  });

  it('el DXF tiene capas por familia y se puede volver a leer', () => {
    const dxf = renderDxf([planView('architectural', { shell, spec, pieces, roomName: 'Sala' })]);
    expect(dxf.startsWith('0\r\nSECTION')).toBe(true);
    expect(dxf).toContain('AC1009');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    const entities = parseDxfEntities(dxf);
    const layers = new Set(entities.map((e) => e.layer));
    for (const l of ['A-WALL', 'A-WALL-PATT', 'A-DOOR', 'A-GLAZ', 'A-ANNO-DIMS', 'A-ANNO-TEXT']) expect(layers.has(l)).toBe(true);
    // La y va invertida: el muro del fondo (z = 0 a −0,15) queda en y ≥ 0.
    const wallYs = entities.filter((e) => e.type === 'VERTEX' && e.layer === 'A-WALL').map((e) => Number(e.values.get(20)![0]));
    expect(Math.max(...wallYs)).toBeCloseTo(0.15);
    // Los textos con tilde siguen siendo Latin-1 y el resto se escapa.
    const texts = entities.filter((e) => e.type === 'TEXT').map((e) => e.values.get(1)![0]!);
    expect(texts.some((t) => t.includes('m²'))).toBe(true);
  });

  it('el DXF escapa lo que no es Latin-1', () => {
    const dxf = renderDxf([sectionView({ a: { x: -1, z: 1.5 }, b: { x: 5, z: 1.5 } }, { shell, spec, pieces })]);
    expect(dxf).not.toMatch(/[^\x00-\xff]/);
  });
});
