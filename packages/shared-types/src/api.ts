/** DTOs de la API pública (REST). La API valida con estos schemas y la web los usa como tipos. */
import { z } from 'zod';
import {
  CatalogCategorySchema,
  CatalogItemSchema,
  DesignProjectSchema,
  FurniturePlacementSchema,
  MountSchema,
  OpeningSchema,
  ProjectStatusSchema,
  RoomFinishesSchema,
  RoomShellSchema,
  RoomTypeSchema,
  StyleIdSchema,
} from './domain.js';
import { RoomSpecSchema } from './room-templates.js';

// ---------- Medidas del cuarto ----------
// (límites duplicados de geometry.ts:ROOM_LIMITS para no crear un ciclo de imports)
const side = z.number().min(0.8, 'Mínimo 0.8 m').max(30, 'Máximo 30 m');
const height = z.number().min(2, 'Mínimo 2 m').max(6, 'Máximo 6 m');

export const RoomDimensionsSchema = z.object({ widthM: side, depthM: side, heightM: height });
export type RoomDimensionsInput = z.infer<typeof RoomDimensionsSchema>;

/**
 * En multipart todo llega como texto: "" o ausente = no indicado. Acepta coma decimal.
 * También acepta un número ya convertido: el pipe del controlador y el caso de uso aplican el
 * schema en serie, así que debe ser idempotente.
 */
const optionalNumberField = (schema: z.ZodNumber) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (typeof v !== 'string' ? v : v.trim() === '' ? undefined : Number(v.replace(',', '.'))))
    .pipe(schema.optional());

// ---------- Auth ----------
export const RegisterRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(128),
  displayName: z.string().trim().min(1).max(80),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  /** Segundos hasta que expira el access token. */
  expiresIn: z.number().int().positive(),
  user: AuthUserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ---------- Proyectos ----------
/** Campos de texto del multipart `POST /projects` (la foto va en el campo `photo`). */
export const CreateProjectFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120).default('Mi cuarto'),
  roomType: RoomTypeSchema.default('living'),
  /** Lista separada por comas (o ya convertida en lista); si falta se usan los estilos por defecto. */
  styles: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (Array.isArray(v)) return v;
      return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    })
    .pipe(z.array(StyleIdSchema).min(1).max(4).optional()),
  /** Medidas reales opcionales: si se indican las tres, mandan sobre la estimación de la foto. */
  widthM: optionalNumberField(side),
  depthM: optionalNumberField(side),
  heightM: optionalNumberField(height),
  /**
   * Cuarto definido a mano (forma, medidas y aberturas), como JSON. Con él la foto es opcional y
   * manda sobre lo que se estime de ella.
   */
  roomSpec: z
    .union([z.string(), RoomSpecSchema])
    .optional()
    .transform((v, ctx) => {
      if (typeof v !== 'string') return v;
      if (v.trim() === '') return undefined;
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'roomSpec no es JSON válido' });
        return z.NEVER;
      }
    })
    .pipe(RoomSpecSchema.optional()),
}).refine(
  (f) => [f.widthM, f.depthM, f.heightM].every((v) => v === undefined) || [f.widthM, f.depthM, f.heightM].every((v) => v !== undefined),
  { message: 'Indica ancho, largo y alto juntos (o ninguno)', path: ['widthM'] },
);
export type CreateProjectFields = z.input<typeof CreateProjectFieldsSchema>;

export const ProjectListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  roomType: RoomTypeSchema,
  status: ProjectStatusSchema,
  thumbnailUrl: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  saved: z.boolean(),
  updatedAt: z.string(),
});
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

/**
 * `revision` es opcional en las operaciones que tocan el proyecto fuera del editor: si el
 * cliente la envía, el servidor rechaza con 409 cuando el proyecto cambió desde que lo leyó.
 */
const OptionalRevision = z.number().int().nonnegative().optional();

export const UpdateProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  revision: OptionalRevision,
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

export const UpdateSceneRequestSchema = z.object({
  revision: z.number().int().nonnegative(),
  furniturePlacements: z.array(FurniturePlacementSchema).max(200),
  selectedStyleId: StyleIdSchema.nullable().optional(),
  /** undefined = no tocar; null = volver a los acabados por defecto. */
  finishes: RoomFinishesSchema.nullable().optional(),
  /** Planta editada a mano en el plano (mover paredes, esquinas o aberturas). Sin valor = no tocar. */
  roomShell: RoomShellSchema.optional(),
});
export type UpdateSceneRequest = z.infer<typeof UpdateSceneRequestSchema>;

