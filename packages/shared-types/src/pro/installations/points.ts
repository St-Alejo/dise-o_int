/**
 * Puntos de instalación: qué es cada tipo, a qué altura va normalmente, cuánto consume y dónde cae
 * en la planta. Lo usan la propuesta automática, los circuitos, los planos y la normativa.
 */
import type { RoomShell } from '../../domain.js';
import type { Point2 } from '../../polygon.js';
import { wallFrames, type WallFrame } from '../../walls.js';
import { isElectrical, type InstallationKind, type InstallationPoint } from '../technical.js';

export interface KindInfo {
  label: string;
  /** Altura típica del punto (m sobre el piso terminado). */
  heightM: number;
  /** Carga de diseño en VA (0 = no consume: interruptores, datos, agua). */
  va: number;
  /** Abreviatura del símbolo en planos. */
  short: string;
}

export const INSTALLATION_INFO: Record<InstallationKind, KindInfo> = {
  outlet: { label: 'Toma doble', heightM: 0.3, va: 180, short: 'T' },
  'outlet-gfci': { label: 'Toma GFCI (zona húmeda)', heightM: 1.1, va: 180, short: 'GFCI' },
  switch: { label: 'Interruptor sencillo', heightM: 1.2, va: 0, short: 'S' },
  'switch-double': { label: 'Interruptor doble', heightM: 1.2, va: 0, short: 'S2' },
  'switch-3way': { label: 'Interruptor conmutable', heightM: 1.2, va: 0, short: 'S3' },
  light: { label: 'Salida de iluminación', heightM: 2.4, va: 100, short: 'L' },
  'tv-data': { label: 'Salida de TV y datos', heightM: 0.3, va: 0, short: 'TV' },
  'cold-water': { label: 'Agua fría', heightM: 0.55, va: 0, short: 'AF' },
  'hot-water': { label: 'Agua caliente', heightM: 0.55, va: 0, short: 'AC' },
  drain: { label: 'Desagüe', heightM: 0.5, va: 0, short: 'D' },
  'floor-drain': { label: 'Rejilla de piso', heightM: 0, va: 0, short: 'R' },
};

export const isSwitch = (k: InstallationKind) => k === 'switch' || k === 'switch-double' || k === 'switch-3way';
export const isOutlet = (k: InstallationKind) => k === 'outlet' || k === 'outlet-gfci';

/** Carga del punto: la suya o la típica de su tipo. */
export const loadOf = (p: Pick<InstallationPoint, 'kind' | 'watts'>) => p.watts ?? INSTALLATION_INFO[p.kind].va;

export interface PlacedPoint {
  point: InstallationPoint;
  /** Dónde cae en la planta (sobre la cara interior del muro si va en una pared). */
  at: Point2;
  /** Normal hacia dentro del cuarto si va en una pared. */
  normal: Point2 | null;
  frame: WallFrame | null;
}

/** Ubica cada punto en la planta. Los que nombran una pared que ya no existe se descartan. */
export function placePoints(shell: Pick<RoomShell, 'walls'>, points: readonly InstallationPoint[]): PlacedPoint[] {
  const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));
  const walls = new Map(shell.walls.map((w) => [w.id, w]));
  return points.flatMap((p): PlacedPoint[] => {
    if (p.wallId !== undefined && p.offsetM !== undefined) {
      const w = walls.get(p.wallId);
      const f = frames.get(p.wallId);
      if (!w || !f) return [];
      const L = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) || 1;
      const t = Math.min(L, Math.max(0, p.offsetM)) / L;
      return [{ point: p, at: { x: w.start.x + (w.end.x - w.start.x) * t, z: w.start.z + (w.end.z - w.start.z) * t }, normal: f.normal, frame: f }];
    }
    return p.at ? [{ point: p, at: p.at, normal: null, frame: null }] : [];
  });
}

/** Cuántos puntos hay de cada familia. */
export function countByFamily(points: readonly InstallationPoint[]): { electrical: number; plumbing: number } {
  const electrical = points.filter((p) => isElectrical(p.kind)).length;
  return { electrical, plumbing: points.length - electrical };
}
