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
  ResizeRanges,
  RoomShell,
  Vector3,
  WallSegment,
} from './domain.js';
import type { CalibrationReference } from './api.js';
import {
  closestOnBoundary,
  ensureWinding,
  interiorAnchor,
  isSimplePolygon,
  pointInPolygon,
  polygonBounds,
  quadInsidePolygon,
  type Point2,
} from './polygon.js';

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

/** Lo mínimo para saber dónde acaba un cuarto: su caja y, si no es un rectángulo, sus paredes. */
export type RoomBounds = Pick<RoomShell, 'widthM' | 'depthM'> & { walls?: readonly WallSegment[] };

/** Planta del cuarto: los vértices de sus paredes, en orden. */
export function roomPolygon(shell: { walls: readonly WallSegment[] }): Point2[] {
  return shell.walls.map((w) => ({ x: w.start.x, z: w.start.z }));
}

/**
 * ¿El cuarto es exactamente su caja (un rectángulo de 0 a ancho y de 0 a fondo)? Es el caso de
 * todos los proyectos anteriores a los cuartos de forma libre y va por el camino rápido de siempre.
 */
export function isBoxRoom(shell: RoomBounds): boolean {
  const walls = shell.walls;
  if (!walls) return true;
  if (walls.length !== 4) return false;
  const onCorner = (v: Vector3) =>
    (Math.abs(v.x) < 1e-6 || Math.abs(v.x - shell.widthM) < 1e-6) && (Math.abs(v.z) < 1e-6 || Math.abs(v.z - shell.depthM) < 1e-6);
  const axisAligned = (w: WallSegment) => Math.abs(w.start.x - w.end.x) < 1e-6 || Math.abs(w.start.z - w.end.z) < 1e-6;
  return walls.every((w) => onCorner(w.start) && onCorner(w.end) && axisAligned(w) && wallLength(w) > 1e-6);
}

/**
 * El "centro" del cuarto: el de su caja si es rectangular; si no, su punto más despejado (en una
 * L o una U el centro de la caja puede caer fuera del cuarto).
 */
export function roomCenter(shell: RoomBounds): Point2 {
  return isBoxRoom(shell) ? { x: shell.widthM / 2, z: shell.depthM / 2 } : interiorAnchor(roomPolygon({ walls: shell.walls! }));
}

/** ¿La huella cabe completa dentro del cuarto? */
export function isInsideRoom(fp: Footprint, shell: RoomBounds, tolerance = 0.005): boolean {
  if (!isBoxRoom(shell)) return quadInsidePolygon(fp.corners, fp.center, roomPolygon({ walls: shell.walls! }), tolerance);
  const b = footprintBounds(fp);
  return (
    b.minX >= -tolerance &&
    b.minZ >= -tolerance &&
    b.maxX <= shell.widthM + tolerance &&
    b.maxZ <= shell.depthM + tolerance
  );
}

/** Desplaza la posición lo mínimo necesario para que la huella quede dentro del cuarto. */
export function clampToRoom(position: Vector3, dimensionsM: Vector3, rotationY: number, shell: RoomBounds): Vector3 {
  const b = footprintBounds(footprint({ ...position, x: 0, z: 0 }, dimensionsM, rotationY));
  const halfX = (b.maxX - b.minX) / 2;
  const halfZ = (b.maxZ - b.minZ) / 2;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const boxed = {
    x: clamp(position.x, halfX, shell.widthM - halfX),
    y: position.y,
    z: clamp(position.z, halfZ, shell.depthM - halfZ),
  };
  return isBoxRoom(shell) ? boxed : clampToPolygon(boxed, dimensionsM, rotationY, roomPolygon({ walls: shell.walls! }));
}

