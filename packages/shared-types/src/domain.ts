/**
 * Modelo de datos canónico (sección 7 del documento de arquitectura).
 *
 * Cada interfaz tiene un schema zod "hermano": los tipos TS se infieren del schema,
 * así la validación en runtime (API, web) y el tipado estático nunca divergen.
 * Unidades: metros y radianes. Sistema de coordenadas: Y hacia arriba, piso en y = 0,
 * el cuarto ocupa x ∈ [0, widthM], z ∈ [0, depthM].
 */
import { z } from 'zod';
import { CustomFinishIdSchema, FinishSpecSchema, HexColorSchema } from './finish-spec.js';

const finite = z.number().finite();
const positiveMeters = finite.positive().max(100);

export const Vector3Schema = z.object({ x: finite, y: finite, z: finite });
export type Vector3 = z.infer<typeof Vector3Schema>;

export const ROOM_TYPES = ['living', 'bedroom', 'dining', 'office', 'kitchen', 'bathroom'] as const;
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

/** Forma de la planta. `free` = paredes dibujadas a mano. Sin valor = rectangular (proyectos anteriores). */
export const ROOM_SHAPES = ['rect', 'L', 'T', 'U', 'free'] as const;
export const RoomShapeSchema = z.enum(ROOM_SHAPES);
export type RoomShape = z.infer<typeof RoomShapeSchema>;

export const Point2Schema = z.object({ x: finite, z: finite });

/**
 * Zona dentro del cuarto: un baño privado, un vestidor o el rincón del tocador. Su planta es un
 * polígono dentro del cuarto; los lados que no caen sobre una pared del cuarto son tabiques nuevos
 * (salvo en una zona `open`, que solo delimita el área para distribuir y pintar).
 */
export const ZONE_KINDS = ['bathroom', 'closet', 'vanity', 'office-nook'] as const;
export const ZoneKindSchema = z.enum(ZONE_KINDS);
export type ZoneKind = z.infer<typeof ZoneKindSchema>;

export const ZoneDoorSchema = z.object({
  /** Lado del contorno (de `outline[edge]` a `outline[edge + 1]`) donde va la puerta: debe ser un tabique. */
  edge: z.number().int().min(0).max(15),
  /** Distancia desde el inicio del lado hasta el centro de la puerta. */
  offsetM: finite.min(0).max(100),
  widthM: finite.min(0.5).max(2),
});
export type ZoneDoor = z.infer<typeof ZoneDoorSchema>;

export const ZoneSchema = z.object({
  id: z.string().min(1).max(64),
  kind: ZoneKindSchema,
  name: z.string().trim().min(1).max(60).optional(),
  outline: z.array(Point2Schema).min(3).max(16),
  open: z.boolean().default(false),
  door: ZoneDoorSchema.optional(),
});
export type Zone = z.infer<typeof ZoneSchema>;
export type ZoneInput = z.input<typeof ZoneSchema>;

