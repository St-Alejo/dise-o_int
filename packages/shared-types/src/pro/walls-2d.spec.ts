import { describe, expect, it } from 'vitest';
import { createPolygonShell, createRectangularShell } from '../geometry.js';
import { defaultTechnicalSpec, technicalOf, TechnicalSpecSchema } from './technical.js';
import { builtAreas, outerOutline, partitionPieces, thickWalls, wallGaps, wallPieces } from './walls-2d.js';
import { signedArea } from '../polygon.js';

const spec = defaultTechnicalSpec();

describe('ficha técnica', () => {
  it('sin ficha vale la de por defecto, y completa los bloques que faltan', () => {
    expect(technicalOf(null)).toEqual(spec);
    const partial = technicalOf({ walls: { exteriorM: 0.2 }, titleBlock: { client: 'Ana' } });
    expect(partial.walls).toEqual({ exteriorM: 0.2, partitionM: 0.08, overrides: {} });
    expect(partial.titleBlock).toEqual({ revision: 'A', client: 'Ana' });
    expect(partial.sheet).toEqual({ paper: 'A3', scale: 50 });
  });

  it('rechaza grosores y escalas fuera de lo razonable', () => {
    expect(TechnicalSpecSchema.safeParse({ walls: { exteriorM: 2 } }).success).toBe(false);
    expect(TechnicalSpecSchema.safeParse({ sheet: { scale: 33 } }).success).toBe(false);
  });

  it('un punto de instalación va en una pared o en la planta', () => {
    const bad = { installations: { points: [{ id: 'p1', kind: 'outlet', heightM: 0.3 }] } };
    expect(TechnicalSpecSchema.safeParse(bad).success).toBe(false);
    const ok = { installations: { points: [{ id: 'p1', kind: 'outlet', heightM: 0.3, wallId: 'w-back', offsetM: 1 }] } };
    expect(TechnicalSpecSchema.safeParse(ok).success).toBe(true);
  });
});

describe('muros con grosor', () => {
  it('en un rectángulo la cara exterior es el cuarto agrandado por el grosor', () => {
    const shell = createRectangularShell(4, 3, 2.5, { door: false, window: false });
    const outer = outerOutline(shell, spec);
    const xs = outer.map((p) => p.x).sort((a, b) => a - b);
    const zs = outer.map((p) => p.z).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-0.15);
    expect(xs[3]).toBeCloseTo(4.15);
    expect(zs[0]).toBeCloseTo(-0.15);
    expect(zs[3]).toBeCloseTo(3.15);
    const { usefulM2, builtM2 } = builtAreas(shell, spec);
    expect(usefulM2).toBeCloseTo(12);
    expect(builtM2).toBeCloseTo(4.3 * 3.3);
  });

  it('en una L los muros se unen en inglete sin huecos (la suma de muros es el área construida menos la útil)', () => {
    const shell = createPolygonShell(
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
    const walls = thickWalls(shell, spec);
    const wallArea = walls.reduce((s, w) => s + Math.abs(signedArea([w.inner[0], w.inner[1], w.outer[1], w.outer[0]])), 0);
    const { usefulM2, builtM2 } = builtAreas(shell, spec);
    expect(wallArea).toBeCloseTo(builtM2 - usefulM2, 6);
    // En la esquina entrante el muro exterior queda dentro del rectángulo envolvente.
    expect(walls.every((w) => w.thicknessM === 0.15)).toBe(true);
  });

  it('un grosor propio de una pared manda sobre el general', () => {
    const shell = createRectangularShell(4, 3, 2.5, { door: false, window: false });
    const walls = thickWalls(shell, { walls: { ...spec.walls, overrides: { 'w-back': 0.3 } } });
    const back = walls.find((w) => w.wallId === 'w-back')!;
    expect(back.thicknessM).toBe(0.3);
    expect(back.outer[0].z).toBeCloseTo(-0.3);
  });

  it('los vanos parten el muro en tramos y el hueco mide lo que el vano', () => {
    const shell = createRectangularShell(4, 3, 2.5);
    const gaps = wallGaps(shell);
    expect(gaps.length).toBe(shell.openings.length);
    for (const g of gaps) expect(g.to - g.from).toBeCloseTo(g.opening.widthM);
    const pieces = wallPieces(shell, spec);
    expect(pieces.length).toBe(shell.walls.length + shell.openings.length);
    for (const p of pieces) expect(Math.abs(signedArea(p.outline))).toBeGreaterThan(0);
  });

  it('los tabiques de una zona tienen el grosor de tabique y dejan el hueco de la puerta', () => {
    const shell = {
      ...createRectangularShell(4.5, 4, 2.6, { door: false, window: false }),
      zones: [
        {
          id: 'z',
          kind: 'bathroom' as const,
          outline: [
            { x: 2.5, z: 2.2 },
            { x: 4.5, z: 2.2 },
            { x: 4.5, z: 4 },
            { x: 2.5, z: 4 },
          ],
          open: false,
          door: { edge: 3, offsetM: 0.9, widthM: 0.75 },
        },
      ],
    };
    const pieces = partitionPieces(shell, spec);
    // Lado de 2 m sin puerta (1 tramo) y lado de 1.8 m con puerta (2 tramos).
    expect(pieces.length).toBe(3);
    const area = pieces.reduce((s, p) => s + Math.abs(signedArea(p.outline)), 0);
    expect(area).toBeCloseTo((2 + 1.8 - 0.75) * 0.08, 6);
  });
});
