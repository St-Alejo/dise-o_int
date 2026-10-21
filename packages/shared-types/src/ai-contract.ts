/**
 * Contrato HTTP interno entre el worker (NestJS) y el servicio de IA (FastAPI).
 * El servicio Python replica estos modelos con Pydantic; `npm run schema` exporta el
 * JSON Schema a `generated/ai-contract.schema.json` y un test de Python lo verifica.
 */
import { z } from 'zod';
import {
  CatalogCategorySchema,
  FurniturePlacementSchema,
  MountSchema,
  RoomShellSchema,
  RoomTypeSchema,
  StyleIdSchema,
  Vector3Schema,
} from './domain.js';

export const AnalyzeRoomRequestSchema = z.object({
  photoKey: z.string().min(1),
  roomType: RoomTypeSchema,
});
export type AnalyzeRoomRequest = z.infer<typeof AnalyzeRoomRequestSchema>;

export const DetectedObjectSchema = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
  /** Caja normalizada [x0, y0, x1, y1] en 0–1 respecto a la imagen. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Lo que aporta un modelo de visión: qué es, cuántos hay y junto a qué pared (vista desde la cámara). */
  category: z.string().min(1).max(40).optional(),
  count: z.number().int().min(1).max(40).optional(),
  nearWall: z.enum(['back', 'left', 'right', 'front', 'center']).optional(),
});
export type DetectedObject = z.infer<typeof DetectedObjectSchema>;

