/**
 * Muros con grosor (lógica pura). Las paredes de `RoomShell` son la cara interior del cuarto: el
 * grosor crece hacia fuera, así el área útil y todo lo ya colocado no cambian al darle grosor.
 *
 * Cada muro es un cuadrilátero entre su cara interior y la exterior; las esquinas de la cara
 * exterior salen de cortar las caras exteriores vecinas (inglete), de modo que los muros se unen sin
 * huecos ni solapes en cuartos rectangulares, en L, en T o en U. Los vanos parten el muro en tramos.
 */
import type { Opening, RoomShell } from '../domain.js';
import type { Point2 } from '../polygon.js';
import { signedArea } from '../polygon.js';
import { partitions } from '../zones.js';
import { wallFrames } from '../walls.js';
import { type TechnicalSpec, wallThickness } from './technical.js';

/** Un muro del contorno con su grosor. Los puntos van en orden: interior inicio → fin, exterior fin → inicio. */
export interface ThickWall {
  wallId: string;
  thicknessM: number;
  /** Cara interior (la pared del modelo), de `start` a `end`. */
  inner: [Point2, Point2];
  /** Cara exterior, también de `start` a `end`. */
  outer: [Point2, Point2];
  /** Normal unitaria hacia fuera del cuarto. */
  outward: Point2;
  lengthM: number;
}

/** Un tramo macizo de muro (entre vanos), listo para achurar en planta. */
export interface WallPiece {
  wallId: string;
  /** Polígono cerrado de 4 vértices. */
  outline: Point2[];
}

/** El hueco de un vano en el muro, en metros desde `wall.start`. */
export interface WallGap {
  wallId: string;
  opening: Opening;
  from: number;
  to: number;
}

/** Inglete máximo: con ángulos muy agudos la esquina exterior se iría lejos; se recorta. */
const MITER_LIMIT = 4;

const sub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, z: a.z - b.z });
const add = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, z: a.z + b.z });
const mul = (a: Point2, k: number): Point2 => ({ x: a.x * k, z: a.z * k });
const cross = (a: Point2, b: Point2) => a.x * b.z - a.z * b.x;
const lerp = (a: Point2, b: Point2, t: number): Point2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

/** Corte de las rectas p + t·r y q + u·s; null si son paralelas. */
function intersect(p: Point2, r: Point2, q: Point2, s: Point2): Point2 | null {
  const d = cross(r, s);
  if (Math.abs(d) < 1e-9) return null;
  const t = cross(sub(q, p), s) / d;
  return add(p, mul(r, t));
}

/** Los muros del contorno con su grosor, en el orden de `shell.walls`. */
export function thickWalls(shell: Pick<RoomShell, 'walls'>, spec: Pick<TechnicalSpec, 'walls'>): ThickWall[] {
  const frames = wallFrames(shell);
  const walls = shell.walls;
  const n = walls.length;
  const lines = walls.map((w, i) => {
    const start = { x: w.start.x, z: w.start.z };
    const end = { x: w.end.x, z: w.end.z };
    const outward = mul(frames[i]!.normal, -1);
    const t = wallThickness(spec, w.id);
    return { id: w.id, start, end, outward, t, dir: sub(end, start), length: Math.hypot(end.x - start.x, end.z - start.z) };
  });
  // Esquina exterior entre el muro i-1 y el i (en el inicio del muro i).
  const corner = (i: number): Point2 => {
    const prev = lines[(i - 1 + n) % n]!;
    const cur = lines[i]!;
    const p = add(prev.start, mul(prev.outward, prev.t));
    const q = add(cur.start, mul(cur.outward, cur.t));
    const hit = intersect(p, prev.dir, q, cur.dir);
    const fallback = add(cur.start, mul(cur.outward, cur.t));
    if (!hit) return fallback;
    const limit = MITER_LIMIT * Math.max(prev.t, cur.t);
    return Math.hypot(hit.x - cur.start.x, hit.z - cur.start.z) > limit ? fallback : hit;
  };
  const corners = lines.map((_, i) => corner(i));
  return lines.map((l, i) => ({
    wallId: l.id,
    thicknessM: l.t,
    inner: [l.start, l.end],
    outer: [corners[i]!, corners[(i + 1) % n]!],
    outward: l.outward,
    lengthM: l.length,
  }));
}

/** Contorno exterior de la construcción (cara de fuera de todos los muros). */
export function outerOutline(shell: Pick<RoomShell, 'walls'>, spec: Pick<TechnicalSpec, 'walls'>): Point2[] {
  return thickWalls(shell, spec).map((w) => w.outer[0]);
}

