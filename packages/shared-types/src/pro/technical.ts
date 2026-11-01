/**
 * Ficha técnica del proyecto (Modo Pro): lo que un arquitecto o diseñador necesita para pasar del
 * diseño a la obra y que la escena no sabe. Grosor de los muros, datos del cajetín, escala y papel
 * de las láminas, perfil normativo con que se revisa, tarifas de obra y puntos de instalaciones.
 *
 * Todo tiene valor por defecto: un proyecto sin ficha (`technical = null`) se comporta como si
 * tuviera `defaultTechnicalSpec()`. Unidades: metros; dinero en la moneda de `rates.currency`.
 */
import { z } from 'zod';

const finite = z.number().finite();
const Point2 = z.object({ x: finite, z: finite });
const id = z.string().min(1).max(64);

/** Grosor razonable de un muro o tabique: de una placa de yeso a un muro de carga. */
export const WallThicknessSchema = finite.min(0.05).max(0.6);

export const WallSpecSchema = z.object({
  /** Muros del contorno del cuarto. */
  exteriorM: WallThicknessSchema,
  /** Tabiques de las zonas interiores (baño privado, vestidor...). */
  partitionM: WallThicknessSchema,
  /** Grosor propio de una pared concreta (`wallId → m`), por encima del general. */
  overrides: z.record(id, WallThicknessSchema),
});
export type WallSpec = z.infer<typeof WallSpecSchema>;

export const TitleBlockSchema = z.object({
  project: z.string().trim().max(80).optional(),
  client: z.string().trim().max(80).optional(),
  address: z.string().trim().max(120).optional(),
  professional: z.string().trim().max(80).optional(),
  /** Matrícula o tarjeta profesional. */
  license: z.string().trim().max(40).optional(),
  /** Letra o número de la revisión de los planos. */
  revision: z.string().trim().min(1).max(8),
  /** Fecha que figura en las láminas (AAAA-MM-DD); sin valor, la del día en que se exporta. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type TitleBlock = z.infer<typeof TitleBlockSchema>;

export const PAPER_SIZES = ['A4', 'A3', 'A2', 'A1'] as const;
export const PaperSizeSchema = z.enum(PAPER_SIZES);
export type PaperSize = z.infer<typeof PaperSizeSchema>;

/** Escalas habituales de planos de interiores (1:N). */
export const DRAWING_SCALES = [20, 25, 50, 75, 100] as const;
export const DrawingScaleSchema = z.literal(DRAWING_SCALES);
export type DrawingScale = (typeof DRAWING_SCALES)[number];

export const SheetSpecSchema = z.object({
  paper: PaperSizeSchema,
  scale: DrawingScaleSchema,
});
export type SheetSpec = z.infer<typeof SheetSpecSchema>;

/** Corte A–A': una línea que el profesional traza sobre la planta, mirando hacia su izquierda. */
export const SectionLineSchema = z.object({ a: Point2, b: Point2 });
export type SectionLine = z.infer<typeof SectionLineSchema>;

export const COMPLIANCE_PROFILES = ['neufert', 'colombia'] as const;
export const ComplianceProfileIdSchema = z.enum(COMPLIANCE_PROFILES);
export type ComplianceProfileId = z.infer<typeof ComplianceProfileIdSchema>;

export const ComplianceSpecSchema = z.object({
  profile: ComplianceProfileIdSchema,
  /** El cuarto debe poder usarlo una persona en silla de ruedas (activa las reglas de accesibilidad). */
  accessible: z.boolean(),
});
export type ComplianceSpec = z.infer<typeof ComplianceSpecSchema>;

/** Precio de una actividad de obra por su unidad: material y mano de obra por separado (APU). */
export const UnitRateSchema = z.object({
  material: finite.min(0).max(1e9),
  labor: finite.min(0).max(1e9),
});
export type UnitRate = z.infer<typeof UnitRateSchema>;

export const RatesSpecSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Administración, imprevistos y utilidad, como fracción del costo directo. */
  aiu: z.object({
    administration: finite.min(0).max(1),
    contingency: finite.min(0).max(1),
    profit: finite.min(0).max(1),
  }),
  /** Tarifas propias del proyecto (`código de actividad → precio`), por encima de la lista base. */
  overrides: z.record(z.string().min(1).max(40), UnitRateSchema),
});
export type RatesSpec = z.infer<typeof RatesSpecSchema>;

// ---------- Instalaciones ----------

export const ELECTRICAL_KINDS = [
  'outlet',
  'outlet-gfci',
  'switch',
  'switch-double',
  'switch-3way',
  'light',
  'tv-data',
] as const;
export const PLUMBING_KINDS = ['cold-water', 'hot-water', 'drain', 'floor-drain'] as const;
export const INSTALLATION_KINDS = [...ELECTRICAL_KINDS, ...PLUMBING_KINDS] as const;
export const InstallationKindSchema = z.enum(INSTALLATION_KINDS);
export type InstallationKind = z.infer<typeof InstallationKindSchema>;
export type ElectricalKind = (typeof ELECTRICAL_KINDS)[number];
export type PlumbingKind = (typeof PLUMBING_KINDS)[number];

