import {
  bathroomPreset,
  customFinishId,
  type DesignBrief,
  type FinishPin,
  type Lighting,
  resolveFinishMaterial,
  type RoomFinishes,
  STYLES,
  type StyleId,
  type ZoneKind,
} from '@interiores/shared-types';

/**
 * El Brief en la interfaz: cada cosa pedida es un chip con su candado. Funciones puras; el panel
 * solo las pinta y guarda el Brief que devuelven.
 */
export type SurfaceKey = 'floor' | 'walls' | 'ceiling' | 'wallTiles';

export interface BriefChip {
  key: string;
  /** Qué es: "Piso", "Estilo", "Quiero", "Sin"... */
  label: string;
  /** El valor en palabras: "Baldosa azul y verde", "Escandinavo". */
  detail: string;
  /** null = no se fija ni se suelta (lo que se pide o se veta siempre cuenta). */
  locked: boolean | null;
  swatches: string[];
}

export const SURFACE_LABELS: Record<SurfaceKey, string> = { floor: 'Piso', walls: 'Paredes', ceiling: 'Techo', wallTiles: 'Revestimiento' };
export const ZONE_LABELS: Record<ZoneKind, string> = { bathroom: 'Baño privado', closet: 'Vestidor', vanity: 'Zona de tocador', 'office-nook': 'Rincón de estudio' };
const MOOD_LABELS: Record<Lighting['mood'], string> = { calida: 'cálida', neutra: 'neutra', fria: 'fría' };
const LEVEL_LABELS: Record<Lighting['level'], string> = { tenue: 'tenue', media: 'media', alta: 'alta' };

export const SUBCATEGORY_LABELS: Record<string, string> = {
  armchair: 'Sillón',
  bathtub: 'Bañera',
  bidet: 'Bidé',
  'coffee-table': 'Mesa de centro',
  curtains: 'Cortinas',
  desk: 'Escritorio',
  'dining-table': 'Mesa de comedor',
  dresser: 'Cómoda',
  'dressing-table': 'Tocador de maquillaje',
  'floor-lamp': 'Lámpara de pie',
  'led-strip': 'Tira LED',
  mirror: 'Espejo',
  nightstand: 'Mesita de noche',
  plant: 'Plantas',
  pendant: 'Lámpara colgante',
  rug: 'Alfombra',
  shelf: 'Estantería',
  shower: 'Ducha',
  'shower-screen': 'Mampara',
  'side-table': 'Mesa auxiliar',
  'towel-rail': 'Toallero',
  tv: 'Televisor',
  'wall-art': 'Cuadros',
  wardrobe: 'Armario',
};

export const subcategoryLabel = (sub: string): string => SUBCATEGORY_LABELS[sub] ?? sub;

export const emptyBrief = (): DesignBrief => ({ surfaces: {}, mustHave: [], avoid: [], zones: [] });

function pinDetail(pin: FinishPin): { detail: string; swatches: string[] } {
  if (pin.spec) return { detail: pin.spec.name, swatches: pin.spec.colors };
  const mat = pin.material ? resolveFinishMaterial(null, pin.material) : undefined;
  return { detail: mat?.name ?? pin.material ?? '', swatches: mat ? [mat.color] : [] };
}

