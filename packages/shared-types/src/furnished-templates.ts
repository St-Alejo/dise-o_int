/**
 * Plantillas amuebladas: cuartos ya resueltos para probar el editor sin crear cuenta y para
 * empezar un proyecto desde algo hecho. Aquí vive solo la ficha de cada una (lo que se enseña en
 * la galería); la escena completa es un JSON aparte que se carga cuando se abre.
 */
import { z } from 'zod';
import { FurniturePlacementSchema, RoomFinishesSchema, RoomShellSchema, RoomTypeSchema, StyleIdSchema, type RoomType, type StyleId } from './domain.js';
import type { RoomSpec } from './room-templates.js';

export interface FurnishedTemplateInfo {
  id: string;
  name: string;
  roomType: RoomType;
  styleId: StyleId;
  /** Una línea que cuenta qué tiene de particular. */
  summary: string;
  /** Planta con la que se generó (para volver a generarla con el motor). */
  spec: RoomSpec;
}

export const FURNISHED_TEMPLATES: readonly FurnishedTemplateInfo[] = [
  { id: 'sala-escandinava', name: 'Sala escandinava', roomType: 'living', styleId: 'escandinavo', summary: 'Sofá en L, madera clara y mucha luz.', spec: { shape: 'rect', widthM: 5, depthM: 4, heightM: 2.6 } },
  { id: 'dormitorio-luminoso', name: 'Dormitorio luminoso', roomType: 'bedroom', styleId: 'escandinavo', summary: 'Cama doble con mesitas, lino y madera clara.', spec: { shape: 'rect', widthM: 4.2, depthM: 3.8, heightM: 2.6 } },
  { id: 'comedor-moderno', name: 'Comedor moderno', roomType: 'dining', styleId: 'moderno', summary: 'Mesa para seis y un aparador contra la pared.', spec: { shape: 'rect', widthM: 4.6, depthM: 3.8, heightM: 2.7 } },
  { id: 'estudio-industrial', name: 'Estudio industrial', roomType: 'office', styleId: 'industrial', summary: 'Escritorio junto a la ventana, metal y ladrillo.', spec: { shape: 'rect', widthM: 3.6, depthM: 3.2, heightM: 2.6 } },
  { id: 'cocina-minimalista', name: 'Cocina minimalista', roomType: 'kitchen', styleId: 'minimalista', summary: 'Hilera con isla y taburetes.', spec: { shape: 'rect', widthM: 4.4, depthM: 3.6, heightM: 2.6 } },
  { id: 'sala-en-l-bohemia', name: 'Sala en L bohemia', roomType: 'living', styleId: 'bohemio', summary: 'Planta en L con rincón de lectura y terracota.', spec: { shape: 'L', widthM: 5.6, depthM: 4.6, heightM: 2.6 } },
];

/** La escena de una plantilla, tal como se guarda en su JSON. */
export const FurnishedSceneSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  roomType: RoomTypeSchema,
  styleId: StyleIdSchema,
  roomShell: RoomShellSchema,
  furniturePlacements: z.array(FurniturePlacementSchema).max(200),
  finishes: RoomFinishesSchema.nullable(),
});
export type FurnishedScene = z.infer<typeof FurnishedSceneSchema>;

export function furnishedTemplateInfo(id: string): FurnishedTemplateInfo | undefined {
  return FURNISHED_TEMPLATES.find((t) => t.id === id);
}
