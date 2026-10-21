/**
 * Texturas PBR reales (CC0, Poly Haven) que el seed baja al almacenamiento: color, normal y `arm`
 * (oclusión en R, rugosidad en G, metal en B, como las lee three.js). La API publica este manifiesto;
 * sin él (seed sin red), la web cae a las texturas que dibuja en canvas.
 */
import { z } from 'zod';
import { HexColorSchema } from './finish-spec.js';

/** Dónde deja el seed el manifiesto dentro del almacenamiento. */
export const TEXTURE_MANIFEST_KEY = 'textures/manifest.json';

export const TextureSetSchema = z.object({
  asset: z.string().min(1).max(64),
  /** Metros que cubre una repetición de la textura. */
  sizeM: z.number().positive().max(20),
  /** Color medio del mapa de color: con él se tiñe la textura al color exacto del material. */
  avgColor: HexColorSchema,
  maps: z.object({ albedo: z.string().min(1), normal: z.string().min(1), arm: z.string().min(1) }),
});
export type TextureSet = z.infer<typeof TextureSetSchema>;

export const TextureManifestSchema = z.object({
  sets: z.record(z.string(), TextureSetSchema),
  /** Material de acabado (piso, pared, techo) → juego de texturas. */
  surfaces: z.record(z.string(), z.string()),
  /** Material de mueble (madera, tela, cuero) → juego de texturas. */
  furniture: z.record(z.string(), z.string()),
  credits: z.string().max(400),
});
export type TextureManifest = z.infer<typeof TextureManifestSchema>;

/** Juego de texturas de Poly Haven y a qué materiales se aplica. */
export interface TextureSource {
  asset: string;
  surfaces?: readonly string[];
  furniture?: readonly string[];
}

/**
 * Elegidas a ojo sobre las miniaturas de Poly Haven: interiores limpios, sin suciedad. Se tiñen al
 * color de cada material, así una misma madera sirve para el roble y el fresno.
 */
export const TEXTURE_SOURCES: readonly TextureSource[] = [
  { asset: 'laminate_floor_02', surfaces: ['wood-oak', 'wood-ash-white'] },
  { asset: 'wood_floor', surfaces: ['wood-walnut', 'wood-teak'] },
  { asset: 'herringbone_parquet', surfaces: ['wood-herringbone'] },
  { asset: 'marble_01', surfaces: ['stone-marble-white', 'stone-travertine'] },
  { asset: 'smooth_concrete_floor', surfaces: ['stone-microcement'] },
  { asset: 'terrazzo_tiles', surfaces: ['stone-terrazzo'] },
  { asset: 'slate_floor_03', surfaces: ['stone-slate'] },
  { asset: 'interior_tiles', surfaces: ['ceramic-white'] },
  { asset: 'tiled_floor_001', surfaces: ['ceramic-grey-tile'] },
  { asset: 'terracotta_floor_tiles', surfaces: ['ceramic-terracotta'] },
  { asset: 'marble_mosaic_tiles', surfaces: ['ceramic-marble-mosaic'] },
  { asset: 'long_white_tiles', surfaces: ['ceramic-subway-white'] },
  { asset: 'rounded_square_tiled_wall', surfaces: ['ceramic-square-wall'] },
  { asset: 'brick_wall_001', surfaces: ['paint-brick', 'brick-white'] },
  { asset: 'poly_wool_herringbone', surfaces: ['carpet-grey', 'carpet-cream'], furniture: ['fabric-wool-grey'] },
  { asset: 'painted_plaster_wall', surfaces: ['@paint'] },
  { asset: 'oak_veneer_01', furniture: ['wood-oak', 'wood-ash-white', 'wood-teak'] },
  { asset: 'walnut_veneer', furniture: ['wood-walnut', 'wood-black'] },
  { asset: 'rough_linen', furniture: ['fabric-linen-sand', 'fabric-linen-white', 'fabric-terracotta', 'fabric-charcoal', 'fabric-mustard', 'fabric-boucle-cream'] },
  { asset: 'velour_velvet', furniture: ['fabric-velvet-green', 'fabric-velvet-blue'] },
  { asset: 'brown_leather', furniture: ['leather-cognac', 'leather-black'] },
];

/** `@paint` en `surfaces` = todas las pinturas (solo usan normal y rugosidad: el color queda liso). */
export const PAINT_TEXTURE_KEY = '@paint';

/** Juego de texturas para un acabado de piso, pared o techo; null = no hay (va la de canvas). */
export function surfaceTextureSet(manifest: TextureManifest | null, material: { id: string; kind: string }): TextureSet | null {
  if (!manifest) return null;
  const asset = manifest.surfaces[material.id] ?? (material.kind === 'paint' ? manifest.surfaces[PAINT_TEXTURE_KEY] : undefined);
  return asset ? (manifest.sets[asset] ?? null) : null;
}

export function furnitureTextureSet(manifest: TextureManifest | null, materialId: string): TextureSet | null {
  const asset = manifest?.furniture[materialId];
  return asset ? (manifest!.sets[asset] ?? null) : null;
}