export function briefChips(brief: DesignBrief | null): BriefChip[] {
  if (!brief) return [];
  const chips: BriefChip[] = [];
  if (brief.style) chips.push({ key: 'style', label: 'Estilo', detail: STYLES[brief.style.id].label, locked: brief.style.locked, swatches: [] });
  for (const key of ['floor', 'walls', 'ceiling', 'wallTiles'] as const) {
    const pin = brief.surfaces[key];
    if (pin) chips.push({ key: `surface:${key}`, label: SURFACE_LABELS[key], ...pinDetail(pin), locked: pin.locked });
  }
  if (brief.palette) chips.push({ key: 'palette', label: 'Colores', detail: `${brief.palette.colors.length} colores`, locked: brief.palette.locked, swatches: brief.palette.colors });
  if (brief.lighting) {
    const { mood, level, locked } = brief.lighting;
    chips.push({ key: 'lighting', label: 'Luz', detail: `${MOOD_LABELS[mood]}, ${LEVEL_LABELS[level]}`, locked, swatches: [] });
  }
  brief.zones.forEach((z, i) => {
    const preset = z.preset ? bathroomPreset(z.preset)?.label : undefined;
    chips.push({ key: `zone:${i}`, label: ZONE_LABELS[z.kind], detail: preset ?? 'como venga', locked: null, swatches: [] });
  });
  brief.mustHave.forEach((m, i) =>
    chips.push({ key: `must:${i}`, label: 'Quiero', detail: subcategoryLabel(m.subcategory) + (m.zoneKind ? ` (${ZONE_LABELS[m.zoneKind].toLowerCase()})` : ''), locked: null, swatches: [] }),
  );
  brief.avoid.forEach((a, i) => chips.push({ key: `avoid:${i}`, label: 'Sin', detail: subcategoryLabel(a), locked: null, swatches: [] }));
  return chips;
}

/** Fija o suelta el candado de un chip. Lo que no tiene candado queda igual. */
export function toggleLock(brief: DesignBrief, key: string): DesignBrief {
  const next = structuredClone(brief);
  if (key === 'style' && next.style) next.style.locked = !next.style.locked;
  else if (key === 'palette' && next.palette) next.palette.locked = !next.palette.locked;
  else if (key === 'lighting' && next.lighting) next.lighting.locked = !next.lighting.locked;
  else if (key.startsWith('surface:')) {
    const pin = next.surfaces[key.slice(8) as SurfaceKey];
    if (pin) pin.locked = !pin.locked;
  }
  return next;
}

/** Quita un chip del Brief. */
export function removeChip(brief: DesignBrief, key: string): DesignBrief {
  const next = structuredClone(brief);
  const [kind, rest] = key.split(':') as [string, string | undefined];
  const index = Number(rest);
  if (kind === 'style') delete next.style;
  else if (kind === 'palette') delete next.palette;
  else if (kind === 'lighting') delete next.lighting;
  else if (kind === 'surface') delete next.surfaces[rest as SurfaceKey];
  else if (kind === 'must') next.mustHave.splice(index, 1);
  else if (kind === 'avoid') next.avoid.splice(index, 1);
  else if (kind === 'zone') next.zones.splice(index, 1);
  return next;
}

/** Fija una superficie tal como está ahora en el cuarto (con su acabado propio, si lo es). */
export function pinSurface(brief: DesignBrief | null, surface: SurfaceKey, finishes: RoomFinishes | null): DesignBrief {
  const next = structuredClone(brief ?? emptyBrief());
  if (!finishes) return next;
  const id = surface === 'walls' ? finishes.walls['all'] : surface === 'wallTiles' ? finishes.wallTiles?.material : finishes[surface];
  if (!id) return next;
  const spec = finishes.custom?.[id];
  next.surfaces[surface] = spec && customFinishId(spec) === id ? { spec, locked: true } : { material: id, locked: true };
  return next;
}

export function pinStyle(brief: DesignBrief | null, styleId: StyleId): DesignBrief {
  return { ...structuredClone(brief ?? emptyBrief()), style: { id: styleId, locked: true } };
}

export function pinLighting(brief: DesignBrief | null, lighting: Lighting): DesignBrief {
  return { ...structuredClone(brief ?? emptyBrief()), lighting: { ...lighting, locked: true } };
}

/** "Quiero un tocador" / "Sin alfombras": una lista sin repetidos, y lo uno quita lo otro. */
export function wish(brief: DesignBrief | null, subcategory: string, kind: 'want' | 'avoid'): DesignBrief {
  const next = structuredClone(brief ?? emptyBrief());
  next.mustHave = next.mustHave.filter((m) => m.subcategory !== subcategory || m.zoneKind);
  next.avoid = next.avoid.filter((a) => a !== subcategory);
  if (kind === 'want') next.mustHave.push({ subcategory });
  else next.avoid.push(subcategory);
  return next;
}

/** ¿Hay algo fijado de verdad? (con candado cerrado). */
export const hasLocks = (brief: DesignBrief | null): boolean => briefChips(brief).some((c) => c.locked === true);
