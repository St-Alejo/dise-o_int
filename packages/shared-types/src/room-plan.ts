/**
 * La planta de un cuarto como objeto del dominio: sabe su área, dónde cabe un mueble, cuál es
 * "la pared del fondo" y cómo cambiar de medidas. Es inmutable: cada cambio devuelve otra planta.
 * `RoomShell` sigue siendo el formato que viaja y se guarda; `RoomPlan` es quien lo entiende.
 */
import type { RoomShell, Vector3, WallSegment } from './domain.js';
import {
  clampToRoom,
  isBoxRoom,
  isInsideRoom,
  resizeRoomShell,
  roomCenter,
  roomPolygon,
  validateRoomShell,
  wallLength,
  type Footprint,
  type RoomDimensions,
} from './geometry.js';
import { isConvexVertex, signedArea, type Point2 } from './polygon.js';
import { buildRoomShape, type RoomShapeId, type RoomShapeParams } from './room-templates.js';
import { wallFrames, type WallFrame } from './walls.js';

export type WallDirection = 'back' | 'right' | 'front' | 'left';

/** Hacia dónde mira (su normal interior) la pared de cada lado del cuarto. */
const FACING: Record<WallDirection, Point2> = {
  back: { x: 0, z: 1 },
  right: { x: -1, z: 0 },
  front: { x: 0, z: -1 },
  left: { x: 1, z: 0 },
};

export class RoomPlan {
  private constructor(private readonly shell: RoomShell) {}

  static from(shell: RoomShell): RoomPlan {
    return new RoomPlan(shell);
  }

  /** Cuarto nuevo a partir de una plantilla de forma (rectángulo, L, T, U). */
  static fromShape(shape: RoomShapeId, params: RoomShapeParams, id = 'room'): RoomPlan {
    return new RoomPlan(buildRoomShape(shape, params, { id }));
  }

  toShell(): RoomShell {
    return this.shell;
  }

  get polygon(): Point2[] {
    return roomPolygon(this.shell);
  }

  get isRectangular(): boolean {
    return isBoxRoom(this.shell);
  }

  /** Superficie del piso en m². */
  area(): number {
    return Math.abs(signedArea(this.polygon));
  }

  /** Punto más despejado del cuarto (su centro si es rectangular). */
  center(): Point2 {
    return roomCenter(this.shell);
  }

  frames(): WallFrame[] {
    return wallFrames(this.shell);
  }

  wall(id: string): WallSegment | null {
    return this.shell.walls.find((w) => w.id === id) ?? null;
  }

  /** ¿La esquina donde empieza la pared `index` es saliente? Las entrantes son las de la muesca. */
  convexAt(index: number): boolean {
    return isConvexVertex(this.polygon, index);
  }

  contains(fp: Footprint): boolean {
    return isInsideRoom(fp, this.shell);
  }

  /** La posición más cercana a la pedida en la que la pieza cabe entera. */
  clamp(position: Vector3, dimensionsM: Vector3, rotationY: number): Vector3 {
    return clampToRoom(position, dimensionsM, rotationY, this.shell);
  }

  /**
   * La pared que alguien llamaría "la del fondo" (o izquierda, derecha, frente): la más larga
   * entre las que miran hacia ese lado. En un cuarto rectangular es la de siempre.
   */
  wallByDirection(direction: WallDirection): WallSegment | null {
    const facing = FACING[direction];
    let best: { id: string; score: number } | null = null;
    for (const frame of this.frames()) {
      const aligned = frame.normal.x * facing.x + frame.normal.z * facing.z;
      if (aligned < 0.7) continue;
      const score = aligned * frame.length;
      if (!best || score > best.score + 1e-9) best = { id: frame.id, score };
    }
    return best ? this.wall(best.id) : null;
  }

  /** Pared que se pinta de acento en las paletas de estilo: la del fondo. */
  accentWallId(): string {
    return (this.wallByDirection('back') ?? this.shell.walls[0]!).id;
  }

  /** Longitud total de pared (perímetro). */
  perimeter(): number {
    return this.shell.walls.reduce((sum, w) => sum + wallLength(w), 0);
  }

  /** El mismo cuarto con otras medidas totales: conserva la forma y reacomoda las aberturas. */
  scaledTo(dims: RoomDimensions): RoomPlan {
    return new RoomPlan(resizeRoomShell(this.shell, dims));
  }

  /** Lanza `RoomGeometryError` si la planta o sus aberturas no son válidas. */
  validate(): this {
    validateRoomShell(this.shell);
    return this;
  }
}