const HexColor = z.string().regex(/^#[0-9a-f]{6}$/);

/** Lo que la foto sugiere además de la geometría: colores, estilo y tipo de cuarto. */
export const RoomSuggestionsSchema = z.object({
  roomType: z.string().max(40).optional(),
  styleId: StyleIdSchema.optional(),
  wallColor: HexColor.optional(),
  floorColor: HexColor.optional(),
  accentColor: HexColor.optional(),
  floorMaterial: z.enum(['wood', 'tile', 'carpet', 'concrete', 'other']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().max(300).optional(),
});
export type RoomSuggestions = z.infer<typeof RoomSuggestionsSchema>;

export const AnalyzeRoomResponseSchema = z.object({
  roomShell: RoomShellSchema,
  detectedObjects: z.array(DetectedObjectSchema),
  provider: z.string(),
  durationMs: z.number().nonnegative(),
  suggestions: RoomSuggestionsSchema.optional(),
});
export type AnalyzeRoomResponse = z.infer<typeof AnalyzeRoomResponseSchema>;

export const GenerateStyleRequestSchema = z.object({
  photoKey: z.string().min(1),
  outputKey: z.string().min(1),
  styleId: StyleIdSchema,
  roomType: RoomTypeSchema,
  promptStrength: z.number().min(0).max(1),
});
export type GenerateStyleRequest = z.infer<typeof GenerateStyleRequestSchema>;

export const GenerateStyleResponseSchema = z.object({
  imageKey: z.string(),
  provider: z.string(),
  durationMs: z.number().nonnegative(),
});
export type GenerateStyleResponse = z.infer<typeof GenerateStyleResponseSchema>;

export const LayoutCandidateSchema = z.object({
  id: z.string(),
  category: CatalogCategorySchema,
  subcategory: z.string().optional(),
  styleTags: z.array(StyleIdSchema),
  dimensionsM: Vector3Schema,
  mount: MountSchema,
  price: z.number().optional(),
});
export type LayoutCandidate = z.infer<typeof LayoutCandidateSchema>;

/** Un tipo de mueble visto en la foto (en palabras del modelo de visión) y cuántos hay. */
export const InventoryItemSchema = z.object({
  category: z.string().min(1).max(40),
  count: z.number().int().min(1).max(40).default(1),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const PlaceFurnitureRequestSchema = z.object({
  roomShell: RoomShellSchema,
  roomType: RoomTypeSchema,
  styleId: StyleIdSchema.nullable(),
  candidates: z.array(LayoutCandidateSchema),
  locked: z.array(FurniturePlacementSchema),
  seed: z.number().int().optional(),
  /** Lo que había en la foto: si viene, la distribución coloca eso en vez de la plantilla completa. */
  inventory: z.array(InventoryItemSchema).max(40).optional(),
  /** Subcategorías que la persona pidió (Brief): se colocan aunque la plantilla no las traiga. */
  mustHave: z.array(z.string().min(1).max(40)).max(20).optional(),
});
export type PlaceFurnitureRequest = z.infer<typeof PlaceFurnitureRequestSchema>;

export const PlaceFurnitureResponseSchema = z.object({
  placements: z.array(FurniturePlacementSchema),
  unplaced: z.array(z.string()),
  score: z.number(),
  engine: z.string(),
});
export type PlaceFurnitureResponse = z.infer<typeof PlaceFurnitureResponseSchema>;

// ---------- Modelo local del chat (intención + parámetros), sin IA externa ----------
export const NLU_INTENTS = [
  'set_floor',
  'set_walls',
  'set_wall_tiles',
  'set_ceiling',
  'add_item',
  'remove_item',
  'move_item',
  'set_lighting',
  'set_style',
  'recommend',
  'pin',
  'unpin',
  'add_zone',
  'avoid_item',
  'replicate_image',
  'room_size',
  'other',
] as const;
export const NluIntentSchema = z.enum(NLU_INTENTS);
export type NluIntent = z.infer<typeof NluIntentSchema>;

export const NluParseRequestSchema = z.object({ text: z.string().min(1).max(500) });
export type NluParseRequest = z.infer<typeof NluParseRequestSchema>;

const Hex = z.string().regex(/^#[0-9a-f]{6}$/);
const SpecKind = z.enum(['tile', 'wood', 'stone', 'paint', 'carpet', 'brick', 'concrete']);
const FloorKind = z.enum(['tile', 'wood', 'stone', 'carpet', 'concrete']);
const Pattern = z.enum(['plain', 'grid', 'checker', 'subway', 'herringbone', 'hex', 'mosaic', 'planks']);
const Mood = z.enum(['calida', 'neutra', 'fria']);
const Level = z.enum(['tenue', 'media', 'alta']);

export const NluSlotsSchema = z.object({
  colors: z.array(z.object({ name: z.string(), hex: Hex })).max(3),
  surface: z.enum(['floor', 'walls', 'ceiling', 'wallTiles']).optional(),
  finishKind: SpecKind.optional(),
  base: z.string().optional(),
  pattern: Pattern.optional(),
  gloss: z.number().min(0).max(1).optional(),
  tileSizeM: z.number().positive().optional(),
  heightM: z.number().positive().optional(),
  fullHeight: z.boolean(),
  subcategory: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  style: StyleIdSchema.optional(),
  mood: Mood.optional(),
  level: Level.optional(),
  zoneKind: z.enum(['bathroom', 'closet', 'vanity', 'office-nook']).optional(),
  preset: z.string().optional(),
  intensity: z.enum(['suave', 'total']).optional(),
  pinTarget: z.enum(['floor', 'walls', 'ceiling', 'wallTiles', 'style', 'lighting', 'palette']).optional(),
  widthM: z.number().positive().optional(),
  depthM: z.number().positive().optional(),
});
export type NluSlots = z.infer<typeof NluSlotsSchema>;

export const NluParseResponseSchema = z.object({
  intent: NluIntentSchema,
  confidence: z.number().min(0).max(1),
  alternatives: z.array(z.object({ intent: NluIntentSchema, confidence: z.number().min(0).max(1) })),
  slots: NluSlotsSchema,
  model: z.string(),
});
export type NluParseResponse = z.infer<typeof NluParseResponseSchema>;

// ---------- Ranking de propuestas con el modelo de preferencias ----------
export const RankRecommendationsRequestSchema = z.object({
  candidates: z
    .array(z.object({ id: z.string().min(1).max(64), features: z.record(z.string(), z.number()), prior: z.number() }))
    .min(1)
    .max(20),
  history: z.array(z.object({ features: z.record(z.string(), z.number()), action: z.enum(['shown', 'like', 'dislike', 'kept', 'undone']) })).max(500),
});
export type RankRecommendationsRequest = z.infer<typeof RankRecommendationsRequestSchema>;

export const RankRecommendationsResponseSchema = z.object({
  scores: z.record(z.string(), z.number()),
  model: z.enum(['prior', 'logreg']),
  samples: z.number().int().nonnegative(),
});
export type RankRecommendationsResponse = z.infer<typeof RankRecommendationsResponseSchema>;

// ---------- Imagen de referencia ("hazlo como esta foto") ----------
export const AnalyzeReferenceRequestSchema = z.object({ imageKey: z.string().min(1).max(512) });
export type AnalyzeReferenceRequest = z.infer<typeof AnalyzeReferenceRequestSchema>;

export const AnalyzeReferenceResponseSchema = z.object({
  style: StyleIdSchema.optional(),
  palette: z.array(Hex).max(5),
  floor: z.object({ kind: FloorKind, pattern: Pattern, colors: z.array(Hex).min(1).max(3), gloss: z.number().min(0).max(1) }).optional(),
  wallColor: Hex.optional(),
  objects: z.array(z.string()).max(8),
  mood: Mood.optional(),
  level: Level.optional(),
  /** vision = lo leyó el modelo multimodal; colors = respaldo local por colores dominantes. */
  source: z.enum(['vision', 'colors']),
});
export type AnalyzeReferenceResponse = z.infer<typeof AnalyzeReferenceResponseSchema>;

export const AI_CONTRACT_SCHEMAS = {
  AnalyzeRoomRequest: AnalyzeRoomRequestSchema,
  AnalyzeRoomResponse: AnalyzeRoomResponseSchema,
  GenerateStyleRequest: GenerateStyleRequestSchema,
  GenerateStyleResponse: GenerateStyleResponseSchema,
  PlaceFurnitureRequest: PlaceFurnitureRequestSchema,
  PlaceFurnitureResponse: PlaceFurnitureResponseSchema,
  NluParseRequest: NluParseRequestSchema,
  NluParseResponse: NluParseResponseSchema,
  RankRecommendationsRequest: RankRecommendationsRequestSchema,
  RankRecommendationsResponse: RankRecommendationsResponseSchema,
  AnalyzeReferenceRequest: AnalyzeReferenceRequestSchema,
  AnalyzeReferenceResponse: AnalyzeReferenceResponseSchema,
} as const;
