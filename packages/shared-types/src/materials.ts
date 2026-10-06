/**
 * Biblioteca de materiales PBR compartida (web para renderizar, API para validar y para la
 * lista de compras). Los acabados del cuarto y los slots de cada mueble guardan solo el `id`.
 */
import type { MaterialKind, RoomFinishes, StyleId, WallSegment } from './domain.js';

export interface MaterialDefinition {
  id: string;
  name: string;
  kind: MaterialKind;
  /** Color base (hex sRGB). */
  color: string;
  roughness: number;
  metalness: number;
  /** Textura opcional (ruta relativa servida por la web); sin ella se usa el color plano. */
  texture?: string;
  /** ¿Sirve como acabado de piso, pared o techo? */
  surfaces?: readonly ('floor' | 'wall' | 'ceiling')[];
}

const m = (
  id: string,
  name: string,
  kind: MaterialKind,
  color: string,
  roughness: number,
  metalness = 0,
  surfaces?: MaterialDefinition['surfaces'],
): MaterialDefinition => ({ id, name, kind, color, roughness, metalness, ...(surfaces ? { surfaces } : {}) });

const FLOOR = ['floor'] as const;
const WALL_CEILING = ['wall', 'ceiling'] as const;

export const MATERIALS: readonly MaterialDefinition[] = [
  // Telas
  m('fabric-linen-sand', 'Lino arena', 'fabric', '#d8cbb3', 0.95),
  m('fabric-linen-white', 'Lino blanco', 'fabric', '#efebe3', 0.95),
  m('fabric-wool-grey', 'Lana gris', 'fabric', '#8d8f91', 0.98),
  m('fabric-velvet-green', 'Terciopelo verde', 'fabric', '#2f5d50', 0.8),
  m('fabric-velvet-blue', 'Terciopelo azul', 'fabric', '#2b3f66', 0.8),
  m('fabric-boucle-cream', 'Bouclé crema', 'fabric', '#ece4d4', 1),
  m('fabric-terracotta', 'Tela terracota', 'fabric', '#b5603f', 0.95),
  m('fabric-charcoal', 'Tela carbón', 'fabric', '#3a3b3d', 0.95),
  m('fabric-mustard', 'Tela mostaza', 'fabric', '#c9962e', 0.95),
  // Cueros
  m('leather-cognac', 'Cuero coñac', 'leather', '#8a4b2a', 0.55),
  m('leather-black', 'Cuero negro', 'leather', '#1f1d1c', 0.5),
  // Maderas (también pisos)
  m('wood-oak', 'Roble claro', 'wood', '#c8a97e', 0.7, 0, FLOOR),
  m('wood-walnut', 'Nogal', 'wood', '#6b4a33', 0.65, 0, FLOOR),
  m('wood-ash-white', 'Fresno blanqueado', 'wood', '#e3d8c6', 0.7, 0, FLOOR),
  m('wood-teak', 'Teca', 'wood', '#9a6a3f', 0.65, 0, FLOOR),
  m('wood-black', 'Madera negra', 'wood', '#2a2522', 0.6),
  // Metales
  m('metal-black', 'Acero negro', 'metal', '#232323', 0.45, 0.9),
  m('metal-brass', 'Latón', 'metal', '#b5944b', 0.3, 1),
  m('metal-chrome', 'Cromo', 'metal', '#d6d8da', 0.15, 1),
  m('metal-white', 'Metal blanco', 'metal', '#ecebe8', 0.5, 0.6),
  // Piedras y cerámicas (también pisos)
  m('stone-marble-white', 'Mármol blanco', 'stone', '#ebe8e2', 0.25, 0, FLOOR),
  m('stone-travertine', 'Travertino', 'stone', '#d6c4a4', 0.6, 0, FLOOR),
  m('stone-microcement', 'Microcemento', 'stone', '#b9b5ae', 0.8, 0, FLOOR),
  m('ceramic-white', 'Cerámica blanca', 'ceramic', '#f4f3ef', 0.3, 0, FLOOR),
  m('ceramic-terracotta', 'Baldosa terracota', 'ceramic', '#b8653f', 0.75, 0, FLOOR),
  m('ceramic-grey-tile', 'Porcelanato gris', 'ceramic', '#9c9b97', 0.5, 0, FLOOR),
  // Vidrio, plástico, plantas
  m('glass-clear', 'Vidrio', 'glass', '#dfe9ec', 0.05),
  m('glass-smoked', 'Vidrio ahumado', 'glass', '#5d5e5c', 0.05),
  m('plastic-white', 'Plástico blanco', 'plastic', '#f2f2f0', 0.5),
  m('plastic-black', 'Plástico negro', 'plastic', '#1d1d1d', 0.5),
  m('plant-green', 'Follaje', 'plant', '#4f7a3a', 0.85),
  // Pinturas (paredes y techo)
  m('paint-white', 'Blanco cálido', 'paint', '#f4f1ea', 0.9, 0, WALL_CEILING),
  m('paint-greige', 'Greige', 'paint', '#d5cdc0', 0.9, 0, WALL_CEILING),
  m('paint-sage', 'Verde salvia', 'paint', '#a9b49c', 0.9, 0, WALL_CEILING),
  m('paint-terracotta', 'Terracota', 'paint', '#c27b5c', 0.9, 0, WALL_CEILING),
  m('paint-navy', 'Azul marino', 'paint', '#2f3e57', 0.9, 0, WALL_CEILING),
  m('paint-charcoal', 'Gris carbón', 'paint', '#4a4a4a', 0.9, 0, WALL_CEILING),
  m('paint-blush', 'Rosa empolvado', 'paint', '#e2c4bb', 0.9, 0, WALL_CEILING),
  m('paint-brick', 'Ladrillo visto', 'paint', '#94553f', 0.95, 0, ['wall']),
];

