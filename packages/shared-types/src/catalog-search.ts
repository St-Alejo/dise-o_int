/**
 * Búsqueda del catálogo (función pura, la misma en el servidor y en el navegador).
 *
 * - Sin acentos ni mayúsculas: "lámpara" = "LAMPARA".
 * - Plurales y singulares en español e inglés: "lámparas", "luces", "lamps".
 * - Tolera errores de tipeo con similitud de trigramas: "lampra" encuentra "lámpara".
 * - Sinónimos por categoría: "luz" → iluminación, "closet" → almacenaje.
 * - Todas las palabras de la búsqueda deben coincidir con algo (semántica AND), y gana el
 *   resultado que coincide en el nombre sobre el que coincide solo en etiquetas.
 */
import type { CatalogCategory, CatalogItem } from './domain.js';
import type { CatalogQuery } from './api.js';

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'para', 'con', 'y', 'o', 'en', 'mi', 'al',
  'the', 'a', 'an', 'of', 'for', 'with', 'and', 'or', 'in', 'my',
]);

/** Términos (es/en) que identifican cada categoría aunque el ítem no los tenga como etiqueta. */
export const CATEGORY_TERMS: Record<CatalogCategory, readonly string[]> = {
  sofa: ['sofa', 'sillon', 'couch', 'sofa cama'],
  table: ['mesa', 'table', 'escritorio', 'desk'],
  chair: ['silla', 'chair', 'butaca', 'asiento', 'taburete', 'stool', 'puf'],
  bed: ['cama', 'bed'],
  storage: ['armario', 'closet', 'ropero', 'estanteria', 'librero', 'mueble', 'almacenaje', 'storage', 'wardrobe', 'shelf', 'comoda', 'aparador'],
  lighting: ['lampara', 'luz', 'iluminacion', 'light', 'lamp', 'foco', 'aplique'],
  decor: ['decoracion', 'decor', 'adorno', 'planta', 'plant', 'jarron', 'vase'],
  kitchen: ['cocina', 'kitchen', 'nevera', 'refrigerador', 'estufa', 'fregadero', 'alacena'],
  bathroom: ['bano', 'bath', 'bathroom', 'inodoro', 'lavamanos', 'banera', 'ducha'],
  'wall-decor': ['pared', 'wall', 'cuadro', 'espejo', 'mirror', 'arte', 'art', 'repisa', 'reloj'],
  textile: ['textil', 'alfombra', 'tapete', 'rug', 'cojin', 'cushion', 'cortina', 'curtain'],
  electronics: ['tv', 'televisor', 'television', 'electronica', 'pantalla'],
};

/** Minúsculas, sin acentos ni signos. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

/** Singular aproximado para español e inglés (suficiente para buscar muebles). */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ces')) return `${word.slice(0, -3)}z`; // luces → luz
  if (/[^aeiou]es$/.test(word) && word.length > 4) {
    const base = word.slice(0, -2);
    // sillones → sillon, papeles → papel; pero muebles → mueble y tables → table (grupo consonántico).
    if (!/(bl|pl|cl|gl|fl|br|cr|dr|fr|gr|pr|tr)$/.test(base)) return base;
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); // mesas → mesa, lamps → lamp
  return word;
}

export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem);
}

function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Similitud de Jaccard entre trigramas (0–1), como pg_trgm. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const FUZZY_MIN = 0.42;

/** Mejor coincidencia de una palabra de la búsqueda contra un conjunto de palabras del ítem. */
function matchToken(q: string, words: readonly string[], exact: number, prefix: number, fuzzy: number): number {
  let best = 0;
  for (const w of words) {
    if (w === q) return exact;
    if (q.length >= 2 && w.startsWith(q)) best = Math.max(best, prefix);
    else if (q.length >= 4 && q.startsWith(w) && w.length >= 4) best = Math.max(best, prefix * 0.8);
    else if (q.length >= 3) {
      const sim = similarity(q, w);
      if (sim >= FUZZY_MIN) best = Math.max(best, fuzzy * sim);
    }
  }
  return best;
}

