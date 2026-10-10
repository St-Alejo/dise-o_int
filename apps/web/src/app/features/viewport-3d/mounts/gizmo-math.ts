/**
 * Matemática del gizmo del visor 3D (pura, sin three.js): dónde van el aro de rotación y los
 * tiradores de una pieza, y cómo se traduce un rayo del cursor a un giro o a una medida nueva.
 * Igual que las estrategias de montaje, se prueba sin GPU.
 */
import { rotateXZ, type Point2, type RoomShell, type Vector3 } from '@interiores/shared-types';
import { alongOf, distanceFromWall, wallFrames, type WallFrame } from '@interiores/shared-types';
import { intersectHorizontal, type Ray } from './mount-strategies';

export type GizmoHandleKind = 'rotate' | 'width' | 'depth' | 'height' | 'elevation';

export interface GizmoHandle {
  kind: GizmoHandleKind;
  position: Vector3;
}

export interface GizmoLayout {
  /** Centro de la base de la pieza. */
  centre: Vector3;
  /** Radio del aro de rotación (0 = sin aro). */
  ringRadius: number;
  handles: GizmoHandle[];
}

export interface GizmoOptions {
  /** Qué ejes se pueden redimensionar (los rangos del catálogo). */
  resizable: { x: boolean; y: boolean; z: boolean };
  /** Lo colgado en pared no gira: sube y baja. */
  onWall: boolean;
}

/** Separación entre la pieza y sus tiradores. */
export const HANDLE_GAP_M = 0.16;

/** Dónde se dibuja cada parte del gizmo para una pieza en `position` (centro de su base). */
export function gizmoLayout(position: Vector3, dims: Vector3, rotationY: number, options: GizmoOptions): GizmoLayout {
  const at = (lx: number, y: number, lz: number): Vector3 => {
    const w = rotateXZ(lx, lz, rotationY);
    return { x: position.x + w.x, y, z: position.z + w.z };
  };
  const mid = position.y + dims.y / 2;
  const ringRadius = options.onWall ? 0 : Math.hypot(dims.x, dims.z) / 2 + 0.22;
  const handles: GizmoHandle[] = [];
  if (!options.onWall) handles.push({ kind: 'rotate', position: at(0, position.y + 0.02, ringRadius) });
  if (options.resizable.x) handles.push({ kind: 'width', position: at(dims.x / 2 + HANDLE_GAP_M, mid, 0) });
  if (options.resizable.z && !options.onWall) handles.push({ kind: 'depth', position: at(0, mid, -(dims.z / 2 + HANDLE_GAP_M)) });
  if (options.resizable.y) handles.push({ kind: 'height', position: at(0, position.y + dims.y + HANDLE_GAP_M, 0) });
  if (options.onWall) handles.push({ kind: 'elevation', position: at(-(dims.x / 2 + HANDLE_GAP_M), mid, 0) });
  return { centre: { ...position }, ringRadius, handles };
}

/** Ángulo (como `rotationY`) hacia el que apunta `point` visto desde `centre`. */
export function angleTo(centre: Point2, point: Point2): number {
  return Math.atan2(point.x - centre.x, point.z - centre.z);
}

/** Giro de la pieza al arrastrar el aro: lo que giró el cursor desde que se agarró, ajustado al paso. */
export function rotationFromDrag(startRotation: number, grabAngle: number, angle: number, stepRad: number | null): number {
  const raw = startRotation + (angle - grabAngle);
  const snapped = stepRad ? Math.round(raw / stepRad) * stepRad : raw;
  const turn = Math.PI * 2;
  return ((snapped % turn) + turn) % turn;
}

/**
 * Altura a la que el rayo pasa más cerca de la vertical que sube por `through`: sirve para
 * arrastrar "hacia arriba" (el alto de un mueble, la altura de un cuadro) desde cualquier ángulo.
 */
export function heightAlongVertical(ray: Ray, through: Point2): number | null {
  const dx = ray.direction.x;
  const dz = ray.direction.z;
  const flat = dx * dx + dz * dz;
  if (flat < 1e-9) return null; // mirando justo desde arriba no hay altura que leer
  const t = ((through.x - ray.origin.x) * dx + (through.z - ray.origin.z) * dz) / flat;
  return t > 0 ? ray.origin.y + ray.direction.y * t : null;
}

/**
 * Medida nueva de un eje al arrastrar su tirador. El ancho y el fondo crecen simétricos respecto
 * al centro (el tirador queda bajo el cursor); el alto llega hasta donde apunta el cursor.
 */
export function sizeFromDrag(kind: 'width' | 'depth' | 'height', ray: Ray, position: Vector3, dims: Vector3, rotationY: number): number | null {
  if (kind === 'height') {
    const y = heightAlongVertical(ray, position);
    return y === null ? null : y - HANDLE_GAP_M - position.y;
  }
  const hit = intersectHorizontal(ray, position.y + dims.y / 2);
  if (!hit) return null;
  const local = rotateXZ(hit.x - position.x, hit.z - position.z, -rotationY);
  const half = kind === 'width' ? Math.abs(local.x) : Math.abs(local.z);
  return Math.max(0, half - HANDLE_GAP_M) * 2;
}

export interface WallHit {
  wall: WallFrame;
  /** Metros a lo largo de la pared (desde su `base`) y altura del punto tocado. */
  along: number;
  y: number;
  /** Punto tocado, en planta. */
  point: Point2;
  /** Distancia a lo largo del rayo. */
  t: number;
}

/**
 * Pared que el rayo toca por su cara interior (la primera que encuentra). Las paredes que quedan
 * de espaldas a la cámara no cuentan: son las que el visor vuelve translúcidas.
 */
export function hitWall(ray: Ray, shell: Pick<RoomShell, 'walls' | 'heightM'>): WallHit | null {
  let best: WallHit | null = null;
  for (const wall of wallFrames(shell)) {
    const d = ray.direction.x * wall.normal.x + ray.direction.z * wall.normal.z;
    if (d >= 0) continue;
    const t = -distanceFromWall(wall, ray.origin) / d;
    if (t <= 0) continue;
    const point = { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
    const along = alongOf(wall, point);
    const y = ray.origin.y + ray.direction.y * t;
    if (along < -0.05 || along > wall.length + 0.05 || y < -0.05 || y > shell.heightM + 0.05) continue;
    if (!best || t < best.t) best = { wall, along, y, point, t };
  }
  return best;
}

/** Abertura (puerta o ventana) que hay en ese punto de la pared, si la hay. */
export function openingAt(shell: Pick<RoomShell, 'openings'>, hit: WallHit): string | null {
  const found = shell.openings.find((o) => {
    if (o.wallId !== hit.wall.id) return false;
    const centre = hit.wall.startAtBase ? o.offsetM : hit.wall.length - o.offsetM;
    return Math.abs(hit.along - centre) <= o.widthM / 2 && hit.y >= o.sillHeightM && hit.y <= o.sillHeightM + o.heightM;
  });
  return found?.id ?? null;
}
