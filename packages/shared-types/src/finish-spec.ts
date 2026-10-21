/**
 * Acabados paramétricos: lo que la persona describe con palabras ("baldosa brillante azul claro
 * con verde") y no existe tal cual en la biblioteca. Se guardan dentro de los acabados del cuarto
 * (`RoomFinishes.custom`) con un id `custom-…`, así el resto del sistema sigue manejando solo ids.
 *
 * Sin dependencias de dominio: `domain.ts` lo importa para validar los acabados.
 */
import { z } from 'zod';

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #rrggbb');
export type HexColor = z.infer<typeof HexColorSchema>;

/** Familia del acabado: decide la textura base y en qué superficies se puede poner. */
export const FINISH_SPEC_KINDS = ['tile', 'wood', 'stone', 'paint', 'carpet', 'brick', 'concrete'] as const;
export const FinishSpecKindSchema = z.enum(FINISH_SPEC_KINDS);
export type FinishSpecKind = z.infer<typeof FinishSpecKindSchema>;

/** Dibujo de las piezas. `mosaic` reparte los colores al azar pieza por pieza. */
export const FINISH_PATTERNS = ['plain', 'grid', 'checker', 'subway', 'herringbone', 'hex', 'mosaic', 'planks'] as const;
export const FinishPatternSchema = z.enum(FINISH_PATTERNS);
export type FinishPattern = z.infer<typeof FinishPatternSchema>;

export const FinishSpecSchema = z.object({
  /** Nombre para la interfaz: "Baldosa brillante azul y verde". */
  name: z.string().trim().min(1).max(60),
  kind: FinishSpecKindSchema,
  /** Material de la biblioteca cuya textura sirve de base (vetas, poros); sin él, la de su familia. */
  base: z.string().min(1).max(64).optional(),
  /** Uno a tres colores; con varios, el dibujo decide cómo se reparten. */
  colors: z.array(HexColorSchema).min(1).max(3),
  pattern: FinishPatternSchema.default('plain'),
  /** Lado de cada pieza (baldosa, tablón) en metros. */
  tileSizeM: z.number().finite().min(0.02).max(2).optional(),
  /** 0 = mate, 1 = espejo. */
  gloss: z.number().finite().min(0).max(1).default(0.3),
  groutColor: HexColorSchema.optional(),
});
export type FinishSpec = z.infer<typeof FinishSpecSchema>;
export type FinishSpecInput = z.input<typeof FinishSpecSchema>;

export const CUSTOM_FINISH_PREFIX = 'custom-';
export const CustomFinishIdSchema = z.string().regex(/^custom-[a-z0-9-]{1,40}$/, 'Id de acabado propio inválido');

export function isCustomFinishId(id: string): boolean {
  return id.startsWith(CUSTOM_FINISH_PREFIX);
}

type Surface = 'floor' | 'wall' | 'ceiling';

/** En qué superficies tiene sentido cada familia (una alfombra no va en el techo). */
export const SPEC_SURFACES: Record<FinishSpecKind, readonly Surface[]> = {
  tile: ['floor', 'wall'],
  wood: ['floor', 'wall', 'ceiling'],
  stone: ['floor', 'wall'],
  paint: ['wall', 'ceiling'],
  carpet: ['floor'],
  brick: ['wall'],
  concrete: ['floor', 'wall', 'ceiling'],
};

/** Id estable para un acabado propio: el mismo texto da el mismo id (no se duplica al repetirlo). */
export function customFinishId(spec: FinishSpecInput): string {
  const key = JSON.stringify([spec.kind, spec.colors, spec.pattern ?? 'plain', spec.tileSizeM ?? null, spec.gloss ?? 0.3, spec.groutColor ?? null, spec.base ?? null]);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${CUSTOM_FINISH_PREFIX}${spec.kind}-${(h >>> 0).toString(36)}`;
}