export const RoomShellSchema = z.object({
  id: z.string().min(1).max(64),
  /** Caja que envuelve al cuarto; la planta real son las paredes, en orden y cerrando. */
  widthM: positiveMeters,
  depthM: positiveMeters,
  heightM: positiveMeters,
  shape: RoomShapeSchema.optional(),
  walls: z.array(WallSegmentSchema).min(3).max(64),
  openings: z.array(OpeningSchema).max(64),
  scaleConfidence: finite.min(0).max(1),
  needsCalibration: z.boolean(),
  /** Zonas interiores (baño privado...). Sin valor = el cuarto es un solo espacio. */
  zones: z.array(ZoneSchema).max(4).optional(),
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
  'kitchen',
  'bathroom',
  'wall-decor',
  'textile',
  'electronics',
] as const;
export const CatalogCategorySchema = z.enum(CATALOG_CATEGORIES);
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

/**
 * Dónde se apoya el objeto: el motor de layout y el editor lo usan para calcular `position.y`.
 * - `floor` / `ceiling`: piso o techo.
 * - `wall`: colgado de una pared (cuadros, repisas, TV) a `elevationM` del piso.
 * - `surface`: apoyado sobre otro mueble (lámpara de mesa, jarrón), referenciado por `supportId`.
 */
export const MOUNTS = ['floor', 'ceiling', 'wall', 'surface'] as const;
export const MountSchema = z.enum(MOUNTS);
export type Mount = z.infer<typeof MountSchema>;

/** Familias de material: un slot de un mueble solo acepta ciertas familias (una tela no puede ser vidrio). */
export const MATERIAL_KINDS = [
  'fabric',
  'leather',
  'wood',
  'metal',
  'stone',
  'ceramic',
  'glass',
  'paint',
  'plastic',
  'plant',
] as const;
export const MaterialKindSchema = z.enum(MATERIAL_KINDS);
export type MaterialKind = z.infer<typeof MaterialKindSchema>;

const MaterialIdSchema = z.string().min(1).max(64);
const SlotIdSchema = z.string().min(1).max(32);

/** Rango [mín, máx] en metros que el usuario puede dar a una dimensión del mueble. */
export const SizeRangeSchema = z
  .tuple([positiveMeters, positiveMeters])
  .refine(([min, max]) => min <= max, 'El mínimo no puede superar al máximo');
export type SizeRange = z.infer<typeof SizeRangeSchema>;

export const ResizeRangesSchema = z.object({
  x: SizeRangeSchema.optional(),
  y: SizeRangeSchema.optional(),
  z: SizeRangeSchema.optional(),
});
export type ResizeRanges = z.infer<typeof ResizeRangesSchema>;

/** Parte del mueble que se puede re-materializar (tapizado, patas, cubierta...). */
export const MaterialSlotSchema = z.object({
  slot: SlotIdSchema,
  label: z.string().min(1).max(60),
  default: MaterialIdSchema,
  allowedKinds: z.array(MaterialKindSchema).min(1),
});
export type MaterialSlot = z.infer<typeof MaterialSlotSchema>;

/** Receta paramétrica: el cliente reconstruye la geometría con estas medidas y parámetros. */
export const RecipeSchema = z.object({
  kind: z.string().min(1).max(40),
  params: z.record(z.string().max(40), z.union([finite, z.string().max(60), z.boolean()])).default({}),
});
export type Recipe = z.infer<typeof RecipeSchema>;

/** Metadatos de personalización del ítem (en la base de datos viven en una sola columna JSON). */
export const CatalogSpecSchema = z.object({
  recipe: RecipeSchema.optional(),
  materialSlots: z.array(MaterialSlotSchema).max(8).optional(),
  resize: ResizeRangesSchema.optional(),
  /** Altura por defecto de la base del objeto cuando va en la pared. */
  elevationDefaultM: finite.min(0).max(10).optional(),
  /** Puede meterse debajo de un mueble que lo permite (sillas bajo la mesa). */
  tucksUnder: z.boolean().optional(),
  /** Permite que otros (`tucksUnder`) entren debajo (mesas, escritorios). */
  allowsUnder: z.boolean().optional(),
});
export type CatalogSpec = z.infer<typeof CatalogSpecSchema>;

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
  /** Palabras clave para la búsqueda (es/en): "lámpara", "lamp", "luz"... */
  tags: z.array(z.string().min(1).max(40)).max(40).default([]),
  synonyms: z.array(z.string().min(1).max(40)).max(40).default([]),
  description: z.string().max(400).optional(),
  /** Origen del modelo: GLB de Poly Haven, receta paramétrica o caja procedural de respaldo. */
  source: z.enum(['polyhaven', 'parametric', 'procedural']).optional(),
}).extend(CatalogSpecSchema.shape);
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

/** Quién puso el mueble en la escena (la UI lo distingue; el layout automático respeta los del usuario). */
export const PlacementOriginSchema = z.enum(['user', 'layout', 'detected', 'chat']);
export type PlacementOrigin = z.infer<typeof PlacementOriginSchema>;

export const DimensionsSchema = z.object({ x: positiveMeters, y: positiveMeters, z: positiveMeters });
export type Dimensions = z.infer<typeof DimensionsSchema>;

export const FurniturePlacementSchema = z.object({
  id: z.string().min(1).max(64),
  catalogItemId: z.string().min(1).max(64),
  position: Vector3Schema,
  rotationY: finite,
  lockedByUser: z.boolean(),
  // --- v3: todo opcional para que los proyectos guardados antes sigan siendo válidos ---
  /** Medidas propias de esta pieza (si faltan, se usan las del catálogo). */
  dimensionsM: DimensionsSchema.optional(),
  /** Material elegido por slot: { tapizado: 'fabric-linen-sand', patas: 'wood-oak' }. */
  materials: z.record(SlotIdSchema, MaterialIdSchema).optional(),
  /** Altura de la base sobre el piso (objetos de pared). */
  elevationM: finite.min(0).max(10).optional(),
  /** Pared a la que está colgado (mount = wall). */
  wallId: z.string().min(1).max(64).optional(),
  /** Mueble sobre el que se apoya (mount = surface). */
  supportId: z.string().min(1).max(64).optional(),
  origin: PlacementOriginSchema.optional(),
});
export type FurniturePlacement = z.infer<typeof FurniturePlacementSchema>;

/** Revestimiento de pared desde el piso (baldosa de baño, salpicadero de cocina, zócalo alto). */
export const WallTilesSchema = z.object({
  material: MaterialIdSchema,
  heightM: finite.min(0.1).max(10),
  /** Paredes revestidas; sin valor = todas. */
  walls: z.array(z.string().min(1).max(64)).max(64).optional(),
});
export type WallTiles = z.infer<typeof WallTilesSchema>;

/** Ambiente de luz que se guarda con el diseño (la hora del día sigue siendo solo de la vista). */
export const LIGHT_MOODS = ['calida', 'neutra', 'fria'] as const;
export const LIGHT_LEVELS = ['tenue', 'media', 'alta'] as const;
export const LightingSchema = z.object({
  mood: z.enum(LIGHT_MOODS),
  level: z.enum(LIGHT_LEVELS),
});
export type Lighting = z.infer<typeof LightingSchema>;

