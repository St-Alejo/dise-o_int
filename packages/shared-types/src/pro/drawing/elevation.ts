/**
 * Alzados interiores y corte (lógica pura). Un alzado es la pared vista desde dentro del cuarto:
 * su contorno, los vanos, el revestimiento y lo que está contra ella (muebles, cuadros, repisas)
 * proyectado, con cotas de largo, alto, vanos y alféizares. El corte A–A' corta el cuarto por la
 * línea que trazó el profesional: los muros cortados van achurados y lo de más allá, en proyección.
 *
 * Coordenadas del dibujo: x = metros a lo largo (de izquierda a derecha según se mira), y = −altura.
 */
import type { RoomFinishes, RoomShell } from '../../domain.js';
import type { DesignPiece } from '../../design-check.js';
import { footprint } from '../../geometry.js';
import { resolveFinishMaterial } from '../../materials.js';
import type { Point2 } from '../../polygon.js';
import { wallFrames, type WallFrame } from '../../walls.js';
import { type SectionLine, type TechnicalSpec } from '../technical.js';
import { partitionPieces, thickWalls } from '../walls-2d.js';
import { DrawingBuilder, formatMeters, type Drawing, type P } from './model.js';
import { textHeightM } from './plan-view.js';

export interface ElevationInput {
  shell: RoomShell;
  spec: TechnicalSpec;
  pieces: readonly DesignPiece[];
  finishes?: RoomFinishes | null;
}

/** Hasta esta distancia de la pared se dibuja un objeto en su alzado. */
const NEAR_WALL_M = 0.6;

const paper = (spec: Pick<TechnicalSpec, 'sheet'>, mm: number) => (mm * spec.sheet.scale) / 1000;

/** Nombre corto de cada pared para enlazar plantas y alzados: E1, E2... en el orden del cuarto. */
export function elevationLabel(shell: Pick<RoomShell, 'walls'>, wallId: string): string {
  return `E${shell.walls.findIndex((w) => w.id === wallId) + 1}`;
}

/** Eje horizontal del alzado: a la derecha de quien mira la pared desde dentro. */
function viewAxis(frame: WallFrame): { right: Point2; origin: Point2; length: number } {
  const right = { x: frame.normal.z, z: -frame.normal.x };
  const a = frame.base;
  const b = { x: frame.base.x + frame.dir.x * frame.length, z: frame.base.z + frame.dir.z * frame.length };
  const ua = a.x * right.x + a.z * right.z;
  const ub = b.x * right.x + b.z * right.z;
  return { right, origin: ua <= ub ? a : b, length: frame.length };
}

const project = (p: Point2, axis: { right: Point2; origin: Point2 }) => (p.x - axis.origin.x) * axis.right.x + (p.z - axis.origin.z) * axis.right.z;

