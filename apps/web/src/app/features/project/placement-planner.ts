/**
 * Dónde poner un mueble recién añadido según su montaje (lógica pura, sin Angular):
 * - piso / techo: hueco libre más cercano al centro (espiral);
 * - pared: contra la primera pared con espacio, mirando hacia el cuarto, a su altura por defecto;
 * - superficie: encima del mueble más apropiado (lámpara → mesa de noche, TV → mueble TV...).
 */
import {
  effectiveDimensions,
  mountY,
  type CatalogItem,
  type FurniturePlacement,
  type RoomShell,
  type Vector3,
} from '@interiores/shared-types';

export interface PlacementPlan {
  position: Vector3;
  rotationY: number;
  wallId?: string;
  elevationM?: number;
  supportId?: string;
}

export interface PlannerContext {
  shell: RoomShell;
  placements: readonly FurniturePlacement[];
  catalog: ReadonlyMap<string, CatalogItem>;
  /** Validador de colisiones del store (mismas reglas de capas que al arrastrar). */
  isPoseValid: (id: string, item: CatalogItem, position: Vector3, rotationY: number) => boolean;
  /** Hueco libre en el piso o el techo (espiral desde el centro). */
  findFreeSpot: (id: string, item: CatalogItem, near: Vector3, rotationY: number) => Vector3 | null;
}

/** Cara interior de cada pared: hacia dónde mira un objeto colgado en ella. */
function wallFrames(shell: RoomShell): { id: string; rotationY: number; along: 'x' | 'z'; fixed: number; length: number; inward: number }[] {
  return [
    { id: 'w-back', rotationY: 0, along: 'x', fixed: 0, length: shell.widthM, inward: 1 },
    { id: 'w-left', rotationY: Math.PI / 2, along: 'z', fixed: 0, length: shell.depthM, inward: 1 },
    { id: 'w-right', rotationY: -Math.PI / 2, along: 'z', fixed: shell.widthM, length: shell.depthM, inward: -1 },
    { id: 'w-front', rotationY: Math.PI, along: 'x', fixed: shell.depthM, length: shell.widthM, inward: -1 },
  ];
}

/** Qué soportes prefiere cada tipo de objeto (de más a menos apropiado). */
const SUPPORT_PREFERENCE: Record<string, string[]> = {
  'table-lamp': ['nightstand', 'side-table', 'desk', 'dresser', 'sideboard'],
  'desk-lamp': ['desk', 'nightstand'],
  tv: ['tv-stand', 'sideboard', 'dresser'],
  books: ['coffee-table', 'shelf', 'nightstand', 'desk'],
  vase: ['dining-table', 'coffee-table', 'sideboard', 'side-table'],
  plant: ['side-table', 'sideboard', 'coffee-table', 'desk'],
  cushion: ['sofa', 'armchair', 'bed'],
};

function planWall(id: string, item: CatalogItem, ctx: PlannerContext): PlacementPlan | null {
  const dims = item.dimensionsM;
  const elevationM = item.elevationDefaultM;
  const y = mountY('wall', dims, ctx.shell, { elevationDefaultM: elevationM });
  for (const wall of wallFrames(ctx.shell)) {
    if (!ctx.shell.walls.some((w) => w.id === wall.id)) continue;
    const half = dims.x / 2;
    if (wall.length < dims.x) continue;
    // Desde el centro de la pared hacia los extremos, en pasos de 25 cm.
    const center = wall.length / 2;
    const offsets = [0];
    for (let k = 0.25; k <= center - half; k += 0.25) offsets.push(k, -k);
    for (const off of offsets) {
      const t = Math.min(wall.length - half, Math.max(half, center + off));
      const depthOffset = wall.fixed + wall.inward * (dims.z / 2 + 0.001);
      const position = wall.along === 'x' ? { x: t, y, z: depthOffset } : { x: depthOffset, y, z: t };
      if (ctx.isPoseValid(id, item, position, wall.rotationY)) {
        return { position, rotationY: wall.rotationY, wallId: wall.id, ...(elevationM !== undefined ? { elevationM: y } : {}) };
      }
    }
  }
  return null;
}

function planSurface(id: string, item: CatalogItem, ctx: PlannerContext): PlacementPlan | null {
  const prefs = SUPPORT_PREFERENCE[item.subcategory ?? ''] ?? [];
  const rank = (sub: string | undefined, category: string) => {
    const i = prefs.indexOf(sub ?? category);
    return i === -1 ? prefs.length + 1 : i;
  };
  const candidates = ctx.placements
    .map((p) => ({ p, item: ctx.catalog.get(p.catalogItemId) }))
    .filter((c): c is { p: FurniturePlacement; item: CatalogItem } => !!c.item && (c.item.mount === 'floor' || c.item.mount === undefined))
    .filter((c) => ['table', 'storage', 'sofa', 'chair', 'bed', 'kitchen', 'bathroom'].includes(c.item.category))
    .map((c) => ({ ...c, dims: effectiveDimensions(c.item.dimensionsM, c.p) }))
    // El objeto tiene que caber encima y el soporte no puede ser más alto que una persona.
    .filter((c) => c.dims.x >= item.dimensionsM.x * 0.9 && c.dims.z >= item.dimensionsM.z * 0.9 && c.dims.y < 1.3)
    // Sin otro objeto de superficie ya encima (que no se apilen dos lámparas en la misma mesa).
    .filter((c) => !ctx.placements.some((o) => o.supportId === c.p.id))
    .sort((a, b) => rank(a.item.subcategory, a.item.category) - rank(b.item.subcategory, b.item.category) || b.dims.x * b.dims.z - a.dims.x * a.dims.z);
  const best = candidates[0];
  if (!best) return null;
  if (prefs.length && rank(best.item.subcategory, best.item.category) > prefs.length) {
    // Ningún soporte apropiado (p. ej. una TV sin mueble TV): mejor en el piso que encima de la cama.
    if (item.subcategory === 'tv' || item.subcategory === 'cushion') return null;
  }
  return {
    position: { x: best.p.position.x, y: best.p.position.y + best.dims.y, z: best.p.position.z },
    rotationY: best.p.rotationY,
    supportId: best.p.id,
  };
}

export function planPlacement(id: string, item: CatalogItem, ctx: PlannerContext): PlacementPlan | null {
  if (item.mount === 'wall') return planWall(id, item, ctx);
  if (item.mount === 'surface') {
    const onTop = planSurface(id, item, ctx);
    if (onTop) return onTop;
    // Sin soporte: va al piso (luego el usuario lo sube a un mueble).
  }
  const near = { x: ctx.shell.widthM / 2, y: mountY(item.mount, item.dimensionsM, ctx.shell), z: ctx.shell.depthM / 2 };
  const position = ctx.findFreeSpot(id, item, near, 0);
  return position ? { position, rotationY: 0 } : null;
}

