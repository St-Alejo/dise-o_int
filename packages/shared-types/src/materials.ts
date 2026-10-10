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
  m('paint-pearl', 'Gris perla', 'paint', '#d6d6d4', 0.9, 0, WALL_CEILING),
  m('paint-sand', 'Arena', 'paint', '#e3d3b8', 0.9, 0, WALL_CEILING),
  m('paint-steel-blue', 'Azul acero', 'paint', '#4f73a8', 0.9, 0, WALL_CEILING),
  m('paint-forest', 'Verde bosque', 'paint', '#3f5a47', 0.9, 0, WALL_CEILING),
  m('paint-mustard', 'Mostaza suave', 'paint', '#d9b45a', 0.9, 0, WALL_CEILING),
  m('paint-wine', 'Vino', 'paint', '#5a2328', 0.9, 0, WALL_CEILING),
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

/** Color sRGB en hex → CIE Lab (D65): un espacio donde la distancia se parece a lo que ve el ojo. */
function labOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const linear = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const [r, g, b] = linear;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * Diferencia de color percibida (ΔE en Lab). En RGB, un azul medio queda "más cerca" de un gris
 * oscuro que de un azul marino; en Lab el tono pesa como debe.
 */
function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = labOf(a);
  const [l2, a2, b2] = labOf(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** El material de la biblioteca cuyo color más se parece a `hex` entre los que sirven para esa superficie. */
export function nearestMaterial(surface: 'floor' | 'wall' | 'ceiling', hex: string, kinds?: readonly MaterialKind[]): MaterialDefinition {
  const all = materialsForSurface(surface);
  const pool = kinds ? all.filter((mat) => kinds.includes(mat.kind)) : all;
  return (pool.length ? pool : all).reduce((best, mat) => (colorDistance(mat.color, hex) < colorDistance(best.color, hex) ? mat : best));
}

/** Qué materiales de piso corresponden a lo que un modelo de visión llama madera, baldosa, etc. */
const FLOOR_KINDS: Record<string, readonly MaterialKind[]> = { wood: ['wood'], tile: ['ceramic', 'stone'], concrete: ['stone'] };

/**
 * Acabados parecidos a los de la foto: la pintura y el piso de la biblioteca más cercanos a los
 * colores detectados. El techo queda blanco (casi nunca se ve y casi siempre lo es).
 */
export function finishesFromPhoto(seen: { wallColor?: string | undefined; floorColor?: string | undefined; floorMaterial?: string | undefined }): RoomFinishes | null {
  if (!seen.wallColor && !seen.floorColor) return null;
  const floor = seen.floorColor ? nearestMaterial('floor', seen.floorColor, FLOOR_KINDS[seen.floorMaterial ?? '']).id : DEFAULT_FINISHES.floor;
  const wall = seen.wallColor ? nearestMaterial('wall', seen.wallColor).id : DEFAULT_FINISHES.walls['all']!;
  return { floor, walls: { all: wall }, ceiling: DEFAULT_FINISHES.ceiling };
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
