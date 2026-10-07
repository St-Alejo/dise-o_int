/**
 * Factory de muebles paramétricos: `kind → receta`. Las recetas reciben medidas reales y
 * RECONSTRUYEN la pieza (no la estiran): las patas conservan su grosor, el número de cojines,
 * puertas o estantes depende del tamaño.
 *
 * `buildFurniture` cachea los resultados por (kind, medidas al mm, parámetros) — Flyweight:
 * diez sillas iguales comparten una sola geometría.
 */
import type { MaterialSlot, Vector3 } from '@interiores/shared-types';
import { FurnitureBuilder, type FurnitureModel } from './builder.js';

export type ParamValue = number | string | boolean;
export type Params = Readonly<Record<string, ParamValue>>;

export interface RecipeContext {
  /** Ancho (X), alto (Y) y fondo (Z) en metros. */
  w: number;
  h: number;
  d: number;
  b: FurnitureBuilder;
  num(name: string, fallback: number): number;
  str(name: string, fallback: string): string;
  bool(name: string, fallback: boolean): boolean;
}

export interface FurnitureRecipe {
  kind: string;
  label: string;
  /** Slots de material con su material por defecto y las familias permitidas. */
  slots: MaterialSlot[];
  /** Medidas típicas (las usa el catálogo cuando no indica otras). */
  defaultDims: Vector3;
  build(ctx: RecipeContext): void;
}

export class UnknownRecipeError extends Error {}

export class RecipeRegistry {
  private readonly recipes = new Map<string, FurnitureRecipe>();

  register(...recipes: FurnitureRecipe[]): this {
    for (const r of recipes) {
      if (this.recipes.has(r.kind)) throw new Error(`Receta duplicada: ${r.kind}`);
      this.recipes.set(r.kind, r);
    }
    return this;
  }

  get(kind: string): FurnitureRecipe {
    const r = this.recipes.get(kind);
    if (!r) throw new UnknownRecipeError(`No existe la receta "${kind}"`);
    return r;
  }

  has(kind: string): boolean {
    return this.recipes.has(kind);
  }

  get kinds(): string[] {
    return [...this.recipes.keys()];
  }

  /** Construye sin caché (las pruebas lo usan para medir cada receta). */
  build(kind: string, dims: Vector3, params: Params = {}): FurnitureModel {
    const recipe = this.get(kind);
    if (!(dims.x > 0 && dims.y > 0 && dims.z > 0)) throw new RangeError(`Medidas inválidas para ${kind}`);
    const b = new FurnitureBuilder(kind);
    recipe.build({
      w: dims.x,
      h: dims.y,
      d: dims.z,
      b,
      num: (name, fallback) => {
        const v = params[name];
        return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      },
      str: (name, fallback) => {
        const v = params[name];
        return typeof v === 'string' ? v : fallback;
      },
      bool: (name, fallback) => {
        const v = params[name];
        return typeof v === 'boolean' ? v : fallback;
      },
    });
    return b.build();
  }
}

const CACHE_LIMIT = 256;
const cache = new Map<string, FurnitureModel>();

export function modelKey(kind: string, dims: Vector3, params: Params = {}): string {
  const mm = (v: number) => Math.round(v * 1000);
  const p = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('&');
  return `${kind}|${mm(dims.x)}x${mm(dims.y)}x${mm(dims.z)}|${p}`;
}

/** Construye con caché Flyweight (LRU simple): misma clave → mismo objeto. */
export function buildCached(registry: RecipeRegistry, kind: string, dims: Vector3, params: Params = {}): FurnitureModel {
  const key = modelKey(kind, dims, params);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // reinsertar = marcar como usado recientemente
    cache.set(key, hit);
    return hit;
  }
  const model = registry.build(kind, dims, params);
  cache.set(key, model);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return model;
}

export function clearModelCache(): void {
  cache.clear();
}
