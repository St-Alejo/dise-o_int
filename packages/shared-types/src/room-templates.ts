/**
 * Plantillas de forma del cuarto: rectángulo, L, T y U. Cada una sabe dibujar su planta a partir
 * de las medidas totales y del tamaño de su muesca; el cuarto se construye siempre igual
 * (`buildRoomShape`). Añadir una forma es añadir una plantilla al registro.
 */
import { z } from 'zod';
import { OpeningSchema, type Opening, type RoomShell } from './domain.js';
import {
  createPolygonShell,
  createRectangularShell,
  MIN_WALL_M,
  ROOM_LIMITS,
  validateRoomShell,
  wallLength,
  type PolygonShellOptions,
} from './geometry.js';
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

/**
 * Lo que el usuario decide al crear un cuarto a mano: forma, medidas y, si quiere, dónde van
 * puertas y ventanas (`wallId` son los ids que produce la plantilla). Es el contrato del asistente
 * de "nuevo proyecto"; con él no hace falta foto.
 */
export const RoomSpecSchema = z.object({
  shape: z.enum(ROOM_SHAPE_IDS),
  widthM: z.number().min(ROOM_LIMITS.minSideM).max(ROOM_LIMITS.maxSideM),
  depthM: z.number().min(ROOM_LIMITS.minSideM).max(ROOM_LIMITS.maxSideM),
  heightM: z.number().min(ROOM_LIMITS.minHeightM).max(ROOM_LIMITS.maxHeightM),
  notchWidthM: z.number().positive().max(ROOM_LIMITS.maxSideM).optional(),
  notchDepthM: z.number().positive().max(ROOM_LIMITS.maxSideM).optional(),
  /** Si falta, el cuarto nace con una ventana al fondo y una puerta al frente. */
  openings: z.array(OpeningSchema).max(24).optional(),
});
export type RoomSpec = z.infer<typeof RoomSpecSchema>;

/** Una ventana centrada en la pared del fondo y una puerta hacia un extremo de la del frente. */
export function defaultOpenings(shell: RoomShell): Opening[] {
  const length = (id: string) => {
    const wall = shell.walls.find((w) => w.id === id);
    return wall ? wallLength(wall) : 0;
  };
  const openings: Opening[] = [];
  const back = length('w-back');
  if (back >= 1.2) {
    openings.push({
      id: 'o-window-1',
      type: 'window',
      wallId: 'w-back',
      widthM: round2(Math.min(1.6, back * 0.4)),
      heightM: round2(Math.min(1.3, shell.heightM * 0.5)),
      offsetM: round2(back / 2),
      sillHeightM: round2(Math.min(0.9, shell.heightM * 0.35)),
    });
  }
  const front = length('w-front');
  if (front >= 1.1) {
    const widthM = round2(Math.min(0.9, front * 0.5));
    openings.push({
      id: 'o-door-1',
      type: 'door',
      wallId: 'w-front',
      widthM,
      heightM: round2(Math.min(2.05, shell.heightM * 0.85)),
      // Hacia el extremo de la pared, sin pegarse a la esquina.
      offsetM: round2(Math.max(widthM / 2 + 0.15, Math.min(front * 0.8, front - widthM / 2 - 0.15))),
      sillHeightM: 0,
    });
  }
  return openings;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * El cuarto que describe un `RoomSpec`, ya validado: medidas exactas (no necesita calibración),
 * sus aberturas (o las de por defecto) y `hasWindow` al día. Lanza `RoomGeometryError` si las
 * aberturas no caben o apuntan a una pared que la forma no tiene.
 */
export function buildRoomFromSpec(spec: RoomSpec, id = 'room'): RoomShell {
  const bare = buildRoomShape(spec.shape, spec, { id, scaleConfidence: 1, needsCalibration: false });
  const openings = spec.openings ?? defaultOpenings(bare);
  const shell: RoomShell = {
    ...bare,
    openings,
    walls: bare.walls.map((w) => ({ ...w, hasWindow: openings.some((o) => o.wallId === w.id && o.type === 'window') })),
  };
  validateRoomShell(shell);
  return shell;
}
