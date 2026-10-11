import type { ProjectListItem, RoomType } from '@interiores/shared-types';

export type ProjectSort = 'recent' | 'name' | 'area';

export interface ProjectFilter {
  /** Texto del buscador (no distingue mayúsculas ni acentos). */
  query: string;
  roomType: RoomType | 'all';
  sort: ProjectSort;
}

export interface ProjectsSummary {
  total: number;
  /** Proyectos que se borrarán a las 24 h si no se guardan. */
  unsaved: number;
  pieces: number;
  /** Superficie sumada de los cuartos que ya tienen plano. */
  areaM2: number;
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const ORDER: Record<ProjectSort, (a: ProjectListItem, b: ProjectListItem) => number> = {
  recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  name: (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
  area: (a, b) => (b.areaM2 ?? 0) - (a.areaM2 ?? 0),
};

/** Los proyectos que pasan el buscador y el tipo de cuarto, en el orden pedido. No toca la lista original. */
export function filterProjects(projects: readonly ProjectListItem[], filter: ProjectFilter): ProjectListItem[] {
  const query = fold(filter.query.trim());
  return projects
    .filter((p) => (filter.roomType === 'all' || p.roomType === filter.roomType) && (!query || fold(p.name).includes(query)))
    .sort(ORDER[filter.sort]);
}

/** Puntos del contorno de la planta para un `<polygon>`, y el `viewBox` que lo encuadra con un margen. */
export function outlineSvg(outline: readonly { x: number; z: number }[]): { points: string; viewBox: string } {
  const xs = outline.map((p) => p.x);
  const zs = outline.map((p) => p.z);
  const [minX, minZ] = [Math.min(...xs), Math.min(...zs)];
  const [width, depth] = [Math.max(...xs) - minX, Math.max(...zs) - minZ];
  const margin = Math.max(width, depth) * 0.12;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    points: outline.map((p) => `${r(p.x)},${r(p.z)}`).join(' '),
    viewBox: [minX - margin, minZ - margin, width + margin * 2, depth + margin * 2].map(r).join(' '),
  };
}

/** Un número con un decimal y coma, como en el resto de la app. */
export const oneDecimal = (value: number) => value.toFixed(1).replace('.', ',');

/** Tipos de cuarto que aparecen en la lista, sin repetir y en el orden en que aparecen. */
export function roomTypesOf(projects: readonly ProjectListItem[]): RoomType[] {
  return [...new Set(projects.map((p) => p.roomType))];
}

/** Una vivienda tal como se resume en la lista: sus cuartos y lo que suman. */
export interface HomeSummary {
  id: string;
  name: string;
  rooms: { id: string; name: string }[];
  areaM2: number;
  pieces: number;
  /** Total estimado de todos sus cuartos (0 si ninguno tiene precios). */
  total: number;
}

/** Las viviendas que hay entre los proyectos, por nombre; los cuartos sueltos no forman ninguna. */
export function homesOf(projects: readonly ProjectListItem[]): HomeSummary[] {
  const homes = new Map<string, HomeSummary>();
  for (const p of projects) {
    if (!p.homeId) continue;
    const home = homes.get(p.homeId) ?? { id: p.homeId, name: p.homeName ?? 'Vivienda', rooms: [], areaM2: 0, pieces: 0, total: 0 };
    home.rooms.push({ id: p.id, name: p.name });
    home.areaM2 = Math.round((home.areaM2 + (p.areaM2 ?? 0)) * 10) / 10;
    home.pieces += p.itemCount;
    home.total += p.estimatedTotal ?? 0;
    homes.set(p.homeId, home);
  }
  return [...homes.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function summarize(projects: readonly ProjectListItem[]): ProjectsSummary {
  return {
    total: projects.length,
    unsaved: projects.filter((p) => !p.saved).length,
    pieces: projects.reduce((sum, p) => sum + p.itemCount, 0),
    areaM2: Math.round(projects.reduce((sum, p) => sum + (p.areaM2 ?? 0), 0) * 10) / 10,
  };
}
