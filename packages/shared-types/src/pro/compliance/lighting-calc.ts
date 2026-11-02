/**
 * Cálculo de iluminación (lógica pura): cuánta luz llega a cada punto del plano de trabajo.
 *
 * - **Luz artificial, punto a punto:** cada lámpara es una fuente puntual con su flujo (lúmenes por
 *   subcategoría). Las de techo emiten hacia abajo con una distribución coseno (Lambertiana; los
 *   focos empotrados, más cerrada) y las de pie, mesa y pared en todas direcciones. A eso se suma una
 *   componente indirecta uniforme por las reflexiones en paredes y techo (método del flujo total).
 * - **Luz natural:** factor de luz diurna medio con la fórmula de la BRE y repartido por la planta
 *   según la distancia a cada ventana; multiplicado por la iluminancia exterior a esa hora (cielo
 *   cubierto) da los lux.
 *
 * No se calculan sombras de los muebles: es la estimación de un predimensionado, no un DIALux.
 */
import type { RoomShell } from '../../domain.js';
import type { DesignPiece } from '../../design-check.js';
import { roomPolygon } from '../../geometry.js';
import { distanceToBoundary, pointInPolygon, polygonBounds, signedArea, type Point2 } from '../../polygon.js';
import { wallFrames } from '../../walls.js';

/** Flujo luminoso típico (lm) de cada tipo de luminaria del catálogo, con bombilla LED doméstica. */
export const LUMENS_BY_SUBCATEGORY: Readonly<Record<string, number>> = {
  'flush-light': 1600,
  pendant: 1200,
  'recessed-spot': 450,
  'floor-lamp': 800,
  'table-lamp': 450,
  'desk-lamp': 400,
  sconce: 400,
  'led-strip': 300,
};

export type LightDistribution = 'down' | 'spot' | 'omni';

export interface LightSource {
  id: string;
  name: string;
  lumens: number;
  /** Punto de emisión (y = altura). */
  at: { x: number; y: number; z: number };
  distribution: LightDistribution;
}

/** Exponente de la distribución cos^n hacia abajo: 1 = Lambertiana, mayor = haz más cerrado. */
const DOWN_EXPONENT: Record<Exclude<LightDistribution, 'omni'>, number> = { down: 1, spot: 4 };

/** Las lámparas del diseño como fuentes de luz. */
export function lightSources(pieces: readonly DesignPiece[]): LightSource[] {
  return pieces.flatMap((p): LightSource[] => {
    const lumens = p.category === 'lighting' ? LUMENS_BY_SUBCATEGORY[p.subcategory ?? ''] : undefined;
    if (!lumens) return [];
    const sub = p.subcategory ?? '';
    const distribution: LightDistribution = sub === 'recessed-spot' ? 'spot' : p.mount === 'ceiling' || sub === 'desk-lamp' ? 'down' : 'omni';
    // La bombilla: abajo en las de techo, arriba en las de pie, en la pantalla en las de mesa.
    const y = p.mount === 'ceiling' ? p.position.y : p.mount === 'wall' ? p.position.y + p.dims.y / 2 : p.position.y + p.dims.y * (sub === 'floor-lamp' ? 0.9 : 0.75);
    return [{ id: p.id, name: p.name, lumens, at: { x: p.position.x, y, z: p.position.z }, distribution }];
  });
}

export interface LightCell {
  x: number;
  z: number;
  lux: number;
}

export interface IlluminanceGrid {
  stepM: number;
  /** Altura del plano de trabajo. */
  workPlaneM: number;
  cells: LightCell[];
  avgLux: number;
  minLux: number;
  maxLux: number;
  /** Emín / Emedia (0 si no hay luz). */
  uniformity: number;
}

export interface GridOptions {
  stepM?: number;
  workPlaneM?: number;
  /** Banda junto a las paredes que no se evalúa (EN 12464: 0,5 m). */
  bandM?: number;
}

export interface ArtificialOptions extends GridOptions {
  /** Reflectancia media de paredes y techo. */
  reflectance?: number;
  /** Factor de mantenimiento (polvo, envejecimiento). */
  maintenance?: number;
}

type GridShell = Pick<RoomShell, 'walls' | 'heightM' | 'zones' | 'openings'>;

/** Puntos donde se evalúa: centros de una rejilla dentro del cuarto, fuera de la banda y de las zonas cerradas. */
export function evaluationPoints(shell: GridShell, opts: GridOptions = {}): Point2[] {
  const step = opts.stepM ?? 0.25;
  const room = roomPolygon(shell);
  const b = polygonBounds(room);
  const closed = (shell.zones ?? []).filter((z) => !z.open);
  const inside: Point2[] = [];
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    for (let z = b.minZ + step / 2; z < b.maxZ; z += step) {
      const p = { x, z };
      if (pointInPolygon(p, room) && !closed.some((zone) => pointInPolygon(p, zone.outline))) inside.push(p);
    }
  }
  const band = opts.bandM ?? 0.5;
  const core = inside.filter((p) => distanceToBoundary(p, room) >= band);
  // En un cuarto estrecho la banda se lo comería todo: se evalúa entero.
  return core.length >= 4 ? core : inside;
}