/**
 * Mete la huella en un cuarto de forma libre. Primero empuja: cada esquina que quedó fuera vuelve
 * al borde más cercano y cada esquina entrante del cuarto que quedó dentro de la huella la saca
 * por su lado más corto. Si con eso no basta (rincones estrechos), busca el hueco válido más
 * cercano en anillos. Si la pieza no cabe en ningún sitio, devuelve la posición recibida.
 */
function clampToPolygon(position: Vector3, dims: Vector3, rotationY: number, poly: Point2[]): Vector3 {
  const fits = (p: Point2) => quadInsidePolygon(footprint({ x: p.x, y: 0, z: p.z }, dims, rotationY).corners, p, poly, 1e-4);
  let p: Point2 = { x: position.x, z: position.z };
  for (let i = 0; i < 8 && !fits(p); i++) {
    const move = pushInside(p, dims, rotationY, poly);
    if (!move) break;
    p = { x: p.x + move.x, z: p.z + move.z };
  }
  if (!fits(p)) {
    const b = polygonBounds(poly);
    const reach = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const found = nearestFit({ x: position.x, z: position.z }, reach, fits);
    if (!found) return position;
    p = found;
  }
  return { x: p.x, y: position.y, z: p.z };
}

/** Un paso de empuje hacia dentro, o null si no hay nada que corregir de esta forma. */
function pushInside(p: Point2, dims: Vector3, rotationY: number, poly: Point2[]): Point2 | null {
  const fp = footprint({ x: p.x, y: 0, z: p.z }, dims, rotationY);
  let move: Point2 | null = null;
  const longer = (v: Point2) => !move || Math.hypot(v.x, v.z) > Math.hypot(move.x, move.z);
  for (const c of fp.corners) {
    if (pointInPolygon(c, poly, 1e-6)) continue;
    const q = closestOnBoundary(c, poly);
    const v = { x: (q.x - c.x) * 1.001, z: (q.z - c.z) * 1.001 };
    if (longer(v)) move = v;
  }
  if (move) return move;
  const hw = dims.x / 2;
  const hd = dims.z / 2;
  for (const v of poly) {
    // El vértice en el marco local de la huella (rotación inversa).
    const local = rotateXZ(v.x - p.x, v.z - p.z, -rotationY);
    if (Math.abs(local.x) >= hw - 1e-6 || Math.abs(local.z) >= hd - 1e-6) continue;
    const exits: Point2[] = [
      { x: local.x - hw, z: 0 },
      { x: local.x + hw, z: 0 },
      { x: 0, z: local.z - hd },
      { x: 0, z: local.z + hd },
    ];
    const shortest = exits.reduce((a, b) => (Math.hypot(a.x, a.z) <= Math.hypot(b.x, b.z) ? a : b));
    const world = rotateXZ(shortest.x * 1.001, shortest.z * 1.001, rotationY);
    if (longer(world)) move = world;
  }
  return move;
}

/** Primer punto válido en anillos crecientes alrededor de `from` (cada 5 cm). */
function nearestFit(from: Point2, reach: number, fits: (p: Point2) => boolean): Point2 | null {
  for (let r = 0.05; r <= reach; r += 0.05) {
    const steps = Math.max(16, Math.ceil((2 * Math.PI * r) / 0.1));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = { x: from.x + Math.cos(a) * r, z: from.z + Math.sin(a) * r };
      if (fits(p)) return p;
    }
  }
  return null;
}

export interface MountContext {
  /** Altura pedida para objetos de pared. */
  elevationM?: number | undefined;
  /** Altura por defecto del catálogo para objetos de pared. */
  elevationDefaultM?: number | undefined;
  /** y del tope del mueble de apoyo (objetos sobre superficies). */
  supportTopY?: number | undefined;
}

/** Altura por defecto de un objeto de pared sin indicación: centrado a la altura de los ojos. */
const WALL_EYE_LEVEL_M = 1.5;

/**
 * Altura (y) de la base del objeto según su montaje.
 * - piso: 0 · techo: pegado al techo
 * - pared: la elevación pedida, acotada para no atravesar piso ni techo
 * - superficie: el tope del soporte (o el piso si no hay soporte)
 */
