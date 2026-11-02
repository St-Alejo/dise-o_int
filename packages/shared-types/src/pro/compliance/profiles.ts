/**
 * Perfiles normativos: los números contra los que se revisa un cuarto. Cada perfil es un juego de
 * valores, no un conjunto de reglas distinto: las mismas reglas (`rules.ts`) leen el perfil elegido
 * en la ficha técnica. Todo es orientativo y lo dice así el informe.
 */
import type { RoomType } from '../../domain.js';
import type { ComplianceProfileId } from '../technical.js';

/** Holgura libre que necesita delante un tipo de mueble o aparato. */
export interface FrontClearance {
  /** Mínimo libre delante (m). */
  minM: number;
  /** Con accesibilidad (m). */
  accessibleM: number;
  label: string;
}

export interface ComplianceProfile {
  id: ComplianceProfileId;
  name: string;
  /** Fuentes que se citan en cada hallazgo. */
  references: {
    circulation: string;
    accessibility: string;
    habitability: string;
    ergonomics: string;
    lighting: string;
    electrical: string;
  };
  /** Paso libre en la circulación principal (m) y el mínimo tolerable entre muebles. */
  clearPathM: number;
  minPassM: number;
  /** Paso libre con accesibilidad (silla de ruedas). */
  accessiblePathM: number;
  /** Vano mínimo de puerta (m), y con accesibilidad. */
  doorWidthM: number;
  accessibleDoorWidthM: number;
  /** Círculo de giro de una silla de ruedas. */
  turningDiameterM: number;
  /** Altura libre mínima de piso a cielo raso. */
  minCeilingM: number;
  /** Área de ventana / área de piso (iluminación natural). */
  naturalLightRatio: number;
  /** Área practicable / área de piso (ventilación natural). */
  ventilationRatio: number;
  /** Factor de luz diurna medio que se espera, en %, por tipo de cuarto (0 = no se exige). */
  daylightFactor: Record<RoomType, number>;
  /** Iluminancia media en el plano de trabajo (lux) por tipo de cuarto. */
  targetLux: Record<RoomType, number>;
  /** Uniformidad mínima (Emín / Emedia). */
  uniformity: number;
  /** Holguras delante de cada tipo de pieza, por subcategoría (o categoría si no tiene). */
  clearances: Record<string, FrontClearance>;
  /** Alturas de superficie de trabajo (m), por subcategoría. */
  heights: Record<string, { min: number; max: number; label: string }>;
  /** Triángulo de trabajo de la cocina: perímetro y cada lado (m). */
  kitchenTriangle: { minPerimeterM: number; maxPerimeterM: number; minLegM: number; maxLegM: number };
}

const CLEARANCES: Record<string, FrontClearance> = {
  toilet: { minM: 0.6, accessibleM: 1.2, label: 'el inodoro' },
  bidet: { minM: 0.6, accessibleM: 1.2, label: 'el bidé' },
  vanity: { minM: 0.7, accessibleM: 1.2, label: 'el lavamanos' },
  shower: { minM: 0.7, accessibleM: 1.2, label: 'la ducha' },
  bathtub: { minM: 0.7, accessibleM: 1.2, label: 'la tina' },
  'kitchen-base': { minM: 0.9, accessibleM: 1.5, label: 'el mesón' },
  sink: { minM: 0.9, accessibleM: 1.5, label: 'el lavaplatos' },
  stove: { minM: 0.9, accessibleM: 1.5, label: 'la estufa' },
  fridge: { minM: 0.9, accessibleM: 1.5, label: 'la nevera' },
  wardrobe: { minM: 0.9, accessibleM: 1.2, label: 'el clóset' },
  dresser: { minM: 0.75, accessibleM: 1.2, label: 'la cómoda' },
  desk: { minM: 0.9, accessibleM: 1.2, label: 'el escritorio' },
  'dressing-table': { minM: 0.75, accessibleM: 1.2, label: 'el tocador' },
  bed: { minM: 0.6, accessibleM: 0.9, label: 'la cama' },
};

const HEIGHTS: ComplianceProfile['heights'] = {
  'kitchen-base': { min: 0.85, max: 0.95, label: 'Mesón de cocina' },
  sink: { min: 0.85, max: 0.95, label: 'Lavaplatos' },
  stove: { min: 0.85, max: 0.95, label: 'Estufa' },
  desk: { min: 0.7, max: 0.78, label: 'Escritorio' },
  'dining-table': { min: 0.72, max: 0.78, label: 'Mesa de comedor' },
  vanity: { min: 0.8, max: 0.9, label: 'Lavamanos' },
};

const NEUFERT: ComplianceProfile = {
  id: 'neufert',
  name: 'Buenas prácticas (Neufert)',
  references: {
    circulation: 'Neufert, Arte de proyectar en arquitectura: circulaciones',
    accessibility: 'Neufert / ISO 21542: espacio para silla de ruedas',
    habitability: 'Neufert: altura libre e iluminación natural',
    ergonomics: 'Neufert / Panero y Zelnik: dimensiones humanas',
    lighting: 'EN 12464-1 y CIE: iluminancia y uniformidad',
    electrical: 'NTC 2050 / NEC 210-52 y 210-8 (buenas prácticas)',
  },
  clearPathM: 0.9,
  minPassM: 0.6,
  accessiblePathM: 1.2,
  doorWidthM: 0.8,
  accessibleDoorWidthM: 0.9,
  turningDiameterM: 1.5,
  minCeilingM: 2.4,
  naturalLightRatio: 1 / 8,
  ventilationRatio: 1 / 16,
  daylightFactor: { living: 1.5, bedroom: 1, dining: 1.5, office: 2, kitchen: 2, bathroom: 0 },
  targetLux: { living: 200, bedroom: 150, dining: 200, office: 500, kitchen: 300, bathroom: 200 },
  uniformity: 0.4,
  clearances: CLEARANCES,
  heights: HEIGHTS,
  kitchenTriangle: { minPerimeterM: 3.6, maxPerimeterM: 7.9, minLegM: 1.2, maxLegM: 2.7 },
};

const COLOMBIA: ComplianceProfile = {
  ...NEUFERT,
  id: 'colombia',
  name: 'Colombia — orientativo',
  references: {
    circulation: 'NSR-10 Título K (circulaciones) y POT municipal',
    accessibility: 'NTC 6047: accesibilidad al medio físico',
    habitability: 'NSR-10 / POT: altura libre, iluminación y ventilación',
    ergonomics: 'NTC 6047 y Neufert: alturas y holguras',
    lighting: 'RETILAP: niveles de iluminancia en vivienda',
    electrical: 'RETIE y NTC 2050: tomas, GFCI y circuitos',
  },
  minCeilingM: 2.2,
  naturalLightRatio: 1 / 10,
  ventilationRatio: 1 / 20,
  targetLux: { living: 150, bedroom: 100, dining: 200, office: 500, kitchen: 300, bathroom: 150 },
};

export const PROFILES: Record<ComplianceProfileId, ComplianceProfile> = { neufert: NEUFERT, colombia: COLOMBIA };

export function profileOf(id: ComplianceProfileId): ComplianceProfile {
  return PROFILES[id];
}

export const COMPLIANCE_DISCLAIMER = 'Revisión orientativa: no reemplaza la revisión de un profesional ni la norma vigente de tu municipio.';
