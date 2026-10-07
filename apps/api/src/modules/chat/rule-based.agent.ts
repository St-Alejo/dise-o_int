/**
 * Agente por reglas: entiende órdenes simples en español sin red ni costo ("agrega una mesa de
 * noche junto a la cama", "quita la alfombra", "pinta las paredes de verde salvia", "el cuarto
 * mide 4 x 3,5"). Sirve de respaldo cuando no hay API key o Claude falla, y hace las pruebas
 * end-to-end deterministas. Usa exactamente las mismas herramientas que Claude.
 */
import {
  materialsForSurface,
  MATERIALS,
  normalizeText,
  searchCatalog,
  type CatalogItem,
  type DesignToolbox,
  type FurniturePlacement,
  type Relation,
  type ToolOutcome,
} from '@interiores/shared-types';
import type { DesignAgent, DesignAgentInput, DesignAgentResult } from './design-agent.js';

/** Minúsculas y sin acentos, pero conserva números y signos (las medidas los necesitan). */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const CLITIC = '(?:lo|la|los|las|le|les|me|nos)?';
const verb = (...stems: string[]) => new RegExp(`^(?:por favor\\s+)?(?:${stems.join('|')})${CLITIC}\\b`);

const VERBS = {
  add: verb('agrega', 'agregar', 'anade', 'anadir', 'pon', 'poner', 'ponme', 'coloca', 'colocar', 'mete', 'incluye', 'quiero', 'necesito', 'add', 'put', 'place'),
  remove: verb('quita', 'quitar', 'elimina', 'eliminar', 'borra', 'borrar', 'saca', 'sacar', 'remove', 'delete'),
  move: verb('mueve', 'mover', 'lleva', 'llevar', 'corre', 'correr', 'pasa', 'move'),
  rotate: verb('gira', 'girar', 'rota', 'rotar', 'voltea', 'voltear', 'rotate', 'turn'),
  bigger: verb('agranda', 'agrandar', 'amplia', 'ampliar', 'alarga', 'alargar'),
  smaller: verb('achica', 'achicar', 'reduce', 'reducir', 'encoge', 'encoger', 'acorta', 'acortar'),
  paint: verb('pinta', 'pintar', 'paint'),
  material: verb('tapiza', 'tapizar', 'forra', 'forrar', 'cambia', 'cambiar'),
};

/** Frases de relación → relación del resolvedor (de la más larga a la más corta). */
const RELATION_PHRASES: [RegExp, Relation][] = [
  [/\ba la izquierda (?:de(?:l)?|de la)\b/, 'left-of'],
  [/\ba la derecha (?:de(?:l)?|de la)\b/, 'right-of'],
  [/\b(?:junto a(?:l)?|al lado de(?:l)?|cerca de(?:l)?|pegad[oa]s? a(?:l)?|next to)\b/, 'next-to'],
  [/\b(?:enfrente de(?:l)?|mirando a(?:l)?|de cara a(?:l)?|facing)\b/, 'facing'],
  [/\b(?:frente a(?:l)?|delante de(?:l)?|in front of)\b/, 'in-front-of'],
  [/\b(?:detras de(?:l)?|behind)\b/, 'behind'],
  [/\b(?:sobre|encima de(?:l)?|arriba de(?:l)?|on top of)\b/, 'on-top-of'],
  [/\b(?:contra la pared|en la pared|pegad[oa] a la pared)\b/, 'against-wall'],
  [/\b(?:en el centro|en medio|al centro|in the center)\b/, 'center'],
];

const WALL_WORDS: [RegExp, string][] = [
  [/\b(?:del fondo|de atras|trasera)\b/, 'w-back'],
  [/\b(?:izquierda)\b/, 'w-left'],
  [/\b(?:derecha)\b/, 'w-right'],
  [/\b(?:del frente|de enfrente|delantera)\b/, 'w-front'],
];

const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, par: 2 };
const FILLER = /^(?:(?:un|una|unos|unas|el|la|los|las|otro|otra|otros|otras|mas|nuevo|nueva|de|del|al|a|en|por favor|tambien|ahora|me|y)\s+)+/;