/** Alzado de una pared del cuarto. */
export function elevationView(wallId: string, input: ElevationInput): Drawing {
  const { shell, spec } = input;
  const frame = wallFrames(shell).find((f) => f.id === wallId);
  const wall = shell.walls.find((w) => w.id === wallId);
  if (!frame || !wall) throw new Error(`No existe la pared ${wallId}`);
  const d = new DrawingBuilder(textHeightM(spec));
  const axis = viewAxis(frame);
  const L = axis.length;
  const H = shell.heightM;
  const y = (h: number) => -h;

  // Losa de piso y de techo cortadas (achuradas) y el contorno de la pared.
  const slab = paper(spec, 2);
  const spacing = Math.max(0.03, d.textHeight * 0.35);
  for (const [top, bottom] of [
    [0, -slab],
    [H + slab, H],
  ] as const) {
    const rect = [
      { x: -0.3, y: y(top) },
      { x: L + 0.3, y: y(top) },
      { x: L + 0.3, y: y(bottom) },
      { x: -0.3, y: y(bottom) },
    ];
    d.hatch('wallHatch', rect, 'diagonal', spacing).polyline('section', rect, true);
  }
  d.polyline('wall', [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: y(H) },
    { x: 0, y: y(H) },
  ]);

  // Revestimiento hasta su altura.
  const finishes = input.finishes;
  if (finishes?.wallTiles && (!finishes.wallTiles.walls || finishes.wallTiles.walls.includes(wallId))) {
    const h = Math.min(H, finishes.wallTiles.heightM);
    d.hatch('floorPattern', [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: y(h) }, { x: 0, y: y(h) }], 'cross', 0.3);
    d.line('wall', { x: 0, y: y(h) }, { x: L, y: y(h) });
    const name = resolveFinishMaterial(finishes, finishes.wallTiles.material)?.name ?? 'Revestimiento';
    d.text('text', { x: L / 2, y: y(h) - d.textHeight * 0.5 }, `${name} h=${formatMeters(h)}`, { scale: 0.75 });
  }

  // Vanos.
  const openings = shell.openings.filter((o) => o.wallId === wallId);
  const startU = project({ x: wall.start.x, z: wall.start.z }, axis);
  const dirSign = project({ x: wall.end.x, z: wall.end.z }, axis) >= startU ? 1 : -1;
  for (const o of openings) {
    const c = startU + dirSign * o.offsetM;
    const x0 = c - o.widthM / 2;
    const x1 = c + o.widthM / 2;
    const y0 = o.sillHeightM;
    const y1 = o.sillHeightM + o.heightM;
    const rect: P[] = [
      { x: x0, y: y(y0) },
      { x: x1, y: y(y0) },
      { x: x1, y: y(y1) },
      { x: x0, y: y(y1) },
    ];
    d.polyline(o.type === 'door' ? 'door' : 'glazing', rect);
    if (o.type === 'window') {
      const f = 0.05;
      d.polyline('glazing', [
        { x: x0 + f, y: y(y0 + f) },
        { x: x1 - f, y: y(y0 + f) },
        { x: x1 - f, y: y(y1 - f) },
        { x: x0 + f, y: y(y1 - f) },
      ]);
      if (o.widthM > 0.9) d.line('glazing', { x: c, y: y(y0 + f) }, { x: c, y: y(y1 - f) });
      d.dimension({ x: x1, y: 0 }, { x: x1, y: y(y0) }, -paper(spec, 4), formatMeters(y0));
    } else {
      // Triángulo de apertura: el vértice apunta a la bisagra.
      d.polyline('door', [{ x: x1, y: y(y0) }, { x: x0, y: y((y0 + y1) / 2) }, { x: x1, y: y(y1) }], false, 'dashed');
    }
    d.dimension({ x: x0, y: y(y1) }, { x: x1, y: y(y1) }, paper(spec, 4));
    d.dimension({ x: x0, y: y(y0) }, { x: x0, y: y(y1) }, paper(spec, 4));
  }

  // Lo que está contra la pared, proyectado.
  for (const p of input.pieces) {
    const corners = footprint(p.position, p.dims, p.rotationY).corners;
    const nearest = Math.min(...corners.map((c) => (c.x - frame.base.x) * frame.normal.x + (c.z - frame.base.z) * frame.normal.z));
    if (nearest > NEAR_WALL_M) continue;
    const us = corners.map((c) => project(c, axis));
    const u0 = Math.max(0, Math.min(...us));
    const u1 = Math.min(L, Math.max(...us));
    if (u1 - u0 < 0.02) continue;
    const base = p.position.y;
    const top = Math.min(H, base + p.dims.y);
    d.polyline('furniture', [
      { x: u0, y: y(base) },
      { x: u1, y: y(base) },
      { x: u1, y: y(top) },
      { x: u0, y: y(top) },
    ], true, p.mount === 'wall' ? undefined : nearest > 0.25 ? 'dashed' : undefined);
    if (u1 - u0 > 0.4 && top - base > 0.2) d.text('text', { x: (u0 + u1) / 2, y: y((base + top) / 2) + d.textHeight * 0.35 }, p.name, { scale: 0.7 });
    if (p.mount === 'wall') d.dimension({ x: u1, y: 0 }, { x: u1, y: y(base) }, -paper(spec, 3), formatMeters(base));
  }

  // Cotas generales.
  d.dimension({ x: 0, y: 0 }, { x: L, y: 0 }, -paper(spec, 10));
  d.dimension({ x: 0, y: 0 }, { x: 0, y: y(H) }, paper(spec, 10));
  d.text('text', { x: L + 0.3 + paper(spec, 3), y: y(0) }, 'N.P.T. ±0,00', { scale: 0.75, anchor: 'start' });
  d.text('text', { x: L + 0.3 + paper(spec, 3), y: y(H) }, `N.C.R. +${formatMeters(H)}`, { scale: 0.75, anchor: 'start' });
  return d.build(`Alzado ${elevationLabel(shell, wallId)}`);
}

