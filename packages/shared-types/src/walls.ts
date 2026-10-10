/**
 * Paredes de un cuarto vistas desde dentro: hacia dónde mira lo que se cuelga en cada una y dónde
 * quedan sus puertas y ventanas. Lo usan la web (arrastrar, colocar) y el resolvedor espacial del
 * chat. Los marcos salen de las paredes reales del cuarto, tenga la forma que tenga.
 */
import type { RoomShell, WallSegment } from './domain.js';
import { signedArea, type Point2 } from './polygon.js';

export interface WallFrame {
  id: string;
  /** Extremo de la pared donde `along` vale 0. */
  base: Point2;
  /**
   * Dirección unitaria en la que crece `along`. Siempre hacia +x o +z (en una pared inclinada,
   * hacia su componente mayor): en un cuarto rectangular `along` coincide con la coordenada x o z.
   */
  dir: Point2;
  /** Normal unitaria hacia el interior del cuarto. */
  normal: Point2;
  length: number;
  /** Giro (Y) de un objeto colgado en esta pared para que mire al cuarto. */
  rotationY: number;
  /** Si `base` es el `start` de la pared (las aberturas miden su `offsetM` desde `start`). */
  startAtBase: boolean;
}

function frameOf(wall: WallSegment, canonical: boolean): WallFrame {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const length = Math.hypot(dx, dz) || 1;
  const sign = canonical ? 1 : -1;
  // El `+ 0` evita el cero negativo, que daría un giro de −π en vez de π.
  const normal = { x: (-dz / length) * sign + 0, z: (dx / length) * sign + 0 };
  // `along` crece hacia el lado positivo del eje dominante.
  const startAtBase = Math.abs(dx) >= Math.abs(dz) ? dx > 0 : dz > 0;
  const from = startAtBase ? wall.start : wall.end;
  const k = startAtBase ? 1 : -1;
  return {
    id: wall.id,
    base: { x: from.x, z: from.z },
    dir: { x: (dx / length) * k + 0, z: (dz / length) * k + 0 },
    normal,
    length,
    rotationY: Math.atan2(normal.x, normal.z),
    startAtBase,
  };
}

/** Un marco por pared, en el orden de `shell.walls`. */
export function wallFrames(shell: Pick<RoomShell, 'walls'>): WallFrame[] {
  const canonical = signedArea(shell.walls.map((w) => ({ x: w.start.x, z: w.start.z }))) >= 0;
  return shell.walls.map((w) => frameOf(w, canonical));
}

/** Posición `along` (metros desde `base`) del punto más cercano de la pared a `p`. */
export function alongOf(wall: WallFrame, p: Point2): number {
  return (p.x - wall.base.x) * wall.dir.x + (p.z - wall.base.z) * wall.dir.z;
}

/** Distancia de `p` a la cara interior de la pared (positiva hacia dentro del cuarto). */
export function distanceFromWall(wall: WallFrame, p: Point2): number {
  return (p.x - wall.base.x) * wall.normal.x + (p.z - wall.base.z) * wall.normal.z;
}

/** ¿Una pieza colgada en `wall` (centrada en `along`, base en y) tapa una puerta o ventana? */
export function overlapsOpening(shell: Pick<RoomShell, 'openings'>, wall: WallFrame, along: number, width: number, y: number, height: number): boolean {
  return shell.openings.some((o) => {
    if (o.wallId !== wall.id) return false;
    // offsetM se mide desde el inicio de la pared; se pasa a la posición a lo largo del marco.
    const center = wall.startAtBase ? o.offsetM : wall.length - o.offsetM;
    const horiz = Math.min(center + o.widthM / 2, along + width / 2) - Math.max(center - o.widthM / 2, along - width / 2) > 0.01;
    const vert = Math.min(o.sillHeightM + o.heightM, y + height) - Math.max(o.sillHeightM, y) > 0.01;
    return horiz && vert;
  });
}

/** Posición de una pieza contra `wall`, centrada en `along`, a la altura y. */
export function positionOnWall(wall: WallFrame, along: number, y: number, depth: number): { x: number; y: number; z: number } {
  const out = depth / 2 + 0.001;
  return {
    x: wall.base.x + wall.dir.x * along + wall.normal.x * out,
    y,
    z: wall.base.z + wall.dir.z * along + wall.normal.z * out,
  };
}