/** Color / material dicho en palabras → id de material, por superficie. */
const PAINT_ALIASES: [RegExp, string][] = [
  [/\bsalvia|verde\b/, 'paint-sage'],
  [/\bmarino|azul\b/, 'paint-navy'],
  [/\bcarbon|gris oscuro|gris|negro\b/, 'paint-charcoal'],
  [/\bgreige|beige|arena\b/, 'paint-greige'],
  [/\bterracota|naranja\b/, 'paint-terracotta'],
  [/\brosa|empolvado\b/, 'paint-blush'],
  [/\bladrillo\b/, 'paint-brick'],
  [/\bblanc[oa]\b/, 'paint-white'],
];
const FLOOR_ALIASES: [RegExp, string][] = [
  [/\bnogal|madera oscura\b/, 'wood-walnut'],
  [/\bfresno|madera clara|blanquead[oa]\b/, 'wood-ash-white'],
  [/\bteca\b/, 'wood-teak'],
  [/\broble|madera|parquet|laminado\b/, 'wood-oak'],
  [/\bmarmol\b/, 'stone-marble-white'],
  [/\btravertino\b/, 'stone-travertine'],
  [/\bmicrocemento|cemento|concreto\b/, 'stone-microcement'],
  [/\bterracota|barro\b/, 'ceramic-terracotta'],
  [/\bporcelanato|gris\b/, 'ceramic-grey-tile'],
  [/\bceramica|baldosa|blanc[oa]\b/, 'ceramic-white'],
];

interface Clause {
  text: string;
}

export class RuleBasedDesignAgent implements DesignAgent {
  readonly kind = 'rules' as const;
  readonly available = true;

  async run({ message, toolbox }: DesignAgentInput): Promise<DesignAgentResult> {
    const session = new RuleSession(toolbox);
    for (const clause of splitClauses(message)) session.handle(clause);
    return { reply: session.reply() };
  }
}

/** Separa "agrega una mesa y quita la alfombra, luego pinta..." en órdenes sueltas. */
export function splitClauses(message: string): Clause[] {
  const verbs = Object.values(VERBS)
    .map((r) => r.source.replace(/^\^\(\?:por favor\\s\+\)\?/, ''))
    .join('|');
  return fold(message)
    .split(new RegExp(`\\s*(?:[;!?]|\\.(?=\\s|$)|,\\s*(?:y\\s+)?(?:luego|despues|tambien)?|\\b(?:luego|despues)\\b|\\by\\s+(?=(?:${verbs})))\\s*`))
    .map((t) => t.replace(/^(?:y|luego|despues|tambien)\s+/, '').trim())
    .filter((t) => t.length > 1)
    .map((text) => ({ text }));
}

class RuleSession {
  private readonly said: string[] = [];
  private readonly problems: string[] = [];
  /** Última pieza tocada ("ponla más cerca", "gírala"). */
  private lastId: string | null = null;
  private understood = 0;

  constructor(private readonly tb: DesignToolbox) {}

  reply(): string {
    if (this.understood === 0) {
      return [
        'No entendí qué cambiar. Prueba con órdenes como:',
        '• "agrega una lámpara de pie junto al sofá"',
        '• "pon una mesa de noche a la derecha de la cama"',
        '• "quita la alfombra" · "gira el sofá" · "agranda la mesa"',
        '• "pinta las paredes de verde salvia" · "piso de nogal"',
        '• "el cuarto mide 4 x 3,5"',
      ].join('\n');
    }
    const lines = [...this.said.map((s) => `✓ ${s}`), ...this.problems.map((p) => `✗ ${p}`)];
    return lines.join('\n');
  }

  private record(out: ToolOutcome, id?: string): void {
    if (out.ok) {
      this.said.push(out.summary);
      const data = JSON.parse(out.content) as { id?: string };
      this.lastId = data.id ?? id ?? this.lastId;
    } else {
      this.problems.push(out.summary);
    }
  }

  handle({ text }: Clause): void {
    if (this.roomSize(text)) return;
    if (this.finishes(text)) return;
    if (VERBS.remove.test(text)) return this.remove(strip(text, VERBS.remove));
    if (VERBS.rotate.test(text)) return this.rotate(strip(text, VERBS.rotate));
    if (VERBS.bigger.test(text) || /\bmas grande\b/.test(text)) return this.resize(text, 1.2);
    if (VERBS.smaller.test(text) || /\bmas (?:pequen[oa]|chic[oa])\b/.test(text)) return this.resize(text, 1 / 1.2);
    if (VERBS.move.test(text)) return this.move(strip(text, VERBS.move));
    if (VERBS.material.test(text) || VERBS.paint.test(text)) {
      if (this.furnitureMaterial(text)) return;
    }
    if (VERBS.add.test(text)) return this.add(strip(text, VERBS.add));
  }

