/**
 * Metadatos derivados de cada entrada del manifiesto: palabras de búsqueda (es/en) por
 * subcategoría y el spec de personalización. Funciones puras: el seed las usa y las pruebas
 * validan con ellas el manifiesto completo sin tocar la red ni la base de datos.
 */
import type { CatalogSpec, Vector3 } from '@interiores/shared-types';
import type { ManifestEntry } from './manifest.js';
import { parametricSpec } from './parametric.js';

/** Etiquetas (es) y sinónimos (en/regionales) por subcategoría. */
export const SUBCATEGORY_TERMS: Record<string, { tags: string[]; synonyms: string[] }> = {
  armchair: { tags: ['butaca', 'sillon'], synonyms: ['armchair', 'poltrona'] },
  ottoman: { tags: ['puf', 'reposapies'], synonyms: ['ottoman', 'pouf'] },
  'dining-chair': { tags: ['silla', 'silla de comedor'], synonyms: ['dining chair', 'chair'] },
  stool: { tags: ['taburete', 'banco'], synonyms: ['stool'] },
  'office-chair': { tags: ['silla de oficina', 'silla de escritorio'], synonyms: ['office chair', 'desk chair'] },
  'coffee-table': { tags: ['mesa de centro', 'mesa baja'], synonyms: ['coffee table'] },
  'dining-table': { tags: ['mesa de comedor', 'comedor'], synonyms: ['dining table'] },
  'side-table': { tags: ['mesa auxiliar', 'mesita'], synonyms: ['side table', 'end table'] },
  nightstand: { tags: ['mesa de noche', 'mesita de noche', 'velador'], synonyms: ['nightstand', 'bedside table'] },
  desk: { tags: ['escritorio', 'mesa de trabajo'], synonyms: ['desk'] },
  shelf: { tags: ['estanteria', 'librero', 'biblioteca'], synonyms: ['bookshelf', 'bookcase', 'shelf'] },
  wardrobe: { tags: ['armario', 'closet', 'ropero'], synonyms: ['wardrobe'] },
  'tv-stand': { tags: ['mueble tv', 'rack'], synonyms: ['tv stand', 'media console'] },
  sideboard: { tags: ['aparador', 'bufetera'], synonyms: ['sideboard', 'credenza'] },
  dresser: { tags: ['comoda', 'cajonera'], synonyms: ['dresser', 'chest of drawers'] },
  rug: { tags: ['alfombra', 'tapete'], synonyms: ['rug', 'carpet'] },
  plant: { tags: ['planta', 'maceta'], synonyms: ['plant'] },
  vase: { tags: ['jarron', 'florero'], synonyms: ['vase'] },
  books: { tags: ['libros'], synonyms: ['books'] },
  'floor-lamp': { tags: ['lampara de pie', 'lampara'], synonyms: ['floor lamp'] },
  'table-lamp': { tags: ['lampara de mesa', 'lampara', 'velador'], synonyms: ['table lamp'] },
  'desk-lamp': { tags: ['lampara de escritorio', 'flexo', 'lampara'], synonyms: ['desk lamp'] },
  pendant: { tags: ['lampara colgante', 'lampara de techo', 'lampara'], synonyms: ['pendant', 'ceiling lamp'] },
  sconce: { tags: ['aplique', 'lampara de pared', 'lampara'], synonyms: ['sconce', 'wall lamp'] },
  mirror: { tags: ['espejo'], synonyms: ['mirror'] },
  'wall-art': { tags: ['cuadro', 'lamina', 'arte'], synonyms: ['wall art', 'painting', 'poster'] },
  'wall-shelf': { tags: ['repisa', 'estante', 'balda'], synonyms: ['wall shelf', 'floating shelf'] },
  clock: { tags: ['reloj'], synonyms: ['clock'] },
  curtains: { tags: ['cortinas', 'cortina'], synonyms: ['curtains', 'drapes'] },
  cushion: { tags: ['cojin', 'almohadon'], synonyms: ['cushion', 'pillow'] },
  tv: { tags: ['televisor', 'tele', 'pantalla'], synonyms: ['tv', 'television'] },
  'kitchen-base': { tags: ['mueble de cocina', 'gabinete'], synonyms: ['kitchen cabinet'] },
  'kitchen-wall': { tags: ['alacena', 'mueble alto'], synonyms: ['wall cabinet'] },
  'kitchen-island': { tags: ['isla', 'barra'], synonyms: ['kitchen island'] },
  fridge: { tags: ['nevera', 'refrigerador'], synonyms: ['fridge', 'refrigerator'] },
  stove: { tags: ['estufa', 'horno', 'cocina'], synonyms: ['stove', 'oven'] },
  sink: { tags: ['fregadero', 'lavaplatos'], synonyms: ['sink'] },
  toilet: { tags: ['inodoro', 'sanitario'], synonyms: ['toilet'] },
  vanity: { tags: ['lavamanos', 'lavabo'], synonyms: ['vanity', 'sink'] },
  bathtub: { tags: ['banera', 'tina'], synonyms: ['bathtub'] },
  shower: { tags: ['ducha', 'regadera'], synonyms: ['shower'] },
};

/** Términos por categoría para entradas sin subcategoría (sofás, camas). */
const CATEGORY_FALLBACK: Partial<Record<ManifestEntry['category'], { tags: string[]; synonyms: string[] }>> = {
  sofa: { tags: ['sofa', 'sillon'], synonyms: ['sofa', 'couch'] },
  bed: { tags: ['cama'], synonyms: ['bed'] },
};

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean))];

export function searchTermsFor(entry: ManifestEntry): { tags: string[]; synonyms: string[] } {
  const base = (entry.subcategory ? SUBCATEGORY_TERMS[entry.subcategory] : undefined) ?? CATEGORY_FALLBACK[entry.category];
  return {
    tags: uniq([...(base?.tags ?? []), ...(entry.tags ?? [])]),
    synonyms: uniq([...(base?.synonyms ?? []), ...(entry.synonyms ?? [])]),
  };
}

const GLB_TUCKS_UNDER = new Set(['dining-chair']);
const GLB_ALLOWS_UNDER = new Set(['dining-table', 'desk']);

/**
 * Spec de personalización. Los paramétricos traen receta, slots y rangos ±30 %; los GLB de
 * Poly Haven solo se pueden escalar ±15 % (se estiran, no se reconstruyen).
 */
export function catalogSpecFor(entry: ManifestEntry, measured: Vector3): CatalogSpec | null {
  if (entry.source.type === 'parametric') return parametricSpec(entry.source, entry.spec ?? {});
  const r = (v: number): [number, number] => [Math.round(v * 0.85 * 1000) / 1000, Math.round(v * 1.15 * 1000) / 1000];
  const spec: CatalogSpec = {
    ...entry.spec,
    resize: entry.subcategory === 'rug' ? { x: r(measured.x), z: r(measured.z) } : { x: r(measured.x), y: r(measured.y), z: r(measured.z) },
    ...(entry.subcategory && GLB_TUCKS_UNDER.has(entry.subcategory) ? { tucksUnder: true } : {}),
    ...(entry.subcategory && GLB_ALLOWS_UNDER.has(entry.subcategory) ? { allowsUnder: true } : {}),
  };
  return spec;
}
