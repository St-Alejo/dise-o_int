/**
 * Plantillas amuebladas: cuartos ya resueltos para probar el editor sin crear cuenta y para
 * empezar un proyecto desde algo hecho. Aquí vive solo la ficha de cada una (lo que se enseña en
 * la galería); la escena completa es un JSON aparte que se carga cuando se abre.
 */
import { z } from 'zod';
import { FurniturePlacementSchema, RoomFinishesSchema, RoomShellSchema, RoomTypeSchema, StyleIdSchema, type RoomType, type StyleId } from './domain.js';
import type { RoomSpec } from './room-templates.js';
import { TechnicalSpecSchema } from './pro/technical.js';

export interface FurnishedTemplateInfo {
  id: string;
  name: string;
  roomType: RoomType;
  styleId: StyleId;
  /** Una línea que cuenta qué tiene de particular. */
  summary: string;
  /** Planta con la que se generó (para volver a generarla con el motor). */
  spec: RoomSpec;
  /** Trae ficha técnica (cajetín, instalaciones): pensada para el Modo Pro. */
  pro?: boolean;
  /** Diseño de vitrina compuesto a mano (`e2e/scripts/make-showcase.mjs`): va primero y se destaca. */
  featured?: boolean;
}

export const FURNISHED_TEMPLATES: readonly FurnishedTemplateInfo[] = [
  { id: 'sala-nogal-terciopelo', name: 'Sala de nogal y terciopelo', roomType: 'living', styleId: 'moderno', summary: 'Sofá de terciopelo verde frente a la tele, mármol y parqué en espiga.', spec: { shape: 'rect', widthM: 4.8, depthM: 4.4, heightM: 2.7 }, featured: true },
  { id: 'suite-clasica-azul', name: 'Suite clásica en azul', roomType: 'bedroom', styleId: 'clasico', summary: 'Cama de terciopelo azul, nogal, latón y un rincón de lectura junto a la ventana.', spec: { shape: 'rect', widthM: 4.8, depthM: 4.4, heightM: 2.8 }, featured: true },
  { id: 'cocina-roble-terrazo', name: 'Cocina de roble y terrazo', roomType: 'kitchen', styleId: 'escandinavo', summary: 'Hilera completa bajo la ventana, isla con tres taburetes y latón sobre el terrazo.', spec: { shape: 'rect', widthM: 4.8, depthM: 4, heightM: 2.7 }, featured: true },
  { id: 'comedor-travertino', name: 'Comedor de travertino', roomType: 'dining', styleId: 'minimalista', summary: 'Mesa ovalada para seis bajo dos lámparas, aparador lacado y luz de un ventanal.', spec: { shape: 'rect', widthM: 4.8, depthM: 4.2, heightM: 2.7 }, featured: true },
  { id: 'estudio-ladrillo', name: 'Estudio de ladrillo', roomType: 'office', styleId: 'industrial', summary: 'Escritorio de metal bajo la ventana, pared de ladrillo y un sillón de cuero para leer.', spec: { shape: 'rect', widthM: 3.8, depthM: 3.4, heightM: 2.8 }, featured: true },
  { id: 'bano-terracota', name: 'Baño bohemio de terracota', roomType: 'bathroom', styleId: 'bohemio', summary: 'Bañera exenta, piso de terracota, verde salvia y madera con espejo de latón.', spec: { shape: 'rect', widthM: 3, depthM: 2.8, heightM: 2.6 }, featured: true },
  { id: 'sala-escandinava', name: 'Sala escandinava', roomType: 'living', styleId: 'escandinavo', summary: 'Sofá en L, madera clara y mucha luz.', spec: { shape: 'rect', widthM: 5, depthM: 4, heightM: 2.6 } },
  { id: 'dormitorio-luminoso', name: 'Dormitorio luminoso', roomType: 'bedroom', styleId: 'escandinavo', summary: 'Cama doble con mesitas, lino y madera clara.', spec: { shape: 'rect', widthM: 4.2, depthM: 3.8, heightM: 2.6 } },
  { id: 'comedor-moderno', name: 'Comedor moderno', roomType: 'dining', styleId: 'moderno', summary: 'Mesa para seis y un aparador contra la pared.', spec: { shape: 'rect', widthM: 4.6, depthM: 3.8, heightM: 2.7 } },
  { id: 'estudio-industrial', name: 'Estudio industrial', roomType: 'office', styleId: 'industrial', summary: 'Escritorio junto a la ventana, metal y ladrillo.', spec: { shape: 'rect', widthM: 3.6, depthM: 3.2, heightM: 2.6 } },
  { id: 'cocina-minimalista', name: 'Cocina minimalista', roomType: 'kitchen', styleId: 'minimalista', summary: 'Hilera con isla y taburetes.', spec: { shape: 'rect', widthM: 4.4, depthM: 3.6, heightM: 2.6 } },
  { id: 'sala-en-l-bohemia', name: 'Sala en L bohemia', roomType: 'living', styleId: 'bohemio', summary: 'Planta en L con rincón de lectura y terracota.', spec: { shape: 'L', widthM: 5.6, depthM: 4.6, heightM: 2.6 } },
  { id: 'dormitorio-obra', name: 'Dormitorio listo para obra', roomType: 'bedroom', styleId: 'escandinavo', summary: 'Con cajetín, instalaciones y presupuesto de obra: el juego de planos sale en el Modo Pro.', spec: { shape: 'rect', widthM: 4.2, depthM: 3.8, heightM: 2.6 }, pro: true },
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
  technical: TechnicalSpecSchema.nullable().optional(),
});
export type FurnishedScene = z.infer<typeof FurnishedSceneSchema>;

export function furnishedTemplateInfo(id: string): FurnishedTemplateInfo | undefined {
  return FURNISHED_TEMPLATES.find((t) => t.id === id);
}
