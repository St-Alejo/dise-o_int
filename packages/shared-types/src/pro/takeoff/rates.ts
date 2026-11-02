/**
 * Lista base de actividades de obra con su análisis de precio unitario (APU: material y mano de
 * obra por unidad, en COP de referencia), su rendimiento por día de una cuadrilla y la fase de obra
 * en que van. Cada proyecto puede cambiar el precio de cualquier actividad en su ficha técnica.
 */
import type { MaterialDefinition } from '../../materials.js';
import type { RatesSpec, UnitRate } from '../technical.js';
import type { TakeoffSurface } from './quantities.js';

export const WORK_PHASES = ['installations', 'partitions', 'plaster', 'floors', 'tiling', 'paint', 'carpentry', 'furniture'] as const;
export type WorkPhase = (typeof WORK_PHASES)[number];

export const PHASE_LABELS: Record<WorkPhase, string> = {
  installations: 'Instalaciones',
  partitions: 'Tabiques',
  plaster: 'Estuco',
  floors: 'Pisos',
  tiling: 'Enchapes',
  paint: 'Pintura',
  carpentry: 'Carpintería',
  furniture: 'Mobiliario',
};

export type WorkUnit = 'm²' | 'ml' | 'und';

export interface Activity {
  code: string;
  name: string;
  unit: WorkUnit;
  /** Precio unitario de referencia (COP). */
  rate: UnitRate;
  /** Unidades por día de una cuadrilla. */
  yieldPerDay: number;
  phase: WorkPhase;
}

const a = (code: string, name: string, unit: WorkUnit, material: number, labor: number, yieldPerDay: number, phase: WorkPhase): Activity => ({ code, name, unit, rate: { material, labor }, yieldPerDay, phase });

/** Precios de referencia en pesos colombianos (2026, vivienda, Bogotá). Orientativos. */
export const BASE_ACTIVITIES: Readonly<Record<string, Activity>> = Object.fromEntries(
  [
    a('elec-point', 'Punto eléctrico (salida, toma o interruptor)', 'und', 65_000, 45_000, 8, 'installations'),
    a('plumb-point', 'Punto hidrosanitario', 'und', 90_000, 70_000, 4, 'installations'),
    a('partition-drywall', 'Tabique en drywall, dos caras', 'm²', 48_000, 26_000, 12, 'partitions'),
    a('skim-coat', 'Estuco y masilla sobre muro o cielo raso', 'm²', 6_500, 7_500, 25, 'plaster'),
    a('tile-floor', 'Piso en cerámica o porcelanato', 'm²', 58_000, 30_000, 12, 'floors'),
    a('wood-floor', 'Piso de madera o laminado', 'm²', 95_000, 22_000, 20, 'floors'),
    a('stone-floor', 'Piso en piedra natural', 'm²', 140_000, 42_000, 8, 'floors'),
    a('microcement', 'Microcemento', 'm²', 85_000, 45_000, 10, 'floors'),
    a('carpet', 'Moqueta de pared a pared', 'm²', 60_000, 12_000, 30, 'floors'),
    a('skirting', 'Guardaescoba', 'ml', 12_000, 6_000, 40, 'floors'),
    a('tile-wall', 'Enchape de muros', 'm²', 52_000, 32_000, 10, 'tiling'),
    a('wall-panel', 'Revestimiento de muro en madera', 'm²', 120_000, 35_000, 10, 'tiling'),
    a('paint', 'Pintura vinilo tipo 1, dos manos', 'm²', 6_500, 6_000, 40, 'paint'),
    a('ceiling-paint', 'Pintura de cielo raso, dos manos', 'm²', 6_500, 7_500, 30, 'paint'),
    a('door', 'Puerta entamborada con marco y chapa', 'und', 450_000, 120_000, 2, 'carpentry'),
    a('furniture-install', 'Armado e instalación del mobiliario', 'und', 0, 25_000, 12, 'furniture'),
  ].map((x) => [x.code, x]),
);

/** La actividad con el precio que manda: el de la ficha del proyecto o el de la lista base. */
export function activityWithRate(code: string, rates: Pick<RatesSpec, 'overrides'>): Activity {
  const base = BASE_ACTIVITIES[code];
  if (!base) throw new Error(`Actividad desconocida: ${code}`);
  const own = rates.overrides[code];
  return own ? { ...base, rate: own } : base;
}

/** Qué actividad instala un material en una superficie. */
export function activityFor(surface: TakeoffSurface, material: MaterialDefinition): string {
  const concrete = material.spec?.kind === 'concrete' || material.id.includes('microcement');
  if (surface === 'floor') {
    if (concrete) return 'microcement';
    switch (material.kind) {
      case 'wood':
        return 'wood-floor';
      case 'stone':
        return 'stone-floor';
      case 'fabric':
        return 'carpet';
      default:
        return 'tile-floor';
    }
  }
  if (surface === 'ceiling') return 'ceiling-paint';
  switch (material.kind) {
    case 'ceramic':
    case 'stone':
      return concrete ? 'paint' : 'tile-wall';
    case 'wood':
      return 'wall-panel';
    default:
      return 'paint';
  }
}

// ---------------------------------------------------------------------------
// Desperdicio (patrón Strategy): cada forma de colocar pierde distinto en cortes.
// ---------------------------------------------------------------------------