export function mountY(
  mount: Mount,
  dimensionsM: Vector3,
  shell: Pick<RoomShell, 'heightM'>,
  ctx: MountContext = {},
): number {
  switch (mount) {
    case 'ceiling':
      return Math.max(0, shell.heightM - dimensionsM.y);
    case 'wall': {
      const wanted = ctx.elevationM ?? ctx.elevationDefaultM ?? WALL_EYE_LEVEL_M - dimensionsM.y / 2;
      return Math.min(Math.max(0, shell.heightM - dimensionsM.y), Math.max(0, wanted));
    }
    case 'surface':
      return Math.max(0, ctx.supportTopY ?? 0);
    case 'floor':
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Medidas por pieza (cada mueble puede tener su propio tamaño)
// ---------------------------------------------------------------------------

/** Medidas reales de una pieza: las suyas si el usuario las cambió, si no las del catálogo. */
export function effectiveDimensions(catalogDims: Vector3, placement: Pick<FurniturePlacement, 'dimensionsM'>): Vector3 {
  return placement.dimensionsM ?? catalogDims;
}

/**
 * Ajusta las medidas pedidas a los rangos permitidos por el catálogo. Un eje sin rango no es
 * redimensionable y conserva la medida del catálogo.
 */
export function clampDimensions(wanted: Vector3, catalogDims: Vector3, resize?: ResizeRanges): Vector3 {
  const axis = (k: 'x' | 'y' | 'z') => {
    const range = resize?.[k];
    if (!range) return catalogDims[k];
    return Math.min(range[1], Math.max(range[0], wanted[k]));
  };
  return { x: axis('x'), y: axis('y'), z: axis('z') };
}

/** Rangos por defecto cuando el catálogo no los define: ±30 % de cada medida (mín. 5 cm). */
export function defaultResizeRanges(dims: Vector3): ResizeRanges {
  const r = (v: number): [number, number] => [Math.max(0.05, round3(v * 0.7)), round3(v * 1.3)];
  return { x: r(dims.x), y: r(dims.y), z: r(dims.z) };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
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
  shell: RoomBounds,
  placements: FurniturePlacement[],
  dimensionsOf: (catalogItemId: string) => Vector3 | undefined,
  ignoreCategoriesForOverlap: (catalogItemId: string) => boolean = () => false,
): CollisionReport {
  const report: CollisionReport = { outside: [], overlapping: [] };
  const fps = placements.map((p) => {
    const dims = p.dimensionsM ?? dimensionsOf(p.catalogItemId);
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

export interface PolygonShellOptions {
  id?: string;
  scaleConfidence?: number;
  needsCalibration?: boolean;
}

/** Ids históricos de las cuatro paredes de un cuarto rectangular, por el lado de la caja que ocupan. */
const SIDE_IDS = { back: 'w-back', right: 'w-right', front: 'w-front', left: 'w-left' } as const;

/**
 * Cuarto de forma libre a partir de su planta (los vértices, en cualquier sentido). La planta se
 * lleva al origen y al orden canónico, empezando por la pared del fondo (z = 0). En cada lado de
 * la caja, la pared más larga conserva el id histórico (`w-back`, `w-right`, `w-front`,
 * `w-left`): así "la pared del fondo" sigue significando lo mismo en un cuarto en L. Las demás se
 * numeran `w-2`, `w-3`… según su posición. Sin aberturas: se añaden después.
 */
export function createPolygonShell(points: readonly Point2[], heightM: number, opts: PolygonShellOptions = {}): RoomShell {
  if (points.length < 3 || !isSimplePolygon(points)) throw new RoomGeometryError('La planta del cuarto no es un polígono válido');
  const b = polygonBounds(points);
  const moved = ensureWinding(points).map((p) => ({ x: round3(p.x - b.minX), z: round3(p.z - b.minZ) }));
  const widthM = round3(b.maxX - b.minX);
  const depthM = round3(b.maxZ - b.minZ);
  // Se empieza por el primer lado que corre sobre z = 0 hacia +x (la pared del fondo).
  const first = moved.findIndex((p, i) => {
    const q = moved[(i + 1) % moved.length]!;
    return Math.abs(p.z) < 1e-6 && Math.abs(q.z) < 1e-6 && q.x > p.x;
  });
  const poly = first > 0 ? [...moved.slice(first), ...moved.slice(0, first)] : moved;

  const sideOf = (a: Point2, c: Point2): keyof typeof SIDE_IDS | null => {
    const on = (v: number, target: number) => Math.abs(v - target) < 1e-6;
    if (on(a.z, 0) && on(c.z, 0)) return 'back';
    if (on(a.x, widthM) && on(c.x, widthM)) return 'right';
    if (on(a.z, depthM) && on(c.z, depthM)) return 'front';
    if (on(a.x, 0) && on(c.x, 0)) return 'left';
    return null;
  };
  const edges = poly.map((a, i) => {
    const c = poly[(i + 1) % poly.length]!;
    return { a, c, side: sideOf(a, c), length: Math.hypot(c.x - a.x, c.z - a.z) };
  });
  const longest = new Map<string, number>();
  edges.forEach((e, i) => {
    if (!e.side) return;
    const current = longest.get(e.side);
    if (current === undefined || e.length > edges[current]!.length + 1e-9) longest.set(e.side, i);
  });
  const walls: WallSegment[] = edges.map((e, i) => ({
    id: e.side && longest.get(e.side) === i ? SIDE_IDS[e.side] : `w-${i + 1}`,
    start: { x: e.a.x, y: 0, z: e.a.z },
    end: { x: e.c.x, y: 0, z: e.c.z },
    hasWindow: false,
  }));
  return {
    id: opts.id ?? 'room',
    widthM,
    depthM,
    heightM,
    walls,
    openings: [],
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

// ---------------------------------------------------------------------------
// Medidas exactas del cuarto (el usuario escribe ancho, largo y alto)
// ---------------------------------------------------------------------------

export const ROOM_LIMITS = {
  minSideM: 0.8,
  maxSideM: 30,
  minHeightM: 2,
  maxHeightM: 6,
  /** Separación mínima entre una abertura y la esquina u otra abertura. */
  openingMarginM: 0.05,
} as const;

export interface RoomDimensions {
  widthM: number;
  depthM: number;
  heightM: number;
}

export class RoomGeometryError extends Error {}

/** Valida que las aberturas quepan en su pared, no se solapen y no atraviesen el techo. */
export function validateOpenings(shell: Pick<RoomShell, 'walls' | 'openings' | 'heightM'>): void {
  const walls = new Map(shell.walls.map((w) => [w.id, w]));
  const margin = ROOM_LIMITS.openingMarginM;
  const byWall = new Map<string, Opening[]>();
  for (const o of shell.openings) {
    const wall = walls.get(o.wallId);
    if (!wall) throw new RoomGeometryError(`La abertura ${o.id} apunta a una pared inexistente (${o.wallId})`);
    const len = wallLength(wall);
    const label = o.type === 'door' ? 'La puerta' : 'La ventana';
    if (o.offsetM - o.widthM / 2 < margin - EPS || o.offsetM + o.widthM / 2 > len - margin + EPS) {
      throw new RoomGeometryError(`${label} ${o.id} no cabe en la pared (mide ${len.toFixed(2)} m)`);
    }
    if (o.sillHeightM + o.heightM > shell.heightM - margin + EPS) {
      throw new RoomGeometryError(`${label} ${o.id} es más alta que el cuarto`);
    }
    byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);
  }
  for (const list of byWall.values()) {
    const sorted = [...list].sort((a, b) => a.offsetM - b.offsetM);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (prev.offsetM + prev.widthM / 2 + margin > cur.offsetM - cur.widthM / 2 + EPS) {
        throw new RoomGeometryError(`Las aberturas ${prev.id} y ${cur.id} se solapan`);
      }
    }
  }
}

/** Lado más corto que puede tener una pared: por debajo no cabe ni se puede dibujar bien. */
export const MIN_WALL_M = 0.4;

/**
 * Valida la planta de un cuarto: paredes encadenadas que cierran, sin cruzarse, con ids únicos,
 * lados de al menos 40 cm y la caja (`widthM` × `depthM`) pegada al origen. Después valida las
 * aberturas. Un cuarto rectangular de los de siempre pasa sin más.
 */
export function validateRoomShell(shell: RoomShell): void {
  const { walls } = shell;
  if (new Set(walls.map((w) => w.id)).size !== walls.length) throw new RoomGeometryError('Hay paredes con el mismo id');
  const near = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-3;
  walls.forEach((w, i) => {
    if (wallLength(w) < MIN_WALL_M - 1e-6) throw new RoomGeometryError(`La pared ${w.id} es demasiado corta (mínimo ${MIN_WALL_M} m)`);
    if (!near(w.end, walls[(i + 1) % walls.length]!.start)) throw new RoomGeometryError('Las paredes del cuarto no cierran');
  });
  const poly = roomPolygon(shell);
  if (!isSimplePolygon(poly)) throw new RoomGeometryError('Las paredes del cuarto se cruzan');
  const b = polygonBounds(poly);
  if (Math.abs(b.minX) > 1e-3 || Math.abs(b.minZ) > 1e-3 || Math.abs(b.maxX - shell.widthM) > 1e-3 || Math.abs(b.maxZ - shell.depthM) > 1e-3) {
    throw new RoomGeometryError('Las medidas del cuarto no coinciden con sus paredes');
  }
  validateOpenings(shell);
}

/**
 * Quita las aberturas que se solapan con otra anterior de la misma pared. Los proyectos
 * analizados antes de corregir el detector pueden traer la misma ventana duplicada: como el
 * usuario no las escribió, se limpian en silencio en lugar de bloquear el cambio de medidas.
 */
export function dropOverlappingOpenings(openings: Opening[]): Opening[] {
  const margin = ROOM_LIMITS.openingMarginM;
  const kept: Opening[] = [];
  for (const o of openings) {
    const clash = kept.some(
      (k) =>
        k.wallId === o.wallId &&
        k.offsetM - k.widthM / 2 < o.offsetM + o.widthM / 2 + margin &&
        o.offsetM - o.widthM / 2 < k.offsetM + k.widthM / 2 + margin,
    );
    if (!clash) kept.push(o);
  }
  return kept;
}

/** Mete una abertura dentro de su pared nueva: recorta ancho/alto y desliza el centro. */
function fitOpening(o: Opening, wallLen: number, heightM: number): Opening {
  const margin = ROOM_LIMITS.openingMarginM;
  const widthM = Math.min(o.widthM, Math.max(0.2, wallLen - 2 * margin));
  const sillHeightM = Math.min(o.sillHeightM, Math.max(0, heightM - 0.5));
  const heightMax = Math.max(0.2, heightM - sillHeightM - margin);
  const half = widthM / 2;
  const offsetM = Math.min(wallLen - margin - half, Math.max(margin + half, o.offsetM));
  return { ...o, widthM, heightM: Math.min(o.heightM, heightMax), sillHeightM, offsetM };
}

/**
 * Cambia ancho, largo y alto del cuarto de forma independiente (a diferencia de la calibración,
 * que escala todo por un factor). Las paredes se reconstruyen; cada abertura conserva su
 * posición relativa en su pared y se recorta si ya no cabe. Si se pasan `openings`, sustituyen a
 * las actuales y se validan tal cual (sin recortes silenciosos: el usuario las escribió).
 * Las medidas del usuario son exactas: la escala queda confirmada.
 */
export function resizeRoomShell(shell: RoomShell, dims: RoomDimensions, openings?: Opening[]): RoomShell {
  const { minSideM, maxSideM, minHeightM, maxHeightM } = ROOM_LIMITS;
  for (const [label, v, lo, hi] of [
    ['ancho', dims.widthM, minSideM, maxSideM],
    ['largo', dims.depthM, minSideM, maxSideM],
    ['alto', dims.heightM, minHeightM, maxHeightM],
  ] as const) {
    if (!Number.isFinite(v) || v < lo || v > hi) {
      throw new RoomGeometryError(`El ${label} del cuarto debe estar entre ${lo} y ${hi} m`);
    }
  }
  // Un cuarto de forma libre conserva su forma: la planta se estira en cada eje hasta la medida pedida.
  const sx = dims.widthM / shell.widthM;
  const sz = dims.depthM / shell.depthM;
  const stretch = (v: Vector3): Vector3 => ({ x: v.x * sx, y: 0, z: v.z * sz });
  const rebuilt = isBoxRoom(shell)
    ? createRectangularShell(dims.widthM, dims.depthM, dims.heightM, { id: shell.id, door: false, window: false })
    : { walls: shell.walls.map((w) => ({ ...w, start: stretch(w.start), end: stretch(w.end) })) };
  const newWalls = new Map(rebuilt.walls.map((w) => [w.id, w]));
  const oldWalls = new Map(shell.walls.map((w) => [w.id, w]));

  let nextOpenings: Opening[];
  if (openings) {
    nextOpenings = openings;
  } else {
    nextOpenings = dropOverlappingOpenings(
      shell.openings.flatMap((o) => {
        const before = oldWalls.get(o.wallId);
        const after = newWalls.get(o.wallId);
        if (!before || !after) return []; // pared que ya no existe (cuartos no rectangulares)
        const ratio = wallLength(after) / (wallLength(before) || 1);
        return [fitOpening({ ...o, offsetM: o.offsetM * ratio }, wallLength(after), dims.heightM)];
      }),
    );
  }
  const walls = rebuilt.walls.map((w) => ({
    ...w,
    hasWindow: nextOpenings.some((o) => o.wallId === w.id && o.type === 'window'),
  }));
  const result: RoomShell = {
    ...shell,
    widthM: dims.widthM,
    depthM: dims.depthM,
    heightM: dims.heightM,
    walls,
    openings: nextOpenings,
    scaleConfidence: 1,
    needsCalibration: false,
  };
  validateOpenings(result);
  return result;
}

export interface FitResult {
  placements: FurniturePlacement[];
  /** Piezas que se movieron para quedar dentro. */
  moved: string[];
  /** Piezas que ni moviéndolas caben (más grandes que el cuarto): se dejan para que el usuario decida. */
  tooBig: string[];
}

/**
 * Tras cambiar el cuarto, mete cada mueble dentro moviéndolo lo mínimo. Nada se borra: los que
 * no caben se reportan en `tooBig`.
 */
export function fitPlacementsToRoom(
  placements: FurniturePlacement[],
  dimensionsOf: (p: FurniturePlacement) => Vector3 | undefined,
  shell: RoomBounds,
): FitResult {
  const moved: string[] = [];
  const tooBig: string[] = [];
  const next = placements.map((p) => {
    const dims = dimensionsOf(p);
    if (!dims) return p;
    const position = clampToRoom(p.position, dims, p.rotationY, shell);
    if (Math.abs(position.x - p.position.x) > EPS || Math.abs(position.z - p.position.z) > EPS) moved.push(p.id);
    if (!isInsideRoom(footprint(position, dims, p.rotationY), shell)) tooBig.push(p.id);
    return { ...p, position };
  });
  return { placements: next, moved, tooBig };
}