  // ------------------------------------------------------------------ cuarto y acabados
  private roomSize(text: string): boolean {
    if (!/\b(?:cuarto|habitacion|sala|recamara|dormitorio|espacio|room)\b/.test(text) || !/\bmide|medidas|tamano|mida\b/.test(text)) return false;
    const m = /(\d+(?:\.\d+)?)\s*(cm|m)?\s*(?:x|por|×)\s*(\d+(?:\.\d+)?)\s*(cm|m)?(?:\s*(?:x|por|×)\s*(\d+(?:\.\d+)?)\s*(cm|m)?)?/.exec(text);
    if (!m) return false;
    this.understood++;
    const meters = (v: string | undefined, unit: string | undefined) => (v === undefined ? undefined : unit === 'cm' || Number(v) > 30 ? Number(v) / 100 : Number(v));
    const height = meters(m[5], m[6]) ?? (() => {
      const h = /\balto (?:de )?(\d+(?:\.\d+)?)\s*(cm|m)?/.exec(text);
      return h ? meters(h[1], h[2]) : undefined;
    })();
    this.record(this.tb.run('set_room_size', { widthM: meters(m[1], m[2]), depthM: meters(m[3], m[4]), ...(height !== undefined ? { heightM: height } : {}) }));
    return true;
  }

  private finishes(text: string): boolean {
    const walls = /\b(?:pared|paredes|muros?)\b/.test(text);
    const floor = /\b(?:piso|suelo)\b/.test(text);
    const ceiling = /\btecho\b/.test(text);
    if (!walls && !floor && !ceiling) return false;
    // "pon una lámpara en la pared" no es un acabado.
    if (VERBS.add.test(text) && !/\b(?:piso|suelo|paredes|techo) (?:de|en)\b/.test(text)) return false;
    const input: Record<string, string> = {};
    const tail = (word: string) => text.slice(text.search(new RegExp(`\\b${word}`)));
    if (walls) {
      const id = matchAlias(tail('(?:pared|muro)'), PAINT_ALIASES, 'wall');
      if (id) input['walls'] = id;
      const wall = WALL_WORDS.find(([r]) => r.test(text))?.[1];
      if (wall && /\bpared\b/.test(text) && !/\bparedes\b/.test(text)) input['wallId'] = wall;
    }
    if (floor) {
      const id = matchAlias(tail('(?:piso|suelo)'), FLOOR_ALIASES, 'floor');
      if (id) input['floor'] = id;
    }
    if (ceiling) {
      const id = matchAlias(tail('techo'), PAINT_ALIASES, 'ceiling');
      if (id) input['ceiling'] = id;
    }
    this.understood++;
    if (!input['walls'] && !input['floor'] && !input['ceiling']) {
      this.problems.push('No reconocí el color o material. Prueba con "verde salvia", "azul marino", "nogal", "mármol"...');
      return true;
    }
    this.record(this.tb.run('set_finishes', input));
    return true;
  }

  // ------------------------------------------------------------------ muebles
  private add(rest: string): void {
    const { count, object, relation, ref, wallId } = parsePlacement(rest);
    if (!object) return;
    const item = this.findCatalogItem(object);
    this.understood++;
    if (!item) {
      this.problems.push(`No encontré "${object}" en el catálogo`);
      return;
    }
    let nearId: string | undefined;
    if (ref) {
      const target = this.findPlacement(ref);
      if (!target) {
        this.problems.push(`No encontré "${ref}" en el cuarto para poner ${item.name.toLowerCase()} cerca`);
        return;
      }
      nearId = target.id;
    }
    const rel: Relation = relation ?? (nearId ? 'next-to' : wallId ? 'against-wall' : 'anywhere');
    const fixedRel: Relation = rel === 'on-top-of' && (item.mount === 'wall' || item.mount === 'ceiling') ? 'above' : rel;
    for (let i = 0; i < count; i++) {
      this.record(this.tb.run('add_item', { catalogItemId: item.id, relation: fixedRel, ...(nearId ? { nearId } : {}), ...(wallId ? { wallId } : {}) }));
    }
  }

  private target(objectText: string): FurniturePlacement | null {
    const cleaned = objectText.replace(FILLER, '').trim();
    if (!cleaned || /^(?:lo|la|eso|esa|ese|esto|esta|este)$/.test(cleaned)) {
      return this.lastId ? (this.tb.scenePlacements.find((p) => p.id === this.lastId) ?? null) : null;
    }
    return this.findPlacement(cleaned);
  }