const BY_ID = new Map(MATERIALS.map((mat) => [mat.id, mat]));

export function getMaterial(id: string): MaterialDefinition | undefined {
  return BY_ID.get(id);
}

export function materialsOfKinds(kinds: readonly MaterialKind[]): MaterialDefinition[] {
  return MATERIALS.filter((mat) => kinds.includes(mat.kind));
}

export function materialsForSurface(surface: 'floor' | 'wall' | 'ceiling'): MaterialDefinition[] {
  return MATERIALS.filter((mat) => mat.surfaces?.includes(surface));
}

/** Acabados neutros: los que se usan si el proyecto no tiene ni acabados ni estilo. */
export const DEFAULT_FINISHES: RoomFinishes = { floor: 'wood-oak', walls: { all: 'paint-white' }, ceiling: 'paint-white' };

/** Paleta de acabados de cada estilo (botón "aplicar paleta del estilo"). */
export const STYLE_FINISHES: Record<StyleId, RoomFinishes> = {
  escandinavo: { floor: 'wood-ash-white', walls: { all: 'paint-white' }, ceiling: 'paint-white' },
  minimalista: { floor: 'stone-microcement', walls: { all: 'paint-white' }, ceiling: 'paint-white' },
  industrial: { floor: 'stone-microcement', walls: { all: 'paint-charcoal', 'w-back': 'paint-brick' }, ceiling: 'paint-charcoal' },
  bohemio: { floor: 'ceramic-terracotta', walls: { all: 'paint-greige', 'w-back': 'paint-terracotta' }, ceiling: 'paint-white' },
  moderno: { floor: 'ceramic-grey-tile', walls: { all: 'paint-white', 'w-back': 'paint-navy' }, ceiling: 'paint-white' },
  clasico: { floor: 'wood-walnut', walls: { all: 'paint-greige' }, ceiling: 'paint-white' },
};

export function finishesForStyle(styleId: StyleId | null): RoomFinishes {
  return styleId ? STYLE_FINISHES[styleId] : DEFAULT_FINISHES;
}

/** Material efectivo de una pared: el suyo propio o, si no tiene, el de 'all'. */
export function wallMaterialId(finishes: RoomFinishes, wall: Pick<WallSegment, 'id'>): string {
  return finishes.walls[wall.id] ?? finishes.walls['all'] ?? DEFAULT_FINISHES.walls['all']!;
}

export class UnknownMaterialError extends Error {}

const SURFACE_LABELS = { floor: 'piso', wall: 'pared', ceiling: 'techo' } as const;

/**
 * Valida que todos los ids existan y que cada superficie use un material apto para ella.
 * Lanza `UnknownMaterialError` con un mensaje para el usuario.
 */
export function assertValidFinishes(finishes: RoomFinishes): void {
  const check = (id: string, surface: 'floor' | 'wall' | 'ceiling') => {
    const mat = getMaterial(id);
    if (!mat) throw new UnknownMaterialError(`Material desconocido: ${id}`);
    if (!mat.surfaces?.includes(surface)) {
      throw new UnknownMaterialError(`"${mat.name}" no sirve como acabado de ${SURFACE_LABELS[surface]}`);
    }
  };
  check(finishes.floor, 'floor');
  check(finishes.ceiling, 'ceiling');
  for (const id of Object.values(finishes.walls)) check(id, 'wall');
}
