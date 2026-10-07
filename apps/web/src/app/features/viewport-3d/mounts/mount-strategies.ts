/**
 * Strategy de montaje: cómo se mueve una pieza al arrastrarla según dónde va.
 * - Piso: sobre el plano del piso, metida en el cuarto y pegada a la pared si está cerca.
 * - Techo: igual que el piso en planta, colgada del techo.
 * - Pared: se desliza por la pared que apunta el cursor, mirando al cuarto, a la altura del cursor;
 *   no puede tapar puertas ni ventanas.
 * - Superficie: se apoya sobre el mueble que apunta el cursor (guarda `supportId`); si no hay
 *   ninguno debajo, queda en el piso.
 *
 * Matemática pura (sin three.js): recibe un rayo y devuelve una pose. Se prueba sin GPU.
 */
import {
  clampToRoom,
  footprint,
  mountY,
  overlapsOpening,
  rotateXZ,
  wallFrames,
  type WallFrame,
  type Mount,
  type RoomShell,
  type Vector3,
} from '@interiores/shared-types';

export interface Ray {
  origin: Vector3;
  direction: Vector3;
}

/** Un mueble sobre el que se puede apoyar algo (su tapa está en position.y + dims.y). */
export interface SupportCandidate {
  id: string;
  position: Vector3;
  rotationY: number;
  dims: Vector3;
}

export interface DragContext {
  shell: RoomShell;
  dims: Vector3;
  rotationY: number;
  /** Desplazamiento entre el punto agarrado y el centro de la pieza (en planta). */
  grabOffset: { x: number; z: number };
  supports: readonly SupportCandidate[];
}

export interface MountPose {
  position: Vector3;
  rotationY: number;
  wallId?: string;
  supportId?: string;
  elevationM?: number;
  /** La pose existe pero no se permite (p. ej. taparía una ventana). */
  blockedBy?: 'opening';
}

export interface MountStrategy {
  readonly mount: Mount;
  poseFor(ray: Ray, ctx: DragContext): MountPose | null;
}

/** Punto donde el rayo corta el plano horizontal y = h (o null si es paralelo o queda detrás). */
export function intersectHorizontal(ray: Ray, h: number): Vector3 | null {
  const dy = ray.direction.y;
  if (Math.abs(dy) < 1e-9) return null;
  const t = (h - ray.origin.y) / dy;
  if (t <= 0) return null;
  return { x: ray.origin.x + ray.direction.x * t, y: h, z: ray.origin.z + ray.direction.z * t };
}

export const WALL_SNAP_M = 0.15;

/** Pega la pieza a la pared si está a menos de 15 cm (contra la pared es lo habitual). */
export function snapToWalls(pos: Vector3, dims: Vector3, rotationY: number, shell: Pick<RoomShell, 'widthM' | 'depthM'>): Vector3 {
  const fp = footprint(pos, dims, rotationY);
  const xs = fp.corners.map((c) => c.x);
  const zs = fp.corners.map((c) => c.z);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const out = { ...pos };
  if (minX < WALL_SNAP_M) out.x -= minX;
  else if (shell.widthM - maxX < WALL_SNAP_M) out.x += shell.widthM - maxX;
  if (minZ < WALL_SNAP_M) out.z -= minZ;
  else if (shell.depthM - maxZ < WALL_SNAP_M) out.z += shell.depthM - maxZ;
  return out;
}

export class FloorMount implements MountStrategy {
  readonly mount: Mount = 'floor';
  poseFor(ray: Ray, ctx: DragContext): MountPose | null {
    const hit = intersectHorizontal(ray, 0);
    if (!hit) return null;
    const wanted = { x: hit.x + ctx.grabOffset.x, y: 0, z: hit.z + ctx.grabOffset.z };
    const clamped = clampToRoom(wanted, ctx.dims, ctx.rotationY, ctx.shell);
    const position = snapToWalls(clamped, ctx.dims, ctx.rotationY, ctx.shell);
    return { position: { ...position, y: this.y(ctx) }, rotationY: ctx.rotationY };
  }
  protected y(_ctx: DragContext): number {
    return 0;
  }
}