/** Huecos de los vanos de cada muro, ordenados por su inicio. */
export function wallGaps(shell: Pick<RoomShell, 'walls' | 'openings'>): WallGap[] {
  const lengths = new Map(shell.walls.map((w) => [w.id, Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z)]));
  return shell.openings
    .flatMap((o) => {
      const len = lengths.get(o.wallId);
      if (len === undefined) return [];
      return [{ wallId: o.wallId, opening: o, from: Math.max(0, o.offsetM - o.widthM / 2), to: Math.min(len, o.offsetM + o.widthM / 2) }];
    })
    .sort((a, b) => a.from - b.from);
}

/**
 * Tramos macizos del muro a la altura de corte de la planta (1,0 m aprox.): las puertas cortan
 * siempre; las ventanas también, porque su alféizar queda por debajo del plano de corte.
 */
export function wallPieces(shell: Pick<RoomShell, 'walls' | 'openings'>, spec: Pick<TechnicalSpec, 'walls'>): WallPiece[] {
  const gaps = wallGaps(shell);
  return thickWalls(shell, spec).flatMap((w) => {
    const mine = gaps.filter((g) => g.wallId === w.wallId);
    const spans: [number, number][] = [];
    let cursor = 0;
    for (const g of mine) {
      if (g.from > cursor + 1e-6) spans.push([cursor, g.from]);
      cursor = Math.max(cursor, g.to);
    }
    if (cursor < w.lengthM - 1e-6) spans.push([cursor, w.lengthM]);
    return spans.map(([a, b]) => ({ wallId: w.wallId, outline: pieceOutline(w, a, b) }));
  });
}

/**
 * Cuadrilátero de un tramo de muro entre `a` y `b` metros desde su inicio. En los extremos del muro
 * se usa la esquina exterior en inglete; en un vano el corte es perpendicular al muro.
 */
function pieceOutline(w: ThickWall, a: number, b: number): Point2[] {
  const L = w.lengthM || 1;
  const innerA = lerp(w.inner[0], w.inner[1], a / L);
  const innerB = lerp(w.inner[0], w.inner[1], b / L);
  const outerAt = (along: number, end: 0 | 1 | null): Point2 =>
    end === 0 ? w.outer[0] : end === 1 ? w.outer[1] : add(lerp(w.inner[0], w.inner[1], along / L), mul(w.outward, w.thicknessM));
  const outerA = outerAt(a, a <= 1e-6 ? 0 : null);
  const outerB = outerAt(b, b >= L - 1e-6 ? 1 : null);
  return [innerA, innerB, outerB, outerA];
}

/** Un tabique de zona con su grosor, partido por su puerta. */
export interface PartitionPiece {
  zoneId: string;
  outline: Point2[];
}

/** Tabiques de las zonas: centrados en su línea (los dos lados son interiores). */
export function partitionPieces(shell: Pick<RoomShell, 'walls' | 'zones'>, spec: Pick<TechnicalSpec, 'walls'>): PartitionPiece[] {
  const half = spec.walls.partitionM / 2;
  return partitions(shell).flatMap((p) => {
    const dir = { x: (p.b.x - p.a.x) / p.lengthM, z: (p.b.z - p.a.z) / p.lengthM };
    const n = { x: -dir.z, z: dir.x };
    const at = (t: number) => add(p.a, mul(dir, t));
    const spans: [number, number][] = p.door
      ? [
          [0, p.door.offsetM - p.door.widthM / 2],
          [p.door.offsetM + p.door.widthM / 2, p.lengthM],
        ]
      : [[0, p.lengthM]];
    return spans
      .filter(([a, b]) => b - a > 0.01)
      .map(([a, b]) => ({
        zoneId: p.zoneId,
        outline: [add(at(a), mul(n, half)), add(at(b), mul(n, half)), add(at(b), mul(n, -half)), add(at(a), mul(n, -half))],
      }));
  });
}

/** Área construida (hasta la cara exterior de los muros) y útil (la del cuarto), en m². */
export function builtAreas(shell: Pick<RoomShell, 'walls'>, spec: Pick<TechnicalSpec, 'walls'>): { usefulM2: number; builtM2: number } {
  const inner = shell.walls.map((w) => ({ x: w.start.x, z: w.start.z }));
  return { usefulM2: Math.abs(signedArea(inner)), builtM2: Math.abs(signedArea(outerOutline(shell, spec))) };
}