export interface WasteStrategy {
  /** Fracción de desperdicio (0,10 = 10 %) de un material colocado en una superficie. */
  wasteFor(material: MaterialDefinition, surface: TakeoffSurface): number;
}

/** Desperdicio según el dibujo: recto 10 %, espiga 15 %, hexagonal 12 %; la pintura no se corta. */
export const PATTERN_WASTE: WasteStrategy = {
  wasteFor(material) {
    if (material.kind === 'paint' || material.spec?.kind === 'concrete' || material.id.includes('microcement')) return 0;
    const pattern = material.spec?.pattern ?? (material.id.includes('herringbone') ? 'herringbone' : material.id.includes('mosaic') ? 'mosaic' : 'grid');
    if (pattern === 'herringbone') return 0.15;
    if (pattern === 'hex') return 0.12;
    if (material.kind === 'fabric') return 0.08;
    if (material.kind === 'stone') return 0.12;
    return 0.1;
  },
};

/** Presentación en que se vende un material: tamaño y nombre del empaque. */
export interface PackSpec {
  /** Cantidad (en la unidad de la línea) que trae cada empaque. */
  size: number;
  singular: string;
  plural: string;
  /** "de 1,44 m²", "de 25 kg"... */
  detail?: string;
}

/** Lo que se compra para un acabado: cantidad, unidad de compra y presentación. */
export interface PurchaseLine {
  name: string;
  quantity: number;
  unit: string;
  pack: PackSpec;
  /** "12 cajas de 1,44 m²", "3 galones"... */
  packs: string;
}

const ceil = (v: number) => Math.ceil(v - 1e-9);
const fmt = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',');

/** "1 galón", "3 galones", "2 cajas de 1,44 m²". */
export function packsLabel(quantity: number, pack: PackSpec): string {
  const n = Math.max(1, ceil(quantity / pack.size));
  return `${n} ${n === 1 ? pack.singular : pack.plural}${pack.detail ? ` ${pack.detail}` : ''}`;
}

const line = (name: string, quantity: number, unit: string, pack: PackSpec): PurchaseLine => ({ name, quantity, unit, pack, packs: packsLabel(quantity, pack) });

/** Une las compras del mismo material y presentación (la pintura de muros y techo, el pegante de piso y muro). */
export function mergePurchases(lines: readonly PurchaseLine[]): PurchaseLine[] {
  const out = new Map<string, PurchaseLine>();
  for (const l of lines) {
    const key = `${l.name}|${l.unit}|${l.pack.size}|${l.pack.singular}`;
    const prev = out.get(key);
    out.set(key, prev ? line(l.name, prev.quantity + l.quantity, l.unit, l.pack) : l);
  }
  return [...out.values()];
}

/** m² por caja según el tipo de pieza. */
function boxM2(material: MaterialDefinition): number {
  if (material.kind === 'wood') return 2.2;
  if (material.kind === 'stone') return 1;
  const side = material.spec?.tileSizeM;
  return side && side > 0 ? Math.max(0.5, Math.min(2, Math.round(side * side * Math.max(1, Math.floor(1.44 / (side * side))) * 100) / 100)) : 1.44;
}

const box = (m2: number): PackSpec => ({ size: m2, singular: 'caja', plural: 'cajas', detail: `de ${fmt(m2)} m²` });

/** Materiales a comprar para una superficie ya medida (con desperdicio). Rendimientos de obra típicos. */
export function purchasesFor(code: string, material: MaterialDefinition, areaM2: number, waste: number): PurchaseLine[] {
  const gross = areaM2 * (1 + waste);
  switch (code) {
    case 'tile-floor':
    case 'tile-wall':
    case 'stone-floor':
      return [
        line(material.name, gross, 'm²', box(boxM2(material))),
        line('Pegante cerámico', areaM2 * 5, 'kg', { size: 25, singular: 'bulto', plural: 'bultos', detail: 'de 25 kg' }),
        line('Boquilla', areaM2 * 0.4, 'kg', { size: 2, singular: 'bolsa', plural: 'bolsas', detail: 'de 2 kg' }),
      ];
    case 'wood-floor':
      return [line(material.name, gross, 'm²', box(boxM2(material))), line('Espuma niveladora', areaM2 * 1.05, 'm²', { size: 20, singular: 'rollo', plural: 'rollos', detail: 'de 20 m²' })];
    case 'carpet':
      return [line(material.name, gross, 'm²', { size: 4, singular: 'metro lineal', plural: 'metros lineales', detail: 'de rollo de 4 m' })];
    case 'microcement':
      return [line(material.name, areaM2 * 1.8, 'kg', { size: 20, singular: 'kit', plural: 'kits', detail: 'de 20 kg' })];
    case 'wall-panel':
      return [line(material.name, gross, 'm²', { size: 2.9, singular: 'panel', plural: 'paneles', detail: 'de 2,9 m²' })];
    case 'paint':
    case 'ceiling-paint':
      // Dos manos a 10 m² por litro.
      return [line(`Pintura ${material.name}`, (areaM2 * 2) / 10, 'L', { size: 3.785, singular: 'galón', plural: 'galones' })];
    default:
      return [];
  }
}
