/**
 * "Recomendar": una propuesta completa (estilo, paleta, acabados, luz) que respeta lo que la
 * persona fijó en su Brief. Lo fijado (`locked`) no cambia entre propuestas; lo demás se sortea
 * con la semilla, con armonías de color y materiales que encajan con el estilo. Funciones puras.
 *
 * Cada propuesta lleva sus rasgos (`features`): con ellos el modelo de preferencias aprende qué
 * gusta (👍/👎) y elige entre varias candidatas. Sin modelo se usa `priorScore`.
 */
import type { DesignBrief, FinishPin, Lighting, RoomFinishes, RoomShell, StyleId } from './domain.js';
import { LIGHT_MOODS, STYLE_IDS } from './domain.js';
import { customFinishId } from './finish-spec.js';
import { DEFAULT_FINISHES, materialsForSurface, resolveFinishMaterial, type MaterialDefinition } from './materials.js';
import { HARMONIES, harmonize, hexToHsl, paletteFeatures, seededRandom, type Harmony, type Palette } from './palette.js';
import { STYLES } from './styles.js';
import { BATHROOM_PRESETS } from './zone-presets.js';

export type RecommendIntensity = 'suave' | 'total';

export interface RecommendInput {
  brief: DesignBrief | null;
  finishes: RoomFinishes | null;
  styleId: StyleId | null;
  shell: Pick<RoomShell, 'walls' | 'zones'>;
  seed: number;
  /** Estilos de las últimas propuestas: no se repiten mientras haya otros. */
  recentStyles?: readonly StyleId[];
  /** 'suave' conserva el estilo actual; 'total' puede cambiarlo todo lo no fijado. */
  intensity?: RecommendIntensity;
}

export interface Proposal {
  seed: number;
  styleId: StyleId;
  palette: Palette;
  finishes: RoomFinishes;
  lighting: Lighting;
  features: Record<string, number>;
}

/** Familias de piso que encajan con cada estilo (en orden de preferencia). */
const STYLE_FLOORS: Record<StyleId, readonly MaterialDefinition['kind'][]> = {
  escandinavo: ['wood'],
  minimalista: ['stone', 'ceramic', 'wood'],
  industrial: ['stone', 'wood'],
  bohemio: ['ceramic', 'wood'],
  moderno: ['ceramic', 'stone', 'wood'],
  clasico: ['wood', 'stone'],
};

/** Probabilidad de una pared de acento según el estilo. */
const ACCENT_CHANCE: Record<StyleId, number> = { escandinavo: 0.25, minimalista: 0.1, industrial: 0.7, bohemio: 0.6, moderno: 0.6, clasico: 0.3 };

const STYLE_MOODS: Record<StyleId, readonly Lighting['mood'][]> = {
  escandinavo: ['calida', 'neutra'],
  minimalista: ['neutra', 'fria'],
  industrial: ['calida', 'neutra'],
  bohemio: ['calida'],
  moderno: ['neutra', 'fria', 'calida'],
  clasico: ['calida'],
};

const STYLE_BATHS: Record<StyleId, readonly string[]> = {
  escandinavo: ['ducha-obra', 'banera-mampara'],
  minimalista: ['ducha-obra', 'spa-marmol'],
  industrial: ['industrial'],
  bohemio: ['banera-mampara', 'ducha-obra'],
  moderno: ['ducha-obra', 'industrial', 'spa-marmol'],
  clasico: ['spa-marmol', 'banera-mampara'],
};

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length) % list.length]!;

/** Distancia simple entre colores (HSL ponderado): basta para ordenar candidatos. */
function distance(a: string, b: string): number {
  const x = hexToHsl(a);
  const y = hexToHsl(b);
  const dh = Math.min(Math.abs(x.h - y.h), 360 - Math.abs(x.h - y.h)) / 180;
  return Math.hypot(dh * Math.min(x.s, y.s) * 2, (x.s - y.s) * 0.8, (x.l - y.l) * 1.6);
}

/** Uno de los tres materiales más cercanos al color (no siempre el mismo: da variedad). */
function nearOne(pool: readonly MaterialDefinition[], hex: string, rand: () => number, spread = 3): MaterialDefinition {
  const sorted = [...pool].sort((a, b) => distance(a.color, hex) - distance(b.color, hex));
  return sorted[Math.floor(rand() * Math.min(spread, sorted.length))] ?? sorted[0]!;
}

/** Lo que un candado deja escrito en los acabados: un id de la biblioteca o uno propio con su descripción. */
function pinned(pin: FinishPin | undefined, custom: NonNullable<RoomFinishes['custom']>): string | null {
  if (!pin?.locked) return null;
  if (pin.material) return pin.material;
  if (pin.spec) {
    const id = customFinishId(pin.spec);
    custom[id] = pin.spec;
    return id;
  }
  return null;
}

