/**
 * Paredes de un cuarto rectangular vistas desde dentro: hacia dónde mira lo que se cuelga en
 * cada una y dónde quedan sus puertas y ventanas. Lo usan la web (arrastrar, colocar) y el
 * resolvedor espacial del chat.
 */
import type { RoomShell } from './domain.js';

export interface WallFrame {
  id: string;
  /** Giro (Y) de un objeto colgado en esta pared para que mire al cuarto. */
  rotationY: number;
  along: 'x' | 'z';
  /** Coordenada fija de la pared (z para w-back/w-front, x para w-left/w-right). */
  fixed: number;
  length: number;
  /** Signo de la normal interior sobre el eje fijo. */
  inward: 1 | -1;
  /** Si recorrer la pared desde su `start` aumenta la coordenada `along`. */
  startAtZero: boolean;
}

export function wallFrames(shell: Pick<RoomShell, 'widthM' | 'depthM'>): WallFrame[] {
  return [
    { id: 'w-back', rotationY: 0, along: 'x', fixed: 0, length: shell.widthM, inward: 1, startAtZero: true },
    { id: 'w-right', rotationY: -Math.PI / 2, along: 'z', fixed: shell.widthM, length: shell.depthM, inward: -1, startAtZero: true },
    { id: 'w-front', rotationY: Math.PI, along: 'x', fixed: shell.depthM, length: shell.widthM, inward: -1, startAtZero: false },
    { id: 'w-left', rotationY: Math.PI / 2, along: 'z', fixed: 0, length: shell.depthM, inward: 1, startAtZero: false },
  ];
}

/** ¿Una pieza colgada en `wall` (centrada en `along`, base en y) tapa una puerta o ventana? */
export function overlapsOpening(shell: RoomShell, wall: WallFrame, along: number, width: number, y: number, height: number): boolean {
  return shell.openings.some((o) => {
    if (o.wallId !== wall.id) return false;
    // offsetM se mide desde el inicio de la pared; se pasa a la coordenada del cuarto.
    const center = wall.startAtZero ? o.offsetM : wall.length - o.offsetM;
    const horiz = Math.min(center + o.widthM / 2, along + width / 2) - Math.max(center - o.widthM / 2, along - width / 2) > 0.01;
    const vert = Math.min(o.sillHeightM + o.heightM, y + height) - Math.max(o.sillHeightM, y) > 0.01;
    return horiz && vert;
  });
}

/** Posición de una pieza contra `wall`, centrada en `along`, a la altura y. */
export function positionOnWall(wall: WallFrame, along: number, y: number, depth: number): { x: number; y: number; z: number } {
  const offset = wall.fixed + wall.inward * (depth / 2 + 0.001);
  return wall.along === 'x' ? { x: along, y, z: offset } : { x: offset, y, z: along };
}