  private remove(rest: string): void {
    const object = rest.replace(FILLER, '').trim();
    this.understood++;
    const all = /^(?:todo|todos|todas|todos los muebles)$/.test(object);
    if (all) {
      // Quitar un soporte se lleva lo de encima: se salta lo que ya no está.
      for (const id of this.tb.scenePlacements.map((p) => p.id)) {
        if (this.tb.scenePlacements.some((p) => p.id === id)) this.record(this.tb.run('remove_item', { id }));
      }
      return;
    }
    const target = this.target(object);
    if (!target) {
      this.problems.push(object ? `No encontré "${object}" en el cuarto` : 'Dime qué quieres quitar');
      return;
    }
    this.record(this.tb.run('remove_item', { id: target.id }));
  }

  private move(rest: string): void {
    const { object, relation, ref, wallId } = parsePlacement(rest);
    this.understood++;
    const target = this.target(object);
    if (!target) {
      this.problems.push(object ? `No encontré "${object}" en el cuarto` : 'Dime qué quieres mover');
      return;
    }
    let nearId: string | undefined;
    if (ref) {
      const near = this.findPlacement(ref, target.id);
      if (!near) {
        this.problems.push(`No encontré "${ref}" en el cuarto`);
        return;
      }
      nearId = near.id;
    }
    const rel = relation ?? (nearId ? 'next-to' : wallId ? 'against-wall' : null);
    if (!rel) {
      this.problems.push('Dime a dónde moverlo: "junto a la cama", "contra la pared del fondo", "al centro"...');
      return;
    }
    this.record(this.tb.run('move_item', { id: target.id, relation: rel, ...(nearId ? { nearId } : {}), ...(wallId ? { wallId } : {}) }), target.id);
  }

  private rotate(rest: string): void {
    const deg = /(-?\d+)\s*(?:grados|°|deg)/.exec(rest);
    const object = rest.replace(/(-?\d+)\s*(?:grados|°|deg)/, '').replace(/\b(?:a la|hacia la)?\s*(?:izquierda|derecha)\b/, '').trim();
    this.understood++;
    const target = this.target(object);
    if (!target) {
      this.problems.push(object ? `No encontré "${object}" en el cuarto` : 'Dime qué quieres girar');
      return;
    }
    const sign = /\bderecha\b/.test(rest) ? -1 : 1;
    const degrees = deg ? Number(deg[1]) : /\bmedia vuelta|voltea\b/.test(rest) ? 180 : 90;
    this.record(this.tb.run('rotate_item', { id: target.id, degrees: sign * degrees }), target.id);
  }