/** Techo: se mueve en planta como en el piso (el cursor apunta al piso), colgada del techo. */
export class CeilingMount extends FloorMount {
  override readonly mount: Mount = 'ceiling';
  protected override y(ctx: DragContext): number {
    return mountY('ceiling', ctx.dims, ctx.shell);
  }
}

// Los marcos de pared viven en shared-types (también los usa el resolvedor espacial del chat).
export { overlapsOpening, wallFrames, type WallFrame } from '@interiores/shared-types';

export class WallMount implements MountStrategy {
  readonly mount: Mount = 'wall';
  poseFor(ray: Ray, ctx: DragContext): MountPose | null {
    const { shell, dims } = ctx;
    let best: { t: number; wall: WallFrame; along: number; y: number } | null = null;
    for (const wall of wallFrames(shell)) {
      if (!shell.walls.some((w) => w.id === wall.id)) continue;
      const axis = wall.along === 'x' ? 'z' : 'x';
      const d = ray.direction[axis];
      // Solo paredes vistas desde dentro: el rayo va hacia la pared (contra su normal interior).
      if (d * wall.inward >= 0) continue;
      const t = (wall.fixed - ray.origin[axis]) / d;
      if (t <= 0) continue;
      const along = ray.origin[wall.along] + ray.direction[wall.along] * t;
      const y = ray.origin.y + ray.direction.y * t;
      if (along < -0.05 || along > wall.length + 0.05 || y < -0.05 || y > shell.heightM + 0.05) continue;
      if (!best || t < best.t) best = { t, wall, along, y };
    }
    if (!best) return null;
    const { wall } = best;
    const half = dims.x / 2;
    const along = Math.min(wall.length - half, Math.max(half, best.along));
    const elevationM = Math.min(Math.max(0, shell.heightM - dims.y), Math.max(0, best.y - dims.y / 2));
    const offset = wall.fixed + wall.inward * (dims.z / 2 + 0.001);
    const position = wall.along === 'x' ? { x: along, y: elevationM, z: offset } : { x: offset, y: elevationM, z: along };
    const pose: MountPose = { position, rotationY: wall.rotationY, wallId: wall.id, elevationM };
    if (overlapsOpening(shell, wall, along, dims.x, elevationM, dims.y)) pose.blockedBy = 'opening';
    return pose;
  }
}

export class SurfaceMount implements MountStrategy {
  readonly mount: Mount = 'surface';
  private readonly floor = new FloorMount();
  poseFor(ray: Ray, ctx: DragContext): MountPose | null {
    let best: { t: number; s: SupportCandidate; local: { x: number; z: number } } | null = null;
    for (const s of ctx.supports) {
      const top = s.position.y + s.dims.y;
      const hit = intersectHorizontal(ray, top);
      if (!hit) continue;
      // Punto en coordenadas locales del soporte (deshace su giro).
      const local = rotateXZ(hit.x - s.position.x, hit.z - s.position.z, -s.rotationY);
      if (Math.abs(local.x) > s.dims.x / 2 || Math.abs(local.z) > s.dims.z / 2) continue;
      const t = Math.hypot(hit.x - ray.origin.x, hit.y - ray.origin.y, hit.z - ray.origin.z);
      if (!best || t < best.t) best = { t, s, local };
    }
    if (!best) {
      const onFloor = this.floor.poseFor(ray, ctx);
      return onFloor ? { ...onFloor } : null;
    }
    const { s } = best;
    // La pieza queda entera sobre la tapa (si es más grande que el soporte, centrada).
    const mx = Math.max(0, (s.dims.x - ctx.dims.x) / 2);
    const mz = Math.max(0, (s.dims.z - ctx.dims.z) / 2);
    const lx = Math.min(mx, Math.max(-mx, best.local.x));
    const lz = Math.min(mz, Math.max(-mz, best.local.z));
    const w = rotateXZ(lx, lz, s.rotationY);
    return {
      position: { x: s.position.x + w.x, y: s.position.y + s.dims.y, z: s.position.z + w.z },
      rotationY: s.rotationY,
      supportId: s.id,
    };
  }
}

/** Registro de estrategias por montaje. */
export const MOUNT_STRATEGIES: Record<Mount, MountStrategy> = {
  floor: new FloorMount(),
  ceiling: new CeilingMount(),
  wall: new WallMount(),
  surface: new SurfaceMount(),
};
