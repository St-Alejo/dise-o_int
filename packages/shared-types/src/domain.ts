/**
 * Modelo de datos canónico (sección 7 del documento de arquitectura).
 *
 * Cada interfaz tiene un schema zod "hermano": los tipos TS se infieren del schema,
 * así la validación en runtime (API, web) y el tipado estático nunca divergen.
 * Unidades: metros y radianes. Sistema de coordenadas: Y hacia arriba, piso en y = 0,
 * el cuarto ocupa x ∈ [0, widthM], z ∈ [0, depthM].
 */
import { z } from 'zod';

const finite = z.number().finite();
const positiveMeters = finite.positive().max(100);

export const Vector3Schema = z.object({ x: finite, y: finite, z: finite });
export type Vector3 = z.infer<typeof Vector3Schema>;

export const ROOM_TYPES = ['living', 'bedroom', 'dining', 'office'] as const;
export const RoomTypeSchema = z.enum(ROOM_TYPES);
export type RoomType = z.infer<typeof RoomTypeSchema>;

export const STYLE_IDS = [
  'escandinavo',
  'minimalista',
  'industrial',
  'bohemio',
  'moderno',
  'clasico',
] as const;
export const StyleIdSchema = z.enum(STYLE_IDS);
export type StyleId = z.infer<typeof StyleIdSchema>;

export const WallSegmentSchema = z.object({
  id: z.string().min(1).max(64),
  start: Vector3Schema,
  end: Vector3Schema,
  hasWindow: z.boolean(),
});
export type WallSegment = z.infer<typeof WallSegmentSchema>;

export const OpeningSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['door', 'window']),
  wallId: z.string().min(1).max(64),
  widthM: positiveMeters,
  heightM: positiveMeters,
  /** Distancia desde `wall.start` hasta el centro de la abertura (extensión necesaria para dibujarla). */
  offsetM: finite.min(0).max(100),
  /** Altura del alféizar; 0 para puertas. */
  sillHeightM: finite.min(0).max(10).default(0),
});
export type Opening = z.infer<typeof OpeningSchema>;

export const RoomShellSchema = z.object({
  id: z.string().min(1).max(64),
  widthM: positiveMeters,
  depthM: positiveMeters,
  heightM: positiveMeters,
  walls: z.array(WallSegmentSchema).min(3).max(64),
  openings: z.array(OpeningSchema).max(64),
  scaleConfidence: finite.min(0).max(1),
  needsCalibration: z.boolean(),
});
export type RoomShell = z.infer<typeof RoomShellSchema>;

export const CATALOG_CATEGORIES = [
  'sofa',
  'table',
  'chair',
  'bed',
  'storage',
  'lighting',
  'decor',
] as const;
export const CatalogCategorySchema = z.enum(CATALOG_CATEGORIES);
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

/** Dónde se apoya el objeto: el motor de layout y el editor lo usan para calcular `position.y`. */
export const MountSchema = z.enum(['floor', 'ceiling']);
export type Mount = z.infer<typeof MountSchema>;

export const CatalogItemSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  category: CatalogCategorySchema,
  /** Subtipo funcional: 'coffee-table', 'dining-table', 'desk', 'nightstand', 'rug', ... */
  subcategory: z.string().max(40).optional(),
  styleTags: z.array(StyleIdSchema),
  roomTypes: z.array(RoomTypeSchema),
  /** x = ancho, y = alto, z = profundidad (metros reales). */
  dimensionsM: Vector3Schema,
  mount: MountSchema.default('floor'),
  modelUrl: z.string().min(1),
  thumbnailUrl: z.string().optional(),
  price: finite.nonnegative().optional(),
  currency: z.string().length(3).default('USD'),
  productUrl: z.string().url().optional(),
  license: z.enum(['cc0', 'cc-by', 'proprietary', 'affiliate']),
  attribution: z.string().max(200).optional(),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const FurniturePlacementSchema = z.object({
  id: z.string().min(1).max(64),
  catalogItemId: z.string().min(1).max(64),
  position: Vector3Schema,
  rotationY: finite,
  lockedByUser: z.boolean(),
});
export type FurniturePlacement = z.infer<typeof FurniturePlacementSchema>;

export const StylePreviewStatusSchema = z.enum(['pending', 'ready', 'failed']);
export const StylePreviewSchema = z.object({
  id: z.string(),
  styleName: StyleIdSchema,
  imageUrl: z.string().nullable(),
  promptStrength: finite.min(0).max(1),
  status: StylePreviewStatusSchema,
  provider: z.string().optional(),
  createdAt: z.string(),
});
export type StylePreview = z.infer<typeof StylePreviewSchema>;

export const ProjectStatusSchema = z.enum(['uploaded', 'processing', 'ready', 'failed']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const DesignProjectVersionSummarySchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  note: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type DesignProjectVersionSummary = z.infer<typeof DesignProjectVersionSummarySchema>;

export const DesignProjectVersionSchema = DesignProjectVersionSummarySchema.extend({
  roomShell: RoomShellSchema.nullable(),
  furniturePlacements: z.array(FurniturePlacementSchema),
  selectedStyleId: StyleIdSchema.nullable(),
});
export type DesignProjectVersion = z.infer<typeof DesignProjectVersionSchema>;

export const DesignProjectSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  roomType: RoomTypeSchema,
  status: ProjectStatusSchema,
  lastError: z.string().nullable(),
  sourcePhotoUrl: z.string().nullable(),
  roomShell: RoomShellSchema.nullable(),
  stylePreviews: z.array(StylePreviewSchema),
  selectedStyleId: StyleIdSchema.nullable(),
  furniturePlacements: z.array(FurniturePlacementSchema),
  versions: z.array(DesignProjectVersionSummarySchema),
  visibility: z.enum(['private', 'shared-link']),
  /** Guardado explícito: los proyectos no guardados se borran a las 24 h (privacidad, §8.4). */
  saved: z.boolean(),
  /** Control de concurrencia optimista: el cliente la reenvía al guardar. */
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DesignProject = z.infer<typeof DesignProjectSchema>;