/** Corte A–A' por la línea de la ficha, mirando hacia su izquierda. */
export function sectionView(line: SectionLine, input: ElevationInput): Drawing {
  const { shell, spec } = input;
  const d = new DrawingBuilder(textHeightM(spec));
  const len = Math.hypot(line.b.x - line.a.x, line.b.z - line.a.z);
  if (len < 0.1) throw new Error('La línea de corte es demasiado corta');
  const u = { x: (line.b.x - line.a.x) / len, z: (line.b.z - line.a.z) / len };
  // Se mira hacia la izquierda de a→b en planta (y hacia abajo): look = (u.z, −u.x).
  const look = { x: u.z, z: -u.x };
  const along = (p: Point2) => (p.x - line.a.x) * u.x + (p.z - line.a.z) * u.z;
  const depth = (p: Point2) => (p.x - line.a.x) * look.x + (p.z - line.a.z) * look.z;
  const H = shell.heightM;
  const y = (h: number) => -h;
  const spacing = Math.max(0.03, d.textHeight * 0.35);

  // Muros cortados: donde la línea cruza un muro con grosor, un rectángulo achurado.
  const cuts: { u0: number; u1: number }[] = [];
  const quads = [
    ...thickWalls(shell, spec).map((w) => [w.inner[0], w.inner[1], w.outer[1], w.outer[0]]),
    ...partitionPieces(shell, spec).map((p) => p.outline),
  ];
  for (const quad of quads) {
    const hits: number[] = [];
    for (let i = 0; i < 4; i++) {
      const p = quad[i]!;
      const q = quad[(i + 1) % 4]!;
      const dp = depth(p);
      const dq = depth(q);
      if ((dp > 0) === (dq > 0) || Math.abs(dp - dq) < 1e-9) continue;
      const t = dp / (dp - dq);
      hits.push(along({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t }));
    }
    if (hits.length >= 2) cuts.push({ u0: Math.min(...hits), u1: Math.max(...hits) });
  }
  for (const c of cuts) {
    const rect = [
      { x: c.u0, y: 0 },
      { x: c.u1, y: 0 },
      { x: c.u1, y: y(H) },
      { x: c.u0, y: y(H) },
    ];
    d.hatch('wallHatch', rect, 'diagonal', spacing).polyline('section', rect);
  }
  const minU = cuts.length ? Math.min(...cuts.map((c) => c.u0)) : 0;
  const maxU = cuts.length ? Math.max(...cuts.map((c) => c.u1)) : len;
  const slab = paper(spec, 2);
  for (const [top, bottom] of [
    [0, -slab],
    [H + slab, H],
  ] as const) {
    const rect = [
      { x: minU, y: y(top) },
      { x: maxU, y: y(top) },
      { x: maxU, y: y(bottom) },
      { x: minU, y: y(bottom) },
    ];
    d.hatch('wallHatch', rect, 'diagonal', spacing).polyline('section', rect);
  }

  // Lo de más allá en proyección: los muebles del lado al que se mira.
  for (const p of input.pieces) {
    const corners = footprint(p.position, p.dims, p.rotationY).corners;
    if (Math.max(...corners.map(depth)) <= 0) continue;
    const us = corners.map(along);
    const u0 = Math.max(minU, Math.min(...us));
    const u1 = Math.min(maxU, Math.max(...us));
    if (u1 - u0 < 0.02) continue;
    const base = p.position.y;
    const top = Math.min(H, base + p.dims.y);
    d.polyline('furniture', [
      { x: u0, y: y(base) },
      { x: u1, y: y(base) },
      { x: u1, y: y(top) },
      { x: u0, y: y(top) },
    ]);
  }

  // Cotas: alto libre y largo interior.
  // Largo interior: entre la cara de dentro del primer y del último muro cortado.
  const sorted = [...cuts].sort((a, b) => a.u0 - b.u0);
  const inner = sorted.length >= 2 ? [sorted[0]!.u1, sorted[sorted.length - 1]!.u0] : [0, len];
  // Cotas parciales entre muros y tabiques cortados.
  for (let i = 0; i + 1 < sorted.length && sorted.length > 2; i++) d.dimension({ x: sorted[i]!.u1, y: 0 }, { x: sorted[i + 1]!.u0, y: 0 }, -paper(spec, 5));
  d.dimension({ x: inner[0]!, y: 0 }, { x: inner[1]!, y: 0 }, -paper(spec, 10));
  d.dimension({ x: inner[0]!, y: 0 }, { x: inner[0]!, y: y(H) }, paper(spec, 6));
  d.text('text', { x: maxU + paper(spec, 4), y: 0 }, 'N.P.T. ±0,00', { scale: 0.75, anchor: 'start' });
  d.text('text', { x: maxU + paper(spec, 4), y: y(H) }, `N.C.R. +${formatMeters(H)}`, { scale: 0.75, anchor: 'start' });
  return d.build("Corte A–A'");
}
