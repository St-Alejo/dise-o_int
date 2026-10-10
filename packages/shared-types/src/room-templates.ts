/**
 * Plantillas de forma del cuarto: rectángulo, L, T y U. Cada una sabe dibujar su planta a partir
 * de las medidas totales y del tamaño de su muesca; el cuarto se construye siempre igual
 * (`buildRoomShape`). Añadir una forma es añadir una plantilla al registro.
 */
import type { RoomShell } from './domain.js';
import { createPolygonShell, createRectangularShell, MIN_WALL_M, type PolygonShellOptions } from './geometry.js';
import type { Point2 } from './polygon.js';

export const ROOM_SHAPE_IDS = ['rect', 'L', 'T', 'U'] as const;
export type RoomShapeId = (typeof ROOM_SHAPE_IDS)[number];

export interface RoomShapeParams {
  /** Medidas totales (la caja que envuelve al cuarto). */
  widthM: number;
  depthM: number;
  heightM: number;
  /** Tamaño de la muesca que distingue a la forma; si falta, el de la plantilla. */
  notchWidthM?: number;
  notchDepthM?: number;
}

export interface Notch {
  widthM: number;
  depthM: number;
}

export interface RoomShapeTemplate {
  readonly id: RoomShapeId;
  readonly label: string;
  readonly description: string;
  /** Si la forma tiene muesca (el rectángulo no). */
  readonly hasNotch: boolean;
  /** Muesca habitual para un cuarto de ese ancho y fondo. */
  defaultNotch(widthM: number, depthM: number): Notch;
  /** Muesca más grande que admite la forma sin dejar paredes demasiado cortas. */
  maxNotch(widthM: number, depthM: number): Notch;
  /** Planta en el orden canónico, empezando por la pared del fondo. */
  outline(widthM: number, depthM: number, notch: Notch): Point2[];
}

const pt = (x: number, z: number): Point2 => ({ x, z });

const rect: RoomShapeTemplate = {
  id: 'rect',
  label: 'Rectangular',
  description: 'Cuatro paredes: la forma más común.',
  hasNotch: false,
  defaultNotch: () => ({ widthM: 0, depthM: 0 }),
  maxNotch: () => ({ widthM: 0, depthM: 0 }),
  outline: (w, d) => [pt(0, 0), pt(w, 0), pt(w, d), pt(0, d)],
};

/** L: al rectángulo le falta la esquina del frente a la derecha. */
const lShape: RoomShapeTemplate = {
  id: 'L',
  label: 'En L',
  description: 'Un rectángulo al que le falta una esquina: sala con comedor, cuarto con vestidor.',
  hasNotch: true,
  defaultNotch: (w, d) => ({ widthM: w * 0.4, depthM: d * 0.4 }),
  maxNotch: (w, d) => ({ widthM: w - MIN_WALL_M, depthM: d - MIN_WALL_M }),
  outline: (w, d, n) => [pt(0, 0), pt(w, 0), pt(w, d - n.depthM), pt(w - n.widthM, d - n.depthM), pt(w - n.widthM, d), pt(0, d)],
};

/** T: una franja ancha al fondo y un tramo más angosto, centrado, hacia el frente. */
const tShape: RoomShapeTemplate = {
  id: 'T',
  label: 'En T',
  description: 'Una franja ancha al fondo y un tramo centrado que sale hacia el frente.',
  hasNotch: true,
  // La muesca es la de cada lado del tramo central.
  defaultNotch: (w, d) => ({ widthM: w * 0.25, depthM: d * 0.45 }),
  maxNotch: (w, d) => ({ widthM: (w - MIN_WALL_M) / 2, depthM: d - MIN_WALL_M }),
  outline: (w, d, n) => [
    pt(0, 0),
    pt(w, 0),
    pt(w, d - n.depthM),
    pt(w - n.widthM, d - n.depthM),
    pt(w - n.widthM, d),
    pt(n.widthM, d),
    pt(n.widthM, d - n.depthM),
    pt(0, d - n.depthM),
  ],
};

/** U: dos alas hacia el frente con un hueco en medio. */
const uShape: RoomShapeTemplate = {
  id: 'U',
  label: 'En U',
  description: 'Dos alas hacia el frente con un hueco en medio.',
  hasNotch: true,
  defaultNotch: (w, d) => ({ widthM: w * 0.34, depthM: d * 0.45 }),
  maxNotch: (w, d) => ({ widthM: w - 2 * MIN_WALL_M, depthM: d - MIN_WALL_M }),
  outline: (w, d, n) => {
    const arm = (w - n.widthM) / 2;
    return [pt(0, 0), pt(w, 0), pt(w, d), pt(w - arm, d), pt(w - arm, d - n.depthM), pt(arm, d - n.depthM), pt(arm, d), pt(0, d)];
  },
};

export const ROOM_TEMPLATES: Readonly<Record<RoomShapeId, RoomShapeTemplate>> = { rect, L: lShape, T: tShape, U: uShape };

/** La muesca pedida, acotada a lo que la forma admite (ni más corta que una pared mínima ni más grande que el cuarto). */
export function resolveNotch(shape: RoomShapeId, params: RoomShapeParams): Notch {
  const template = ROOM_TEMPLATES[shape];
  if (!template.hasNotch) return { widthM: 0, depthM: 0 };
  const fallback = template.defaultNotch(params.widthM, params.depthM);
  const max = template.maxNotch(params.widthM, params.depthM);
  const fit = (wanted: number | undefined, def: number, hi: number) => Math.min(Math.max(MIN_WALL_M, hi), Math.max(MIN_WALL_M, wanted ?? def));
  return { widthM: fit(params.notchWidthM, fallback.widthM, max.widthM), depthM: fit(params.notchDepthM, fallback.depthM, max.depthM) };
}

/** Construye el cuarto de una plantilla, sin aberturas (se añaden después). */
export function buildRoomShape(shape: RoomShapeId, params: RoomShapeParams, opts: PolygonShellOptions = {}): RoomShell {
  const base =
    shape === 'rect'
      ? createRectangularShell(params.widthM, params.depthM, params.heightM, { ...opts, door: false, window: false })
      : createPolygonShell(ROOM_TEMPLATES[shape].outline(params.widthM, params.depthM, resolveNotch(shape, params)), params.heightM, opts);
  return { ...base, shape };
}
