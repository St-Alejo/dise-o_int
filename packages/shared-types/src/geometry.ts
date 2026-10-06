/**
 * Geometría pura compartida por la API (validación), la web (editor 3D: colisiones, clamp,
 * calibración con preview) y los tests. Sin dependencias de Three.js ni del DOM.
 *
 * Convención: plano del piso XZ, rotación `rotationY` igual que Three.js (regla de la mano
 * derecha alrededor de +Y): el vector local (1, 0, 0) rota a (cos θ, 0, −sin θ).
 * Los modelos miran hacia su +Z local (convención glTF).
 */
import type {
  FurniturePlacement,
  Mount,
  Opening,
  RoomShell,
  Vector3,
  WallSegment,
} from './domain.js';
import type { CalibrationReference } from './api.js';

export interface Point2 {
  x: number;
  z: number;
}

export interface Footprint {
  /** Esquinas en orden (sentido horario visto desde arriba). */
  corners: [Point2, Point2, Point2, Point2];
  center: Point2;
  rotationY: number;
}

const EPS = 1e-6;

/** Rota un punto local (lx, lz) por θ alrededor de Y, igual que Object3D.rotation.y. */
export function rotateXZ(lx: number, lz: number, rotationY: number): Point2 {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

export function footprint(position: Vector3, dimensionsM: Vector3, rotationY: number): Footprint {
  const hw = dimensionsM.x / 2;
  const hd = dimensionsM.z / 2;
  const local: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  const corners = local.map(([lx, lz]) => {
    const r = rotateXZ(lx, lz, rotationY);
    return { x: position.x + r.x, z: position.z + r.z };
  }) as Footprint['corners'];
  return { corners, center: { x: position.x, z: position.z }, rotationY };
}

/** Caja envolvente alineada a ejes de una huella rotada. */
export function footprintBounds(fp: Footprint): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const xs = fp.corners.map((c) => c.x);
  const zs = fp.corners.map((c) => c.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

function project(corners: Point2[], axis: Point2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const p = c.x * axis.x + c.z * axis.z;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

/**
 * Teorema del eje separador para dos rectángulos orientados.
 * `tolerance` > 0 permite que se toquen ligeramente sin contar como colisión.
 */
export function footprintsOverlap(a: Footprint, b: Footprint, tolerance = 0.01): boolean {
  const axes: Point2[] = [];
  for (const fp of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const p0 = fp.corners[i]!;
      const p1 = fp.corners[i + 1]!;
      const ex = p1.x - p0.x;
      const ez = p1.z - p0.z;
      const len = Math.hypot(ex, ez) || 1;
      axes.push({ x: -ez / len, z: ex / len });
    }
  }
  for (const axis of axes) {
    const [minA, maxA] = project(a.corners, axis);
    const [minB, maxB] = project(b.corners, axis);
    if (maxA - tolerance <= minB || maxB - tolerance <= minA) return false;
  }
  return true;
}

/** ¿La huella cabe completa dentro del rectángulo del cuarto? */
export function isInsideRoom(fp: Footprint, shell: Pick<RoomShell, 'widthM' | 'depthM'>, tolerance = 0.005): boolean {
  const b = footprintBounds(fp);
  return (
    b.minX >= -tolerance &&
    b.minZ >= -tolerance &&
    b.maxX <= shell.widthM + tolerance &&
    b.maxZ <= shell.depthM + tolerance
  );
}

/** Desplaza la posición lo mínimo necesario para que la huella quede dentro del cuarto. */
export function clampToRoom(
  position: Vector3,
  dimensionsM: Vector3,
  rotationY: number,
  shell: Pick<RoomShell, 'widthM' | 'depthM'>,
): Vector3 {
  const b = footprintBounds(footprint({ ...position, x: 0, z: 0 }, dimensionsM, rotationY));
  const halfX = (b.maxX - b.minX) / 2;
  const halfZ = (b.maxZ - b.minZ) / 2;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return {
    x: clamp(position.x, halfX, shell.widthM - halfX),
    y: position.y,
    z: clamp(position.z, halfZ, shell.depthM - halfZ),
  };
}

/** Altura (y) de la base del objeto según su montaje. */
export function mountY(mount: Mount, dimensionsM: Vector3, shell: Pick<RoomShell, 'heightM'>): number {
  return mount === 'ceiling' ? Math.max(0, shell.heightM - dimensionsM.y) : 0;
}

/** Ajusta un ángulo al múltiplo más cercano de `step` (por defecto 15°). */
export function snapAngle(rotationY: number, step = Math.PI / 12): number {
  const snapped = Math.round(rotationY / step) * step;
  const twoPi = Math.PI * 2;
  return ((snapped % twoPi) + twoPi) % twoPi;
}

export function wallLength(wall: WallSegment): number {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
}

export interface CollisionReport {
  outside: string[];
  overlapping: [string, string][];
}

/** Revisa colisiones y salidas del cuarto de una escena completa. */
export function checkScene(
  shell: Pick<RoomShell, 'widthM' | 'depthM'>,
  placements: FurniturePlacement[],
  dimensionsOf: (catalogItemId: string) => Vector3 | undefined,
  ignoreCategoriesForOverlap: (catalogItemId: string) => boolean = () => false,
): CollisionReport {
  const report: CollisionReport = { outside: [], overlapping: [] };
  const fps = placements.map((p) => {
    const dims = dimensionsOf(p.catalogItemId);
    return dims ? { p, fp: footprint(p.position, dims, p.rotationY) } : null;
  });
  fps.forEach((entry, i) => {
    if (!entry) return;
    if (!isInsideRoom(entry.fp, shell)) report.outside.push(entry.p.id);
    for (let j = i + 1; j < fps.length; j++) {
      const other = fps[j];
      if (!other) continue;
      if (ignoreCategoriesForOverlap(entry.p.catalogItemId) || ignoreCategoriesForOverlap(other.p.catalogItemId)) continue;
      if (footprintsOverlap(entry.fp, other.fp)) report.overlapping.push([entry.p.id, other.p.id]);
    }
  });
  return report;
}

// ---------------------------------------------------------------------------
// RoomShell: construcción y calibración de escala (§8.1 del documento)
// ---------------------------------------------------------------------------

export interface RectangularShellOptions {
  id?: string;
  scaleConfidence?: number;
  needsCalibration?: boolean;
  /** Puerta en la pared frontal (z = depth) por defecto. */
  door?: boolean;
  /** Ventana en la pared del fondo (z = 0) por defecto. */
  window?: boolean;
}

/**
 * Cuarto rectangular "Manhattan" con 4 paredes en sentido horario visto desde arriba:
 * w-back (z=0), w-right (x=width), w-front (z=depth), w-left (x=0).
 */
export function createRectangularShell(
  widthM: number,
  depthM: number,
  heightM: number,
  opts: RectangularShellOptions = {},
): RoomShell {
  const p = (x: number, z: number): Vector3 => ({ x, y: 0, z });
  const hasWindow = opts.window ?? true;
  const walls: WallSegment[] = [
    { id: 'w-back', start: p(0, 0), end: p(widthM, 0), hasWindow },
    { id: 'w-right', start: p(widthM, 0), end: p(widthM, depthM), hasWindow: false },
    { id: 'w-front', start: p(widthM, depthM), end: p(0, depthM), hasWindow: false },
    { id: 'w-left', start: p(0, depthM), end: p(0, 0), hasWindow: false },
  ];
  const openings: Opening[] = [];
  if (hasWindow) {
    openings.push({
      id: 'o-window-1',
      type: 'window',
      wallId: 'w-back',
      widthM: Math.min(1.6, widthM * 0.4),
      heightM: Math.min(1.3, heightM * 0.5),
      offsetM: widthM / 2,
      sillHeightM: Math.min(0.9, heightM * 0.35),
    });
  }
  if (opts.door ?? true) {
    openings.push({
      id: 'o-door-1',
      type: 'door',
      wallId: 'w-front',
      widthM: Math.min(0.9, widthM * 0.3),
      heightM: Math.min(2.05, heightM * 0.85),
      offsetM: Math.min(widthM * 0.8, Math.max(0.6, widthM - 0.8)),
      sillHeightM: 0,
    });
  }
  return {
    id: opts.id ?? 'room',
    widthM,
    depthM,
    heightM,
    walls,
    openings,
    scaleConfidence: opts.scaleConfidence ?? 0.3,
    needsCalibration: opts.needsCalibration ?? true,
  };
}

/** Escala uniforme de todo el cascarón (paredes, aberturas y alturas). */
export function scaleRoomShell(shell: RoomShell, factor: number): RoomShell {
  if (!(factor > 0) || !Number.isFinite(factor)) throw new RangeError('El factor de escala debe ser > 0');
  const s = (v: Vector3): Vector3 => ({ x: v.x * factor, y: v.y * factor, z: v.z * factor });
  return {
    ...shell,
    widthM: shell.widthM * factor,
    depthM: shell.depthM * factor,
    heightM: shell.heightM * factor,
    walls: shell.walls.map((w) => ({ ...w, start: s(w.start), end: s(w.end) })),
    openings: shell.openings.map((o) => ({
      ...o,
      widthM: o.widthM * factor,
      heightM: o.heightM * factor,
      offsetM: o.offsetM * factor,
      sillHeightM: o.sillHeightM * factor,
    })),
  };
}

/** Valor actual (estimado) de la medida de referencia en el cascarón. */
export function referenceValue(shell: RoomShell, reference: CalibrationReference): number | null {
  switch (reference) {
    case 'ceiling-height':
      return shell.heightM;
    case 'room-width':
      return shell.widthM;
    case 'room-depth':
      return shell.depthM;
    case 'door-height': {
      const door = shell.openings.find((o) => o.type === 'door');
      return door ? door.heightM : null;
    }
  }
}

export class CalibrationError extends Error {}

/**
 * Calibración de un solo gesto: el usuario confirma una medida real conocida y todo el
 * RoomShell se reescala con ese factor. Tras calibrar, la escala se considera confiable.
 */
export function calibrateRoomShell(
  shell: RoomShell,
  reference: CalibrationReference,
  realValueM: number,
): { shell: RoomShell; factor: number } {
  const current = referenceValue(shell, reference);
  if (current === null) throw new CalibrationError('No se detectó ninguna puerta para usar como referencia');
  if (current <= EPS) throw new CalibrationError('La medida de referencia estimada es inválida');
  const factor = realValueM / current;
  if (factor < 0.25 || factor > 4) {
    throw new CalibrationError('La medida indicada es demasiado distinta de la estimada (factor fuera de 0.25–4)');
  }
  const scaled = scaleRoomShell(shell, factor);
  return { shell: { ...scaled, scaleConfidence: 1, needsCalibration: false }, factor };
}

/** Reposiciona los muebles tras reescalar el cuarto (sus dimensiones reales no cambian). */
export function scalePlacements(placements: FurniturePlacement[], factor: number): FurniturePlacement[] {
  return placements.map((p) => ({
    ...p,
    position: { x: p.position.x * factor, y: p.position.y, z: p.position.z * factor },
  }));
}