/** Colores que la persona fijó (acabados propios, paleta): anclan la armonía. */
function anchorColors(brief: DesignBrief | null, finishes: RoomFinishes): string[] {
  const out: string[] = [];
  if (brief?.palette?.locked) out.push(...brief.palette.colors);
  for (const pin of Object.values(brief?.surfaces ?? {})) {
    if (!pin?.locked) continue;
    if (pin.spec) out.push(...pin.spec.colors);
    else if (pin.material) {
      const def = resolveFinishMaterial(finishes, pin.material);
      if (def) out.push(def.color);
    }
  }
  return out;
}

/** La pared que mejor luce un acento: la del fondo si existe; si no, la más larga. */
function accentWall(shell: Pick<RoomShell, 'walls'>): string | null {
  if (shell.walls.some((w) => w.id === 'w-back')) return 'w-back';
  const longest = [...shell.walls].sort((a, b) => Math.hypot(b.end.x - b.start.x, b.end.z - b.start.z) - Math.hypot(a.end.x - a.start.x, a.end.z - a.start.z))[0];
  return longest?.id ?? null;
}

/** Una propuesta para la semilla dada. */
export function propose(input: RecommendInput): Proposal {
  const rand = seededRandom(input.seed);
  const brief = input.brief;
  const current = input.finishes ?? DEFAULT_FINISHES;
  const intensity = input.intensity ?? 'total';

  // 1. Estilo.
  let styleId: StyleId;
  if (brief?.style?.locked) styleId = brief.style.id;
  else if (intensity === 'suave' && input.styleId) styleId = input.styleId;
  else {
    const recent = new Set(input.recentStyles ?? []);
    const fresh = STYLE_IDS.filter((s) => !recent.has(s));
    styleId = pick(fresh.length ? fresh : STYLE_IDS, rand);
  }

  // 2. Paleta: la fijada, o una armonía desde lo fijado o desde la del estilo.
  const custom: NonNullable<RoomFinishes['custom']> = {};
  const anchors = anchorColors(brief, current);
  const harmony: Harmony = pick(HARMONIES, rand);
  const palette = harmonize(anchors.length ? anchors : [STYLES[styleId].palette[1], ...STYLES[styleId].palette], harmony, rand);
  if (brief?.palette?.locked) palette.colors.splice(0, brief.palette.colors.length, ...brief.palette.colors);
  const [wallColor, accentColor, floorColor] = palette.colors;

  // 3. Superficies: lo fijado se queda; lo demás encaja con la paleta y el estilo.
  const s = brief?.surfaces ?? {};
  const floorPool = materialsForSurface('floor').filter((m) => STYLE_FLOORS[styleId].includes(m.kind));
  const floor = pinned(s.floor, custom) ?? nearOne(floorPool.length ? floorPool : materialsForSurface('floor'), floorColor, rand).id;
  const paints = materialsForSurface('wall').filter((m) => m.kind === 'paint');
  const lightPaints = paints.filter((m) => hexToHsl(m.color).l > 0.7);
  const wallAll = pinned(s.walls, custom) ?? nearOne(lightPaints, wallColor, rand).id;
  const walls: RoomFinishes['walls'] = { all: wallAll };
  let accent = 0;
  const accentId = accentWall(input.shell);
  if (!s.walls?.locked && accentId && rand() < ACCENT_CHANCE[styleId]) {
    const accentPool = styleId === 'industrial' ? paints.filter((m) => m.id === 'paint-brick' || hexToHsl(m.color).l < 0.5) : paints.filter((m) => m.id !== wallAll);
    walls[accentId] = nearOne(accentPool, accentColor, rand, 2).id;
    accent = 1;
  }
  const ceiling = pinned(s.ceiling, custom) ?? (styleId === 'industrial' && rand() < 0.4 ? 'paint-charcoal' : 'paint-white');
  const tilesPin = pinned(s.wallTiles, custom);
  const wallTiles = tilesPin ? { ...(current.wallTiles ?? { heightM: 1.2 }), material: tilesPin } : current.wallTiles;

  // 4. Zonas: el tipo de baño fijado, o uno que vaya con el estilo.
  const zones: NonNullable<RoomFinishes['zones']> = {};
  for (const zone of input.shell.zones ?? []) {
    if (zone.kind !== 'bathroom') {
      if (current.zones?.[zone.id]) zones[zone.id] = current.zones[zone.id]!;
      continue;
    }
    const wish = brief?.zones?.find((z) => z.kind === 'bathroom');
    const presetId = wish?.preset ?? pick(STYLE_BATHS[styleId], rand);
    const preset = BATHROOM_PRESETS.find((p) => p.id === presetId) ?? BATHROOM_PRESETS[0]!;
    const own = structuredClone(preset.finishes);
    const zFloor = pinned(wish?.floor, custom);
    if (zFloor) own.floor = zFloor;
    const zTiles = pinned(wish?.wallTiles, custom);
    if (zTiles) own.wallTiles = { heightM: own.wallTiles?.heightM ?? 2.1, material: zTiles };
    zones[zone.id] = own;
  }

  // 5. Luz.
  const lighting: Lighting =
    brief?.lighting?.locked
      ? { mood: brief.lighting.mood, level: brief.lighting.level }
      : { mood: pick(STYLE_MOODS[styleId], rand), level: rand() < 0.2 ? 'tenue' : rand() < 0.85 ? 'media' : 'alta' };

  // Los acabados propios que ya usaba el cuarto siguen disponibles (otras superficies los nombran).
  for (const [id, spec] of Object.entries(current.custom ?? {})) {
    if (!custom[id] && [floor, ceiling, ...Object.values(walls), wallTiles?.material].includes(id)) custom[id] = spec;
  }
  const finishes: RoomFinishes = {
    floor,
    walls,
    ceiling,
    ...(Object.keys(custom).length ? { custom } : {}),
    ...(wallTiles ? { wallTiles } : {}),
    ...(Object.keys(zones).length ? { zones } : {}),
    lighting,
  };
  return { seed: input.seed, styleId, palette, finishes, lighting, features: proposalFeatures(styleId, palette, finishes, accent) };
}

