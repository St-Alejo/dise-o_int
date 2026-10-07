/**
 * Registro por defecto con todas las recetas. Es el punto de entrada que usan la web
 * (render en vivo) y el seed (GLB para AR, miniaturas y respaldo).
 */
import type { Vector3 } from '@interiores/shared-types';
import type { FurnitureModel } from './builder.js';
import { KITCHEN_BATH } from './recipes/kitchen-bath.js';
import { SEATING } from './recipes/seating.js';
import { STORAGE } from './recipes/storage.js';
import { TABLES } from './recipes/tables.js';
import { WALL_LIGHT_DECOR } from './recipes/wall-light-decor.js';
import { RecipeRegistry, buildCached, type FurnitureRecipe, type Params } from './registry.js';

export const FURNITURE = new RecipeRegistry().register(...SEATING, ...TABLES, ...STORAGE, ...KITCHEN_BATH, ...WALL_LIGHT_DECOR);

/** Construye (con caché Flyweight) el mueble `kind` a las medidas dadas. */
export function buildFurniture(kind: string, dims: Vector3, params: Params = {}): FurnitureModel {
  return buildCached(FURNITURE, kind, dims, params);
}

export function recipeFor(kind: string): FurnitureRecipe | null {
  return FURNITURE.has(kind) ? FURNITURE.get(kind) : null;
}
