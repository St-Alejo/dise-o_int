/**
 * Achurados como geometría simple (líneas y puntos recortados al contorno), para que SVG, DXF y
 * PDF los dibujen igual sin depender de los patrones propios de cada formato.
 */
import type { HatchPattern, P } from './model.js';

/** Tramos de la recta de dirección `angle` que caen dentro del polígono, cada `spacing`. */
function scanLines(outline: readonly P[], angle: number, spacing: number): [P, P][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Se gira el polígono para que las líneas sean horizontales, se recorta y se deshace el giro.
  const rot = outline.map((p) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }));
  const minY = Math.min(...rot.map((p) => p.y));
  const maxY = Math.max(...rot.map((p) => p.y));
  const out: [P, P][] = [];
  if (!(spacing > 0) || maxY - minY > spacing * 4000) return out;
  const back = (x: number, y: number): P => ({ x: x * c - y * s, y: x * s + y * c });
  const start = Math.ceil(minY / spacing) * spacing;
  for (let y = start; y <= maxY; y += spacing) {
    const xs: number[] = [];
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i]!;
      const b = rot[(i + 1) % rot.length]!;
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1]! - xs[i]! > 1e-9) out.push([back(xs[i]!, y), back(xs[i + 1]!, y)]);
    }
  }
  return out;
}

function inside(p: P, poly: readonly P[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

export interface HatchGeometry {
  lines: [P, P][];
  dots: P[];
}

/** Geometría de un achurado en las mismas unidades que su contorno. */
export function hatchGeometry(outline: readonly P[], pattern: HatchPattern, spacing: number): HatchGeometry {
  switch (pattern) {
    case 'diagonal':
      return { lines: scanLines(outline, Math.PI / 4, spacing), dots: [] };
    case 'cross':
      return { lines: [...scanLines(outline, 0, spacing), ...scanLines(outline, Math.PI / 2, spacing)], dots: [] };
    case 'solid':
      return { lines: scanLines(outline, 0, spacing / 8), dots: [] };
    case 'dots': {
      const xs = outline.map((p) => p.x);
      const ys = outline.map((p) => p.y);
      const dots: P[] = [];
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      if ((maxX - minX) * (maxY - minY) > spacing * spacing * 40000) return { lines: [], dots };
      for (let y = Math.ceil(minY / spacing) * spacing; y <= maxY; y += spacing)
        for (let x = Math.ceil(minX / spacing) * spacing; x <= maxX; x += spacing) if (inside({ x, y }, outline)) dots.push({ x, y });
      return { lines: [], dots };
    }
  }
}