  private resize(text: string, factor: number): void {
    const verbRe = factor > 1 ? VERBS.bigger : VERBS.smaller;
    const object = strip(text, verbRe)
      .replace(/\b(?:haz|hazlo|hazla|que sea|mas (?:grande|pequen[oa]|chic[oa]))\b/g, ' ')
      .replace(/\b(?:un|en un)?\s*\d+\s*%/, ' ')
      .replace(/\ba?\s*\d+(?:\.\d+)?\s*(?:cm|m)\b.*$/, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    this.understood++;
    const target = this.target(object);
    if (!target) {
      this.problems.push(object ? `No encontré "${object}" en el cuarto` : 'Dime qué pieza cambiar de tamaño');
      return;
    }
    const item = this.tb.itemOf(target);
    if (!item) return;
    const d = target.dimensionsM ?? item.dimensionsM;
    const pct = /(\d+)\s*%/.exec(text);
    const f = pct ? (factor > 1 ? 1 + Number(pct[1]) / 100 : 1 - Number(pct[1]) / 100) : factor;
    const exact = /(\d+(?:\.\d+)?)\s*(cm|m)\b(?:\s*de\s*(ancho|largo|alto|fondo|profundidad))?/.exec(text);
    let input: Record<string, number>;
    if (exact) {
      const v = exact[2] === 'cm' ? Number(exact[1]) : Number(exact[1]) * 100;
      const axis = exact[3] === 'alto' ? 'heightCm' : exact[3] === 'fondo' || exact[3] === 'profundidad' ? 'depthCm' : 'widthCm';
      input = { [axis]: v };
    } else {
      input = { widthCm: d.x * 100 * f, depthCm: d.z * 100 * (item.mount === 'wall' ? 1 : f) };
      if (item.mount === 'wall') input['heightCm'] = d.y * 100 * f;
    }
    this.record(this.tb.run('resize_item', { id: target.id, ...input }), target.id);
  }

  private furnitureMaterial(text: string): boolean {
    const m = /^(?:\S+)\s+(.+?)\s+(?:de|en|con)\s+(.+)$/.exec(text);
    if (!m) return false;
    const target = this.target(m[1]!);
    if (!target) return false;
    const item = this.tb.itemOf(target);
    const mat = matchMaterial(m[2]!);
    this.understood++;
    if (!item?.materialSlots?.length) {
      this.problems.push(`${item?.name ?? 'Esa pieza'} no tiene partes personalizables`);
      return true;
    }
    if (!mat) {
      this.problems.push(`No reconocí el material "${m[2]}"`);
      return true;
    }
    // La primera parte que admita ese tipo de material (tapizado para telas, patas para metal...).
    const slot = item.materialSlots.find((s) => s.allowedKinds.includes(mat.kind));
    if (!slot) {
      this.problems.push(`${item.name} no admite ${mat.name.toLowerCase()}`);
      return true;
    }
    this.record(this.tb.run('set_material', { id: target.id, slot: slot.slot, materialId: mat.id }), target.id);
    return true;
  }

  // ------------------------------------------------------------------ búsqueda de cosas
  private findCatalogItem(text: string): CatalogItem | null {
    return searchCatalog(this.tb.catalog, { q: text })[0]?.item ?? null;
  }

  /** La pieza del cuarto que mejor encaja con el texto ("la cama", "el sofá gris"). */
  private findPlacement(text: string, excludeId?: string): FurniturePlacement | null {
    const candidates = this.tb.scenePlacements.filter((p) => p.id !== excludeId);
    const items = new Map<string, CatalogItem>();
    for (const p of candidates) {
      const it = this.tb.itemOf(p);
      if (it) items.set(it.id, it);
    }
    const best = searchCatalog([...items.values()], { q: text })[0]?.item;
    if (!best) return null;
    // Si hay varias iguales, la última que se agregó o tocó.
    const same = candidates.filter((p) => p.catalogItemId === best.id);
    return same.find((p) => p.id === this.lastId) ?? same[same.length - 1] ?? null;
  }
}

function strip(text: string, verbRe: RegExp): string {
  return text.replace(verbRe, '').trim();
}

/** "dos sillas frente al escritorio" → { count: 2, object: 'sillas', relation: 'in-front-of', ref: 'escritorio' }. */
export function parsePlacement(rest: string): { count: number; object: string; relation: Relation | null; ref: string; wallId: string | undefined } {
  let relation: Relation | null = null;
  let object = rest;
  let ref = '';
  let firstAt = Infinity;
  for (const [re, rel] of RELATION_PHRASES) {
    const m = re.exec(rest);
    if (m && m.index < firstAt) {
      firstAt = m.index;
      relation = rel;
      object = rest.slice(0, m.index);
      ref = rest.slice(m.index + m[0].length);
    }
  }
  let wallId: string | undefined;
  if (relation === 'against-wall') {
    wallId = WALL_WORDS.find(([r]) => r.test(ref))?.[1];
    ref = '';
  }
  if (relation === 'center') ref = '';
  ref = ref.replace(FILLER, '').trim();
  object = object.trim();
  const qty = /^(\d+|un|una|dos|tres|cuatro|par de)\s+/.exec(object);
  let count = 1;
  if (qty) {
    const word = qty[1]!.replace(' de', '');
    count = Math.min(4, Math.max(1, Number(word) || NUMBER_WORDS[word] || 1));
  }
  object = object.replace(/^(?:\d+|un|una|dos|tres|cuatro|par de)\s+/, '').replace(FILLER, '').trim();
  return { count, object: normalizeText(object), relation, ref: normalizeText(ref), wallId };
}

function matchAlias(text: string, aliases: [RegExp, string][], surface: 'floor' | 'wall' | 'ceiling'): string | null {
  const allowed = new Set(materialsForSurface(surface).map((m) => m.id));
  // Primero el nombre exacto de un material ("verde salvia"), luego los alias.
  const byName = MATERIALS.find((m) => allowed.has(m.id) && text.includes(fold(m.name)));
  if (byName) return byName.id;
  return aliases.find(([re, id]) => allowed.has(id) && re.test(text))?.[1] ?? null;
}

function matchMaterial(text: string) {
  const t = fold(text);
  const exact = MATERIALS.find((m) => t.includes(fold(m.name)));
  if (exact) return exact;
  const words = t.split(' ').filter((w) => w.length > 3);
  return MATERIALS.find((m) => words.some((w) => fold(m.name).split(' ').includes(w))) ?? null;
}