/** `PUT /projects/:id/room`: medidas exactas del cuarto y, opcionalmente, sus puertas y ventanas. */
export const UpdateRoomRequestSchema = RoomDimensionsSchema.extend({
  revision: z.number().int().nonnegative(),
  openings: z.array(OpeningSchema).max(16).optional(),
});
export type UpdateRoomRequest = z.infer<typeof UpdateRoomRequestSchema>;

export const SaveVersionRequestSchema = z.object({
  note: z.string().trim().max(200).optional(),
});
export type SaveVersionRequest = z.infer<typeof SaveVersionRequestSchema>;

// El cuerpo es opcional (un POST sin body sigue funcionando).
export const RestoreVersionRequestSchema = z.object({ revision: OptionalRevision }).default({});
export type RestoreVersionRequest = z.infer<typeof RestoreVersionRequestSchema>;

export const CALIBRATION_REFERENCES = [
  'door-height',
  'ceiling-height',
  'room-width',
  'room-depth',
] as const;
export const CalibrationReferenceSchema = z.enum(CALIBRATION_REFERENCES);
export type CalibrationReference = z.infer<typeof CalibrationReferenceSchema>;

export const CalibrateRequestSchema = z.object({
  revision: z.number().int().nonnegative(),
  reference: CalibrationReferenceSchema,
  valueM: z.number().min(0.3).max(30),
});
export type CalibrateRequest = z.infer<typeof CalibrateRequestSchema>;

export const GenerateStylesRequestSchema = z.object({
  styles: z
    .array(StyleIdSchema)
    .min(1)
    .max(4)
    .refine((s) => new Set(s).size === s.length, 'Estilos repetidos'),
  promptStrength: z.number().min(0.2).max(0.95),
});
export type GenerateStylesRequest = z.infer<typeof GenerateStylesRequestSchema>;

export const SelectStyleRequestSchema = z.object({
  styleId: StyleIdSchema.nullable(),
  revision: OptionalRevision,
});
export type SelectStyleRequest = z.infer<typeof SelectStyleRequestSchema>;

export const AutoLayoutRequestSchema = z.object({
  styleId: StyleIdSchema.nullable().optional(),
  /** Si es true (por defecto) los muebles movidos a mano no se re-optimizan. */
  keepLocked: z.boolean().default(true),
  /** Variante de la distribución: cada valor da otra igual de válida. Sin él, la mejor de siempre. */
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});
export type AutoLayoutRequest = z.input<typeof AutoLayoutRequestSchema>;

export const JobAcceptedSchema = z.object({ jobId: z.string(), projectId: z.string() });
export type JobAccepted = z.infer<typeof JobAcceptedSchema>;

export const ShareLinkSchema = z.object({ token: z.string(), path: z.string() });
export type ShareLink = z.infer<typeof ShareLinkSchema>;

export const PublicProjectSchema = DesignProjectSchema.omit({
  ownerId: true,
  versions: true,
  saved: true,
  lastError: true,
});
export type PublicProject = z.infer<typeof PublicProjectSchema>;

// ---------- Lista de compras ----------
export const ShoppingListLineSchema = z.object({
  catalogItemId: z.string(),
  name: z.string(),
  category: CatalogCategorySchema,
  /** Medidas o materiales propios ("210 × 95 × 84 cm · Tapizado: Cuero coñac"); null = como el catálogo. */
  variant: z.string().nullable().default(null),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nullable(),
  subtotal: z.number().nullable(),
  currency: z.string(),
  productUrl: z.string().nullable(),
  license: z.string(),
  attribution: z.string().nullable(),
});
export type ShoppingListLine = z.infer<typeof ShoppingListLineSchema>;

export const ShoppingListSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  lines: z.array(ShoppingListLineSchema),
  total: z.number(),
  currency: z.string(),
});
export type ShoppingList = z.infer<typeof ShoppingListSchema>;

// ---------- Catálogo ----------
export const CatalogQuerySchema = z.object({
  category: CatalogCategorySchema.optional(),
  style: StyleIdSchema.optional(),
  roomType: RoomTypeSchema.optional(),
  q: z.string().trim().max(60).optional(),
  mount: MountSchema.optional(),
  /** Solo muebles que quepan en este ancho (m). */
  maxWidthM: z.coerce.number().positive().max(30).optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  /** Paginación (solo `GET /catalog/search`). */
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(20).optional(),
});
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;
export type CatalogQueryInput = z.input<typeof CatalogQuerySchema>;

export const CatalogSearchResponseSchema = z.object({
  items: z.array(CatalogItemSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type CatalogSearchResponse = z.infer<typeof CatalogSearchResponseSchema>;

// ---------- Errores (RFC 7807) ----------
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  code: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