export const isElectrical = (kind: InstallationKind): kind is ElectricalKind =>
  (ELECTRICAL_KINDS as readonly string[]).includes(kind);

/**
 * Un punto de instalación. Va en una pared (`wallId` + `offsetM` desde `wall.start`, a `heightM`
 * del piso) o, si es una salida de luz o una rejilla de piso, en un punto de la planta (`at`).
 */
export const InstallationPointSchema = z
  .object({
    id,
    kind: InstallationKindSchema,
    wallId: id.optional(),
    offsetM: finite.min(0).max(100).optional(),
    at: Point2.optional(),
    heightM: finite.min(0).max(10),
    circuitId: id.optional(),
    /** Interruptores: las salidas de luz que encienden. */
    controls: z.array(id).max(12).optional(),
    /** Potencia prevista en vatios (tomas y luces); sin valor, la típica de su tipo. */
    watts: finite.min(0).max(10000).optional(),
    /** Si lo propuso la app (se puede regenerar) o lo puso la persona (se respeta). */
    auto: z.boolean().optional(),
  })
  .refine((p) => (p.wallId !== undefined && p.offsetM !== undefined) || p.at !== undefined, {
    message: 'Un punto va en una pared (wallId y offsetM) o en un punto de la planta (at)',
  });
export type InstallationPoint = z.infer<typeof InstallationPointSchema>;

export const CircuitSchema = z.object({
  id,
  name: z.string().trim().min(1).max(40),
  /** Amperios del interruptor automático. */
  breakerA: z.literal([15, 20, 30, 40]),
  kind: z.enum(['lighting', 'outlets', 'wet', 'dedicated']),
});
export type Circuit = z.infer<typeof CircuitSchema>;

export const InstallationsSpecSchema = z.object({
  /** Tensión de servicio en voltios (120 en Colombia). */
  voltage: finite.min(100).max(400),
  points: z.array(InstallationPointSchema).max(300),
  circuits: z.array(CircuitSchema).max(40),
});
export type InstallationsSpec = z.infer<typeof InstallationsSpecSchema>;

// ---------- Ficha completa ----------

export function defaultTechnicalSpec(): TechnicalSpec {
  return {
    walls: { exteriorM: 0.15, partitionM: 0.08, overrides: {} },
    titleBlock: { revision: 'A' },
    sheet: { paper: 'A3', scale: 50 },
    compliance: { profile: 'neufert', accessible: false },
    rates: { currency: 'COP', aiu: { administration: 0.1, contingency: 0.05, profit: 0.05 }, overrides: {} },
    installations: { voltage: 120, points: [], circuits: [] },
  };
}

const defaults = defaultTechnicalSpec();

/** Cada bloque es opcional al recibirlo: lo que falta toma el valor por defecto. */
export const TechnicalSpecSchema = z.object({
  walls: WallSpecSchema.partial().transform((w) => ({ ...defaults.walls, ...w })),
  titleBlock: TitleBlockSchema.partial().transform((t) => ({ ...defaults.titleBlock, ...t })),
  sheet: SheetSpecSchema.partial().transform((s) => ({ ...defaults.sheet, ...s })),
  section: SectionLineSchema.optional(),
  compliance: ComplianceSpecSchema.partial().transform((c) => ({ ...defaults.compliance, ...c })),
  rates: RatesSpecSchema.partial().transform((r) => ({ ...defaults.rates, ...r })),
  installations: InstallationsSpecSchema.partial().transform((i) => ({ ...defaults.installations, ...i })),
}).partial().transform((spec) => ({
  walls: spec.walls ?? defaults.walls,
  titleBlock: spec.titleBlock ?? defaults.titleBlock,
  sheet: spec.sheet ?? defaults.sheet,
  ...(spec.section ? { section: spec.section } : {}),
  compliance: spec.compliance ?? defaults.compliance,
  rates: spec.rates ?? defaults.rates,
  installations: spec.installations ?? defaults.installations,
}));

export interface TechnicalSpec {
  walls: WallSpec;
  titleBlock: TitleBlock;
  sheet: SheetSpec;
  section?: SectionLine;
  compliance: ComplianceSpec;
  rates: RatesSpec;
  installations: InstallationsSpec;
}
export type TechnicalSpecInput = z.input<typeof TechnicalSpecSchema>;

/** La ficha de un proyecto, con los valores por defecto si aún no tiene (o le faltan bloques). */
export function technicalOf(value: TechnicalSpecInput | TechnicalSpec | null | undefined): TechnicalSpec {
  return value ? TechnicalSpecSchema.parse(value) : defaultTechnicalSpec();
}

/** Grosor con que se dibuja una pared del contorno. */
export function wallThickness(spec: Pick<TechnicalSpec, 'walls'>, wallId: string): number {
  return spec.walls.overrides[wallId] ?? spec.walls.exteriorM;
}
