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
});
export type DetectedObject = z.infer<typeof DetectedObjectSchema>;

export const AnalyzeRoomResponseSchema = z.object({
  roomShell: RoomShellSchema,
  detectedObjects: z.array(DetectedObjectSchema),
  provider: z.string(),
  durationMs: z.number().nonnegative(),
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

export const PlaceFurnitureRequestSchema = z.object({
  roomShell: RoomShellSchema,
  roomType: RoomTypeSchema,
  styleId: StyleIdSchema.nullable(),
  candidates: z.array(LayoutCandidateSchema),
  locked: z.array(FurniturePlacementSchema),
  seed: z.number().int().optional(),
});
export type PlaceFurnitureRequest = z.infer<typeof PlaceFurnitureRequestSchema>;

export const PlaceFurnitureResponseSchema = z.object({
  placements: z.array(FurniturePlacementSchema),
  unplaced: z.array(z.string()),
  score: z.number(),
  engine: z.string(),
});
export type PlaceFurnitureResponse = z.infer<typeof PlaceFurnitureResponseSchema>;

export const AI_CONTRACT_SCHEMAS = {
  AnalyzeRoomRequest: AnalyzeRoomRequestSchema,
  AnalyzeRoomResponse: AnalyzeRoomResponseSchema,
  GenerateStyleRequest: GenerateStyleRequestSchema,
  GenerateStyleResponse: GenerateStyleResponseSchema,
  PlaceFurnitureRequest: PlaceFurnitureRequestSchema,
  PlaceFurnitureResponse: PlaceFurnitureResponseSchema,
} as const;
