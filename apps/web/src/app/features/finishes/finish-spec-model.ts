/**
 * Acabado a medida desde la interfaz: qué tipos van en cada superficie, cómo queda el acabado
 * dentro de los del cuarto y qué acabados propios ya no usa nadie. Puro: se prueba sin navegador.
 */
import {
  FINISH_SPEC_KINDS,
  FinishSpecSchema,
  SPEC_SURFACES,
  customFinishId,
  type FinishSpec,
  type FinishSpecInput,
  type RoomFinishes,
} from '@interiores/shared-types';
import type { WallTarget } from './finishes-model';

export type SpecSurface = 'floor' | 'walls' | 'ceiling' | 'wallTiles';
type SpecKind = FinishSpec['kind'];

export const KIND_LABELS: Record<SpecKind, string> = {
  tile: 'Baldosa',
  wood: 'Madera',
  stone: 'Piedra',
  paint: 'Pintura',
  carpet: 'Moqueta',
  brick: 'Ladrillo',
  concrete: 'Cemento',
};

export const PATTERN_LABELS: Record<FinishSpec['pattern'], string> = {
  plain: 'Liso',
  grid: 'Cuadrícula',
  checker: 'Damero',
  subway: 'Metro',
  herringbone: 'Espiga',
  hex: 'Hexagonal',
  mosaic: 'Mosaico',
  planks: 'Tablones',
};

export const SURFACE_LABELS: Record<SpecSurface, string> = { floor: 'Piso', walls: 'Paredes', ceiling: 'Techo', wallTiles: 'Revestimiento' };

/** Los tipos que admite la superficie (el revestimiento es de baldosa o piedra). */
export function kindsFor(surface: SpecSurface): SpecKind[] {
  if (surface === 'wallTiles') return ['tile', 'stone'];
  const where = surface === 'walls' ? 'wall' : surface;
  return FINISH_SPEC_KINDS.filter((k) => SPEC_SURFACES[k].includes(where));
}

/** El acabado validado (null si algo no cumple el esquema: colores, tamaño...). */
export function buildSpec(input: FinishSpecInput): FinishSpec | null {
  const parsed = FinishSpecSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Nombre por defecto: "Baldosa brillante en espiga". */
export function defaultName(kind: SpecKind, pattern: FinishSpec['pattern'], gloss: number): string {
  const finish = gloss >= 0.7 ? ' brillante' : gloss <= 0.15 ? ' mate' : '';
  const drawing = pattern === 'plain' ? '' : ` ${PATTERN_LABELS[pattern].toLowerCase()}`;
  return `${KIND_LABELS[kind]}${finish}${drawing}`;
}

/**
 * Los acabados del cuarto con el acabado a medida en esa superficie. El revestimiento va hasta
 * `heightM` (acotado al alto del cuarto); las paredes, a todas o a una.
 */
export function applySpec(current: RoomFinishes, surface: SpecSurface, spec: FinishSpec, opts: { wall?: WallTarget; heightM?: number; roomHeightM?: number } = {}): RoomFinishes {
  const id = customFinishId(spec);
  const next: RoomFinishes = { ...structuredClone(current), custom: { ...current.custom, [id]: spec } };
  if (surface === 'floor') next.floor = id;
  else if (surface === 'ceiling') next.ceiling = id;
  else if (surface === 'walls') next.walls = !opts.wall || opts.wall === 'all' ? { all: id } : { ...next.walls, [opts.wall]: id };
  else next.wallTiles = { ...(next.wallTiles ?? {}), material: id, heightM: Math.min(opts.heightM ?? 1.2, opts.roomHeightM ?? Infinity) };
  return pruneCustom(next);
}

/** Los acabados propios que ninguna superficie usa ya no se guardan. */
export function pruneCustom(f: RoomFinishes): RoomFinishes {
  if (!f.custom) return f;
  const used = new Set([f.floor, f.ceiling, ...Object.values(f.walls), f.wallTiles?.material, ...Object.values(f.zones ?? {}).flatMap((z) => [z.floor, z.walls, z.wallTiles?.material])]);
  const custom = Object.fromEntries(Object.entries(f.custom).filter(([id]) => used.has(id)));
  const next = { ...f };
  if (Object.keys(custom).length) next.custom = custom;
  else delete next.custom;
  return next;
}