/** Acabados de una zona interior: su piso y, opcionalmente, pared y revestimiento propios. */
export const ZoneFinishesSchema = z.object({
  floor: MaterialIdSchema,
  walls: MaterialIdSchema.optional(),
  wallTiles: WallTilesSchema.omit({ walls: true }).optional(),
});
export type ZoneFinishes = z.infer<typeof ZoneFinishesSchema>;

/**
 * Acabados del cuarto: material del piso, de cada pared (o 'all') y del techo. Los ids pueden ser
 * de la biblioteca o `custom-…`, definidos en `custom` (acabados descritos por la persona).
 */
export const RoomFinishesSchema = z.object({
  floor: MaterialIdSchema,
  walls: z.record(z.string().min(1).max(64), MaterialIdSchema),
  ceiling: MaterialIdSchema,
  custom: z.record(CustomFinishIdSchema, FinishSpecSchema).optional(),
  wallTiles: WallTilesSchema.optional(),
  zones: z.record(z.string().min(1).max(64), ZoneFinishesSchema).optional(),
  lighting: LightingSchema.optional(),
});
export type RoomFinishes = z.infer<typeof RoomFinishesSchema>;
export type RoomFinishesInput = z.input<typeof RoomFinishesSchema>;

/**
 * Brief de diseño: lo que la persona pidió y quiere conservar. "Recomendar" y el chat lo respetan:
 * lo `locked` no cambia entre propuestas; lo demás es una preferencia que orienta.
 */
export const FinishPinSchema = z
  .object({
    material: MaterialIdSchema.optional(),
    spec: FinishSpecSchema.optional(),
    locked: z.boolean().default(true),
  })
  .refine((p) => Boolean(p.material) !== Boolean(p.spec), 'Un acabado fijado lleva material o descripción, no ambos');
export type FinishPin = z.infer<typeof FinishPinSchema>;

export const BriefItemSchema = z.object({
  /** Subcategoría del catálogo: 'dressing-table', 'rug', 'floor-lamp'... */
  subcategory: z.string().min(1).max(40),
  zoneKind: ZoneKindSchema.optional(),
  note: z.string().trim().max(120).optional(),
});
export type BriefItem = z.infer<typeof BriefItemSchema>;

export const ZoneBriefSchema = z.object({
  kind: ZoneKindSchema,
  /** Preset de la zona: 'ducha-obra', 'banera-mampara', 'spa-marmol', 'industrial'... */
  preset: z.string().min(1).max(40).optional(),
  floor: FinishPinSchema.optional(),
  wallTiles: FinishPinSchema.optional(),
});
export type ZoneBrief = z.infer<typeof ZoneBriefSchema>;

export const DesignBriefSchema = z.object({
  style: z.object({ id: StyleIdSchema, locked: z.boolean().default(true) }).optional(),
  surfaces: z
    .object({
      floor: FinishPinSchema.optional(),
      walls: FinishPinSchema.optional(),
      ceiling: FinishPinSchema.optional(),
      wallTiles: FinishPinSchema.optional(),
    })
    .default({}),
  palette: z.object({ colors: z.array(HexColorSchema).min(1).max(5), locked: z.boolean().default(false) }).optional(),
  lighting: LightingSchema.extend({ locked: z.boolean().default(true) }).optional(),
  mustHave: z.array(BriefItemSchema).max(20).default([]),
  /** Subcategorías que no quiere ver. */
  avoid: z.array(z.string().min(1).max(40)).max(20).default([]),
  zones: z.array(ZoneBriefSchema).max(4).default([]),
});
export type DesignBrief = z.infer<typeof DesignBriefSchema>;
export type DesignBriefInput = z.input<typeof DesignBriefSchema>;

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
  finishes: RoomFinishesSchema.nullable().default(null),
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
  /** null = acabados por defecto (o la paleta del estilo elegido). */
  finishes: RoomFinishesSchema.nullable().default(null),
  versions: z.array(DesignProjectVersionSummarySchema),
  visibility: z.enum(['private', 'shared-link']),
  /** Guardado explícito: los proyectos no guardados se borran a las 24 h (privacidad, §8.4). */
  saved: z.boolean(),
  /** Control de concurrencia optimista: el cliente la reenvía al guardar. */
  revision: z.number().int().nonnegative(),
  /** Vivienda a la que pertenece este cuarto, con todos los cuartos que la forman (este incluido). */
  home: z
    .object({
      id: z.string(),
      name: z.string(),
      rooms: z.array(z.object({ id: z.string(), name: z.string(), roomType: RoomTypeSchema })),
    })
    .nullable()
    .optional(),
  /** Tope de gasto que se puso la persona para este cuarto (null o ausente = sin tope). */
  budgetCap: z.number().positive().nullable().optional(),
  /** Lo que pidió y quiere conservar (null o ausente = nada fijado). */
  brief: DesignBriefSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DesignProject = z.infer<typeof DesignProjectSchema>;