/** Superficie interior total (piso + techo + paredes), para la componente reflejada. */
export function interiorSurfaceM2(shell: GridShell): number {
  const floor = Math.abs(signedArea(roomPolygon(shell)));
  const perimeter = shell.walls.reduce((sum, w) => sum + Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z), 0);
  return 2 * floor + perimeter * shell.heightM;
}

/** Iluminancia directa de una fuente en un punto del plano de trabajo (lux). */
export function directLux(source: LightSource, p: Point2, workPlaneM: number): number {
  const h = source.at.y - workPlaneM;
  if (h <= 0.01) return 0;
  const d2 = (source.at.x - p.x) ** 2 + (source.at.z - p.z) ** 2 + h * h;
  const cos = h / Math.sqrt(d2);
  if (source.distribution === 'omni') return (source.lumens / (4 * Math.PI)) * (cos / d2);
  const n = DOWN_EXPONENT[source.distribution];
  return ((source.lumens * (n + 1)) / (2 * Math.PI)) * (cos ** (n + 1) / d2);
}

function summarize(points: Point2[], luxAt: (p: Point2) => number, step: number, workPlaneM: number): IlluminanceGrid {
  const cells = points.map((p) => ({ x: p.x, z: p.z, lux: luxAt(p) }));
  const values = cells.map((c) => c.lux);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return { stepM: step, workPlaneM, cells, avgLux: avg, minLux: min, maxLux: max, uniformity: avg > 0 ? min / avg : 0 };
}

/** Rejilla de luz artificial (de noche, todas las lámparas encendidas). */
export function artificialLighting(shell: GridShell, sources: readonly LightSource[], opts: ArtificialOptions = {}): IlluminanceGrid {
  const step = opts.stepM ?? 0.25;
  const plane = opts.workPlaneM ?? 0.75;
  const rho = opts.reflectance ?? 0.5;
  const mf = opts.maintenance ?? 0.8;
  const total = sources.reduce((sum, s) => sum + s.lumens, 0);
  const indirect = (total * rho) / (interiorSurfaceM2(shell) * (1 - rho));
  return summarize(evaluationPoints(shell, opts), (p) => mf * (indirect + sources.reduce((sum, s) => sum + directLux(s, p, plane), 0)), step, plane);
}

/** Iluminancia exterior horizontal con cielo cubierto (lux) a una hora solar: 0 de noche, ~10 000 a mediodía. */
export function exteriorLux(hour: number): number {
  return Math.max(0, 10_000 * Math.sin((Math.PI * (hour - 6)) / 12));
}

export interface DaylightOptions extends GridOptions {
  /** Hora solar (0–24). */
  hour?: number;
  /** Transmisión del vidrio, ángulo de cielo visible (°) y reflectancia media (fórmula BRE). */
  transmittance?: number;
  skyAngleDeg?: number;
  reflectance?: number;
}

export interface DaylightResult {
  /** Factor de luz diurna medio (%). */
  factorPct: number;
  /** Área total de ventanas (m²). */
  windowAreaM2: number;
  hour: number;
  grid: IlluminanceGrid;
}

/** Luz natural: factor de luz diurna medio y su reparto por la planta a una hora dada. */
export function daylight(shell: GridShell, opts: DaylightOptions = {}): DaylightResult {
  const step = opts.stepM ?? 0.25;
  const plane = opts.workPlaneM ?? 0.75;
  const hour = opts.hour ?? 12;
  const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));
  const windows = shell.openings.flatMap((o) => {
    const f = frames.get(o.wallId);
    if (o.type !== 'window' || !f) return [];
    const along = f.startAtBase ? o.offsetM : f.length - o.offsetM;
    const head = Math.max(0.3, o.sillHeightM + o.heightM - plane);
    return [{ area: o.widthM * o.heightM, at: { x: f.base.x + f.dir.x * along, z: f.base.z + f.dir.z * along }, head }];
  });
  const area = windows.reduce((sum, w) => sum + w.area, 0);
  const rho = opts.reflectance ?? 0.5;
  // BRE: DF = T · Aw · θ · M / (A · (1 − R²)), en %; M = 0,9 por suciedad del vidrio.
  const factorPct = ((opts.transmittance ?? 0.7) * area * (opts.skyAngleDeg ?? 65) * 0.9) / (interiorSurfaceM2(shell) * (1 - rho * rho));
  const points = evaluationPoints(shell, opts);
  const weight = (p: Point2) => windows.reduce((sum, w) => sum + w.area / (1 + ((w.at.x - p.x) ** 2 + (w.at.z - p.z) ** 2) / (w.head * w.head)), 0);
  const weights = points.map(weight);
  const meanWeight = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 0;
  const ext = exteriorLux(hour);
  const grid = summarize(points, (p) => (meanWeight > 0 ? ((factorPct / 100) * ext * weight(p)) / meanWeight : 0), step, plane);
  return { factorPct, windowAreaM2: area, hour, grid };
}
