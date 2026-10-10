import type { RoomType, StyleId } from './domain.js';

export interface StyleDefinition {
  id: StyleId;
  label: string;
  description: string;
  /** Fragmento de prompt para el motor de difusión (Track A). */
  prompt: string;
  /** Paleta representativa (hex): la UI la muestra y el generador mock la usa para gradar color. */
  palette: readonly [string, string, string];
}

export const STYLES: Record<StyleId, StyleDefinition> = {
  escandinavo: {
    id: 'escandinavo',
    label: 'Escandinavo',
    description: 'Madera clara, blancos cálidos y textiles naturales.',
    prompt: 'scandinavian interior, light oak wood, white walls, cozy wool textiles, hygge',
    palette: ['#f4efe6', '#c8a97e', '#7d8c7a'],
  },
  minimalista: {
    id: 'minimalista',
    label: 'Minimalista',
    description: 'Pocas piezas, líneas limpias y mucho espacio libre.',
    prompt: 'minimalist interior, clean lines, neutral palette, uncluttered, soft daylight',
    palette: ['#f2f2f0', '#bfbcb6', '#3c3c3c'],
  },
  industrial: {
    id: 'industrial',
    label: 'Industrial',
    description: 'Metal negro, ladrillo y cuero envejecido.',
    prompt: 'industrial loft interior, exposed brick, black steel, leather, edison bulbs',
    palette: ['#3b3533', '#8a5a44', '#b7b1a8'],
  },
  bohemio: {
    id: 'bohemio',
    label: 'Bohemio',
    description: 'Plantas, colores tierra, mezclas de patrones y fibras.',
    prompt: 'bohemian interior, plants, rattan, terracotta, layered patterned rugs, warm light',
    palette: ['#d9a066', '#a0522d', '#6b8e23'],
  },
  moderno: {
    id: 'moderno',
    label: 'Moderno',
    description: 'Contraste, formas geométricas y acentos de color.',
    prompt: 'modern contemporary interior, bold accents, geometric shapes, sleek furniture',
    palette: ['#e8e6e1', '#2f4858', '#f26419'],
  },
  clasico: {
    id: 'clasico',
    label: 'Clásico',
    description: 'Maderas oscuras, molduras y tapicería elegante.',
    prompt: 'classic elegant interior, dark wood, moldings, tufted upholstery, brass details',
    palette: ['#efe3d0', '#6f4e37', '#8b1e3f'],
  },
};

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  living: 'Sala',
  bedroom: 'Dormitorio',
  dining: 'Comedor',
  office: 'Oficina',
  kitchen: 'Cocina',
  bathroom: 'Baño',
};

export const ROOM_TYPE_PROMPTS: Record<RoomType, string> = {
  living: 'living room',
  bedroom: 'bedroom',
  dining: 'dining room',
  office: 'home office',
  kitchen: 'kitchen',
  bathroom: 'bathroom',
};

/** Estilos por defecto que se generan al subir la foto (la investigación: nunca una sola opción). */
export const DEFAULT_STYLES: readonly StyleId[] = ['escandinavo', 'moderno', 'industrial'];

export const DEFAULT_PROMPT_STRENGTH = 0.6;
