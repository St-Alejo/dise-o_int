import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPolygonShell, footprint } from './geometry.js';
import {
  ensureWinding,
  interiorAnchor,
  isConvexVertex,
  isSimplePolygon,
  pointInPolygon,
  quadInsidePolygon,
  segmentsCross,
  signedArea,
  type Point2,
} from './polygon.js';

interface Cases {
  polygons: Record<string, [number, number][]>;
  areas: Record<string, number>;
  wallIds: Record<string, string[]>;
  convex: Record<string, boolean[]>;
  points: { polygon: string; p: [number, number]; inside: boolean; note?: string }[];
  quads: { polygon: string; center: [number, number]; size: [number, number]; rotationY: number; inside: boolean; note?: string }[];
}

// Los mismos casos los corre pytest contra la geometría del servicio de IA.
const cases = JSON.parse(readFileSync(new URL('../fixtures/polygon-cases.json', import.meta.url), 'utf8')) as Cases;
const poly = (name: string): Point2[] => cases.polygons[name]!.map(([x, z]) => ({ x, z }));

describe('casos compartidos con el servicio de IA', () => {
  it.each(Object.entries(cases.areas))('área de %s', (name, area) => {
    expect(signedArea(poly(name))).toBeCloseTo(area);
  });

  it.each(Object.entries(cases.wallIds))('ids de las paredes de %s', (name, ids) => {
    expect(createPolygonShell(poly(name), 2.6).walls.map((w) => w.id)).toEqual(ids);
  });

  it.each(Object.entries(cases.convex))('esquinas salientes y entrantes de %s', (name, expected) => {
    expect(poly(name).map((_, i) => isConvexVertex(poly(name), i))).toEqual(expected);
  });

  it.each(cases.points)('punto $p en $polygon → dentro: $inside', ({ polygon, p, inside }) => {
    expect(pointInPolygon({ x: p[0], z: p[1] }, poly(polygon), 0.005)).toBe(inside);
  });

  it.each(cases.quads)('huella $size en $center de $polygon → dentro: $inside', ({ polygon, center, size, rotationY, inside }) => {
    const fp = footprint({ x: center[0], y: 0, z: center[1] }, { x: size[0], y: 1, z: size[1] }, rotationY);
    expect(quadInsidePolygon(fp.corners, fp.center, poly(polygon))).toBe(inside);
  });
});

describe('polígonos', () => {
  it('el sentido de giro no cambia qué queda dentro, y se puede normalizar', () => {
    const reversed = [...poly('L')].reverse();
    expect(signedArea(reversed)).toBeCloseTo(-17);
    expect(signedArea(ensureWinding(reversed))).toBeCloseTo(17);
    expect(pointInPolygon({ x: 4, z: 3.5 }, reversed)).toBe(false);
    expect(pointInPolygon({ x: 1, z: 1 }, reversed)).toBe(true);
    // Las esquinas entrantes lo siguen siendo aunque el polígono venga al revés.
    expect(reversed.filter((_, i) => !isConvexVertex(reversed, i))).toEqual([{ x: 3, z: 2.5 }]);
  });

  it('distingue un polígono simple de uno que se cruza', () => {
    expect(isSimplePolygon(poly('U'))).toBe(true);
    const bowtie = [
      { x: 0, z: 0 },
      { x: 2, z: 2 },
      { x: 2, z: 0 },
      { x: 0, z: 2 },
    ];
    expect(isSimplePolygon(bowtie)).toBe(false);
    expect(isSimplePolygon(poly('rect').slice(0, 2))).toBe(false);
  });

  it('dos segmentos que solo se tocan no se cruzan', () => {
    const p = (x: number, z: number) => ({ x, z });
    expect(segmentsCross(p(0, 0), p(2, 2), p(0, 2), p(2, 0))).toBe(true);
    expect(segmentsCross(p(0, 0), p(2, 0), p(1, 0), p(1, 2))).toBe(false); // en T
    expect(segmentsCross(p(0, 0), p(2, 0), p(0, 0), p(2, 0))).toBe(false); // encimados
  });

  it('el punto más despejado es el centro en un rectángulo y cae dentro en una U', () => {
    expect(interiorAnchor(poly('rect'))).toEqual({ x: 2, z: 1.5 });
    const anchor = interiorAnchor(poly('U'));
    expect(pointInPolygon(anchor, poly('U'))).toBe(true);
    // El centro de la caja de la U (3, 2) está sobre la pared del hueco: el ancla se aleja de ella.
    expect(anchor.z).toBeLessThan(1.5);
  });

  it('propiedad: en un rectángulo, "dentro del polígono" coincide con "dentro de la caja"', () => {
    const box = poly('rect');
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 400; i++) {
      const fp = footprint({ x: random() * 5 - 0.5, y: 0, z: random() * 4 - 0.5 }, { x: 0.3 + random() * 1.5, y: 1, z: 0.3 + random() * 1.5 }, random() * Math.PI);
      const xs = fp.corners.map((c) => c.x);
      const zs = fp.corners.map((c) => c.z);
      const inBox = Math.min(...xs) >= -0.005 && Math.max(...xs) <= 4.005 && Math.min(...zs) >= -0.005 && Math.max(...zs) <= 3.005;
      expect(quadInsidePolygon(fp.corners, fp.center, box)).toBe(inBox);
    }
  });
});