interface IndexedItem<T> {
  item: T;
  name: string;
  nameWords: string[];
  tagWords: string[];
  categoryWords: string[];
  descWords: string[];
}

function index<T extends SearchableItem>(item: T): IndexedItem<T> {
  return {
    item,
    name: normalizeText(item.name),
    nameWords: tokenize(item.name),
    tagWords: [...(item.tags ?? []), ...(item.synonyms ?? []), ...(item.subcategory ? [item.subcategory.replace(/-/g, ' ')] : [])].flatMap(tokenize),
    categoryWords: CATEGORY_TERMS[item.category].flatMap(tokenize),
    descWords: item.description ? tokenize(item.description) : [],
  };
}

/** Puntaje del ítem para la búsqueda, o 0 si alguna palabra no coincide con nada. */
function score<T>(ix: IndexedItem<T>, queryWords: string[], phrase: string): number {
  let total = 0;
  for (const q of queryWords) {
    const s = Math.max(
      matchToken(q, ix.nameWords, 3, 2.4, 2),
      matchToken(q, ix.tagWords, 2.5, 2, 1.6),
      matchToken(q, ix.categoryWords, 1.5, 1.2, 1.1),
      matchToken(q, ix.descWords, 1, 0.8, 0),
    );
    if (s === 0) return 0;
    total += s;
  }
  if (phrase && ix.name.includes(phrase)) total += 1.5;
  return total;
}

/** Lo mínimo que necesita la búsqueda (CatalogItem lo cumple). */
export type SearchableItem = Pick<
  CatalogItem,
  'id' | 'name' | 'category' | 'subcategory' | 'styleTags' | 'roomTypes' | 'mount' | 'dimensionsM' | 'price' | 'tags' | 'synonyms' | 'description'
>;

export type CatalogFilters = Pick<CatalogQuery, 'category' | 'style' | 'roomType' | 'mount' | 'maxWidthM' | 'maxPrice' | 'q'>;

export interface RankedItem<T> {
  item: T;
  score: number;
}

/**
 * Filtra y ordena. Sin texto, el orden es por categoría y nombre (estable para paginar);
 * con texto, por relevancia.
 */
export function searchCatalog<T extends SearchableItem>(items: readonly T[], filters: CatalogFilters): RankedItem<T>[] {
  const filtered = items.filter(
    (i) =>
      (!filters.category || i.category === filters.category) &&
      (!filters.style || i.styleTags.includes(filters.style)) &&
      (!filters.roomType || i.roomTypes.includes(filters.roomType)) &&
      (!filters.mount || i.mount === filters.mount) &&
      (filters.maxWidthM === undefined || i.dimensionsM.x <= filters.maxWidthM + 1e-9) &&
      (filters.maxPrice === undefined || (i.price ?? 0) <= filters.maxPrice),
  );
  const queryWords = filters.q ? tokenize(filters.q) : [];
  if (queryWords.length === 0) {
    return filtered
      .map((item) => ({ item, score: 0 }))
      .sort((a, b) => a.item.category.localeCompare(b.item.category) || a.item.name.localeCompare(b.item.name, 'es'));
  }
  const phrase = normalizeText(filters.q ?? '');
  return filtered
    .map((item) => ({ item, score: score(index(item), queryWords, phrase) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'es'));
}

// --------------------------------------------------------------------------- paginación
/** El cursor es el desplazamiento en base 36 con un prefijo de versión (opaco para el cliente). */
export function encodeCursor(offset: number): string {
  return `c1.${offset.toString(36)}`;
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const m = /^c1\.([0-9a-z]{1,8})$/.exec(cursor);
  const n = m ? Number.parseInt(m[1]!, 36) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) throw new RangeError('Cursor de paginación inválido');
  return n;
}

export function paginate<T>(results: readonly T[], limit: number, cursor?: string): { items: T[]; nextCursor: string | null; total: number } {
  const offset = decodeCursor(cursor);
  const items = results.slice(offset, offset + limit);
  const next = offset + items.length;
  return { items, nextCursor: next < results.length ? encodeCursor(next) : null, total: results.length };
}