/** Rasgos numéricos de una propuesta (one-hot del estilo, la paleta, el piso, la luz). */
export function proposalFeatures(styleId: StyleId, palette: Palette, finishes: RoomFinishes, accent: number): Record<string, number> {
  const f: Record<string, number> = {};
  for (const s of STYLE_IDS) f[`style:${s}`] = s === styleId ? 1 : 0;
  const p = paletteFeatures(palette.colors);
  f['palette:warmth'] = round(p.warmth);
  f['palette:lightness'] = round(p.lightness);
  f['palette:contrast'] = round(p.contrast);
  f['palette:saturation'] = round(p.saturation);
  for (const h of HARMONIES) f[`harmony:${h}`] = palette.harmony === h ? 1 : 0;
  const floor = resolveFinishMaterial(finishes, finishes.floor);
  for (const k of ['wood', 'stone', 'ceramic', 'fabric'] as const) f[`floor:${k}`] = floor?.kind === k ? 1 : 0;
  f['floor:lightness'] = round(floor ? hexToHsl(floor.color).l : 0.5);
  f['walls:accent'] = accent;
  for (const mood of LIGHT_MOODS) f[`light:${mood}`] = finishes.lighting?.mood === mood ? 1 : 0;
  return f;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Nota "de oficio" de una propuesta cuando aún no hay preferencias aprendidas: contraste medio
 * (ni plano ni estridente), piso que el estilo usa de verdad y luz cálida en estilos cálidos.
 */
export function priorScore(p: Proposal): number {
  const f = p.features;
  const contrast = f['palette:contrast'] ?? 0;
  let score = 1 - Math.abs(contrast - 0.45) * 1.5;
  const floor = resolveFinishMaterial(p.finishes, p.finishes.floor);
  if (floor && STYLE_FLOORS[p.styleId][0] === floor.kind) score += 0.4;
  if (STYLE_MOODS[p.styleId][0] === p.lighting.mood) score += 0.2;
  score -= Math.max(0, (f['palette:saturation'] ?? 0) - 0.45);
  return round(score);
}

/** Varias candidatas con semillas derivadas (la primera es la de la semilla pedida). */
export function candidateProposals(input: RecommendInput, count = 6): Proposal[] {
  return Array.from({ length: count }, (_, i) => propose({ ...input, seed: (input.seed + i * 7919) % 2_147_483_647 }));
}

/** La mejor según una nota (por defecto, la de oficio). */
export function bestProposal(candidates: readonly Proposal[], score: (p: Proposal) => number = priorScore): Proposal {
  return candidates.reduce((best, p) => (score(p) > score(best) ? p : best));
}

/** Para la interfaz: qué cambió respecto de lo anterior, en palabras. */
export function describeProposal(p: Proposal): string {
  const floor = resolveFinishMaterial(p.finishes, p.finishes.floor)?.name ?? p.finishes.floor;
  const wall = resolveFinishMaterial(p.finishes, p.finishes.walls['all'] ?? '')?.name ?? '';
  const moods = { calida: 'luz cálida', neutra: 'luz neutra', fria: 'luz fría' } as const;
  return `${STYLES[p.styleId].label}: piso ${floor.toLowerCase()}, paredes ${wall.toLowerCase()}, ${moods[p.lighting.mood]}`;
}
