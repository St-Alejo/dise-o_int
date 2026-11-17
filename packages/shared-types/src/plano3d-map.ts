/**
 * Puente con Plano 3D (ADR-0039): cómo se lee una casa de Plano 3D como cuartos de Interiores y
 * cómo vuelven los muebles. Funciones puras; las usa el módulo `plano3d` de la API.
 *
 * Convenciones de Plano 3D:
 * - La planta va en metros, con `x` a la derecha e `y` hacia abajo. Aquí `y` pasa a ser `z`.
 * - `opening.offset` es el borde inicial de la abertura sobre el muro. Aquí `offsetM` es su centro.
 * - `furniture.rotation` está en radianes y el visor la aplica como `rotation.y = -rotation`.
 *   Aquí `rotationY` va igual que en Three.js, así que `rotationY = -rotation`.
 *
 * Cada ambiente diseñable se vuelve un cuarto con origen en la esquina mínima de su planta.
 * Su posición en el mundo (Plano 3D) es `local + origin`.
 */
import type { FurniturePlacement, Opening, RoomShell, RoomType } from './domain.js';
import { createPolygonShell } from './geometry.js';

export interface Plano3dPoint {
  x: number;
  y: number;
}
export interface Plano3dOpening {
  id: string;
  kind: string;
  offset: number;
  width: number;
  height: number;
  sill?: number;
}
export interface Plano3dWall {
  id: string;
  start: Plano3dPoint;
  end: Plano3dPoint;
  thickness?: number;
  height?: number;
  openings?: Plano3dOpening[];
  bulge?: number | null;
}
export interface Plano3dRoom {
  id: string;
  label: string;
  polygon: Plano3dPoint[];
  room_type?: string | null;
  floor_material?: string | null;
}
export interface Plano3dFurniture {
  id: string;
  catalog_id: string;
  position: Plano3dPoint;
  width: number;
  depth: number;
  height: number;
  rotation: number;
}
export interface Plano3dLevel {
  id: string;
  name: string;
  elevation?: number;
  height?: number | null;
  walls?: Plano3dWall[];
  rooms?: Plano3dRoom[];
  furniture?: Plano3dFurniture[] | null;
}
export interface Plano3dModel {
  project_id?: string;
  levels: Plano3dLevel[];
}

/** Op de la sala en vivo de Plano 3D (ADR-019): solo las que manda Interiores. */
export type Plano3dOp =
  | { t: 'put'; k: 'furniture'; level: string; id: string; v: Plano3dFurniture }
  | { t: 'del'; k: 'furniture'; level: string; id: string }
  | { t: 'put'; k: 'room'; level: string; id: string; v: Plano3dRoom };

export const DEFAULT_LEVEL_HEIGHT_M = 2.6;
/** Prefijo de los muebles que vienen de Interiores (id del mueble y del catálogo). */
export const INTERIORES_FURNITURE_PREFIX = 'int-';
export const INTERIORES_CATALOG_PREFIX = 'int_';

/** Espacios de paso o de servicio: se ven en la casa, pero no se amueblan aquí. */
const NOT_FURNISHED =
  /(^|[^a-zñ])(escaleras?|punto fijo|hall|pasillo|corredor|circulaci[oó]n|parqueaderos?|garajes?|estacionamiento|ropas|lavander[ií]a|lavado|despensa|bodega|shut|ducto|vac[ií]o)([^a-zñ]|$)/;

/** Por el nombre que puso el arquitecto, cuando el tipo de Plano 3D no dice nada útil. */
const BY_LABEL: [RegExp, RoomType][] = [
  [/(ba[ñn]os?|aseo|wc|toilet|bath)/, 'bathroom'],
  [/(cocina|kitchen|cocineta)/, 'kitchen'],
  [/(alcobas?|habitaci[oó]n|dormitorio|rec[aá]mara|cuarto|suite|bedroom|vestier|closet)/, 'bedroom'],
  [/(estudio|oficina|despacho|study|office|local|sal[oó]n de ventas|consultorio|tienda)/, 'office'],
  [/(sala|estar|living|tv|juegos|gimnasio|gym|terraza|balc[oó]n|sol[aá]rium|bbq|patio|social|sal[oó]n)/, 'living'],
];

/** Tipo de ambiente de Plano 3D → tipo de cuarto de Interiores (null = no se diseña aquí). */
export function interioresRoomType(room: Pick<Plano3dRoom, 'room_type' | 'label'>): RoomType | null {
  const label = room.label.toLowerCase();
  if (NOT_FURNISHED.test(label)) return null;
  if (/comedor/.test(label) && !/sala/.test(label)) return 'dining';
  switch (room.room_type) {
    case 'living':
      return 'living';
    case 'bedroom':
      return 'bedroom';
    case 'kitchen':
      return 'kitchen';
    case 'bathroom':
      return 'bathroom';
    case 'study':
      return 'office';
    case 'dining':
      return 'dining';
    case 'stairs':
    case 'circulation':
    case 'garage':
    case 'laundry':
      return null;
    default:
      // «otro», terrazas, vestieres, locales…: manda el nombre
      return BY_LABEL.find(([re]) => re.test(label))?.[1] ?? null;
  }
}

export interface LinkedRoom {
  levelId: string;
  levelIndex: number;
  levelName: string;
  roomId: string;
  name: string;
  roomType: RoomType;
  /** Esquina mínima de la planta en el mundo de Plano 3D (x, y → x, z). */
  origin: { x: number; z: number };
  shell: RoomShell;
  floorMaterial: string | null;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Aberturas de los muros de Plano 3D que caen sobre un lado del cuarto: mismo eje
 * (con tolerancia de medio muro) y dentro del tramo. Las curvas se ignoran.
 */
function openingsOnShell(shell: RoomShell, origin: { x: number; z: number }, walls: readonly Plano3dWall[]): Opening[] {
  const out: Opening[] = [];
  for (const wall of walls) {
    if (wall.bulge && Math.abs(wall.bulge) > 1e-6) continue;
    const ax = wall.start.x - origin.x;
    const az = wall.start.y - origin.z;
    const bx = wall.end.x - origin.x;
    const bz = wall.end.y - origin.z;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const tol = (wall.thickness ?? 0.15) / 2 + 0.05;
    for (const op of wall.openings ?? []) {
      // centro de la abertura en el muro de Plano 3D, en coordenadas del cuarto
      const t = op.offset + op.width / 2;
      const cx = ax + ux * t;
      const cz = az + uz * t;
      for (const seg of shell.walls) {
        const sx = seg.end.x - seg.start.x;
        const sz = seg.end.z - seg.start.z;
        const segLen = Math.hypot(sx, sz);
        if (segLen < 1e-6) continue;
        const parallel = Math.abs((sx * uz - sz * ux) / segLen) < 0.02;
        const along = ((cx - seg.start.x) * sx + (cz - seg.start.z) * sz) / segLen;
        const dist = Math.abs(((cx - seg.start.x) * sz - (cz - seg.start.z) * sx) / segLen);
        if (!parallel || dist > tol || along < -1e-3 || along > segLen + 1e-3) continue;
        // una puerta junto a la esquina puede pasarse unos cm del lado del cuarto (el muro de
        // Plano 3D sigue por dentro del otro): se acomoda al lado en vez de perderla
        const over = Math.max(0, op.width / 2 - along, along + op.width / 2 - segLen);
        if (over > CORNER_OVERHANG_M) continue;
        const width = Math.min(op.width, segLen - 0.02);
        if (width < 0.3) continue;
        const center = Math.min(Math.max(along, width / 2), segLen - width / 2);
        const isWindow = op.kind.includes('window');
        out.push({
          id: `p3d-${op.id}`.slice(0, 64),
          type: isWindow ? 'window' : 'door',
          wallId: seg.id,
          widthM: round3(width),
          heightM: round3(op.height),
          offsetM: round3(center),
          sillHeightM: isWindow ? round3(op.sill ?? 0.9) : 0,
        });
        break;
      }
    }
  }
  return out;
}

/** Cuánto puede pasarse una abertura del lado del cuarto (m) y aun así acomodarse en él. */
const CORNER_OVERHANG_M = 0.3;
/** Lados más cortos que esto (m) son muescas del dibujo, no paredes. */
const MIN_SIDE_M = 0.05;

/**
 * Contorno sin muescas: quita los vértices a menos de 5 cm del vecino y los que quedan casi en
 * línea recta entre sus vecinos (si no, el cuarto lleva paredes de 1 cm).
 */
export function cleanPolygon(points: readonly Plano3dPoint[]): Plano3dPoint[] {
  const pts = [...points];
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const ac = Math.hypot(c.x - a.x, c.y - a.y);
      const offLine = ac > 1e-9 ? Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / ac : 0;
      if (ab < MIN_SIDE_M || offLine < MIN_SIDE_M / 2) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

/** La geometría de un ambiente en coordenadas de cuarto (o null si el contorno no sirve). */
function shellFrom(level: Plano3dLevel, room: Plano3dRoom): { origin: { x: number; z: number }; shell: RoomShell } | null {
  const polygon = cleanPolygon(room.polygon);
  if (polygon.length < 3) return null;
  const origin = { x: round3(Math.min(...polygon.map((p) => p.x))), z: round3(Math.min(...polygon.map((p) => p.y))) };
  let shell: RoomShell;
  try {
    shell = createPolygonShell(
      polygon.map((p) => ({ x: p.x, z: p.y })),
      level.height ?? DEFAULT_LEVEL_HEIGHT_M,
      { id: room.id.slice(0, 64), scaleConfidence: 1, needsCalibration: false },
    );
  } catch {
    return null;
  }
  shell = { ...shell, shape: polygon.length === 4 ? 'rect' : 'free', openings: openingsOnShell(shell, origin, level.walls ?? []) };
  return { origin, shell };
}

/** Un ambiente de Plano 3D como cuarto de Interiores (o null si no es diseñable o no es válido). */
export function linkedRoomFrom(level: Plano3dLevel, levelIndex: number, room: Plano3dRoom): LinkedRoom | null {
  const roomType = interioresRoomType(room);
  if (!roomType) return null;
  const built = shellFrom(level, room);
  if (!built) return null;
  const { origin, shell } = built;
  return {
    levelId: level.id,
    levelIndex,
    levelName: level.name,
    roomId: room.id,
    name: room.label,
    roomType,
    origin,
    shell,
    floorMaterial: room.floor_material ?? null,
  };
}

/** Un ambiente de la casa tal como se ve en 3D (también escaleras, halls, garajes…). */
export interface HouseRoom {
  roomId: string;
  name: string;
  /** null: se ve, pero no es un cuarto de Interiores (no se amuebla). */
  roomType: RoomType | null;
  origin: { x: number; z: number };
  shell: RoomShell;
}

/** Un piso de la casa para la vista 3D. */
export interface HouseLevel {
  levelId: string;
  index: number;
  name: string;
  elevation: number;
  heightM: number;
  rooms: HouseRoom[];
}

/** Ambientes de menos de esto (m²) no se dibujan: rendijas entre contornos. */
const MIN_HOUSE_ROOM_M2 = 0.8;

/** La casa entera por pisos, para verla en 3D: todos los ambientes, amueblables o no. */
export function houseLevels(model: Plano3dModel): HouseLevel[] {
  return model.levels.map((level, index) => ({
    levelId: level.id,
    index,
    name: level.name,
    elevation: level.elevation ?? 0,
    heightM: level.height ?? DEFAULT_LEVEL_HEIGHT_M,
    rooms: (level.rooms ?? []).flatMap((room) => {
      const built = shellFrom(level, room);
      if (!built || built.shell.widthM * built.shell.depthM < MIN_HOUSE_ROOM_M2) return [];
      return [{ roomId: room.id, name: room.label, roomType: interioresRoomType(room), ...built }];
    }),
  }));
}

/** Todos los ambientes diseñables de la casa, piso por piso. */
export function linkedRooms(model: Plano3dModel): LinkedRoom[] {
  return model.levels.flatMap((level, i) =>
    (level.rooms ?? []).map((room) => linkedRoomFrom(level, i, room)).filter((r): r is LinkedRoom => r !== null),
  );
}

/** Id del mueble en Plano 3D para un mueble de un cuarto enlazado (estable entre guardados). */
export function plano3dFurnitureId(roomId: string, placementId: string): string {
  return `${INTERIORES_FURNITURE_PREFIX}${roomId}-${placementId}`.slice(0, 120);
}

export interface PlacementSize {
  x: number;
  y: number;
  z: number;
}

/** Mueble de Interiores → mueble de Plano 3D, en el mundo de la casa. */
export function toPlano3dFurniture(room: Pick<LinkedRoom, 'roomId' | 'origin'>, p: FurniturePlacement, size: PlacementSize): Plano3dFurniture {
  const dims = p.dimensionsM ?? size;
  return {
    id: plano3dFurnitureId(room.roomId, p.id),
    catalog_id: `${INTERIORES_CATALOG_PREFIX}${p.catalogItemId}`,
    position: { x: round3(p.position.x + room.origin.x), y: round3(p.position.z + room.origin.z) },
    width: round3(dims.x),
    depth: round3(dims.z),
    height: round3(dims.y),
    rotation: round3(-p.rotationY),
  };
}

/**
 * Ops para llevar los muebles de un cuarto a Plano 3D: `put` de los nuevos o cambiados y `del`
 * de los que ya no están. `previous` son los ids de Plano 3D que el cuarto mandó la vez anterior.
 */
export function furnitureOps(
  room: Pick<LinkedRoom, 'roomId' | 'origin' | 'levelId'>,
  placements: readonly FurniturePlacement[],
  sizeOf: (catalogItemId: string) => PlacementSize | undefined,
  previous: ReadonlyMap<string, Plano3dFurniture>,
): Plano3dOp[] {
  const ops: Plano3dOp[] = [];
  const seen = new Set<string>();
  for (const p of placements) {
    const size = p.dimensionsM ?? sizeOf(p.catalogItemId);
    if (!size) continue;
    const f = toPlano3dFurniture(room, p, size);
    seen.add(f.id);
    const before = previous.get(f.id);
    if (before && JSON.stringify(before) === JSON.stringify(f)) continue;
    ops.push({ t: 'put', k: 'furniture', level: room.levelId, id: f.id, v: f });
  }
  for (const id of previous.keys()) {
    if (!seen.has(id)) ops.push({ t: 'del', k: 'furniture', level: room.levelId, id });
  }
  return ops;
}

/** Muebles de Plano 3D que Interiores puso en ese cuarto (por el prefijo de su id). */
export function interioresFurnitureOf(level: Plano3dLevel, roomId: string): Map<string, Plano3dFurniture> {
  const prefix = `${INTERIORES_FURNITURE_PREFIX}${roomId}-`;
  return new Map((level.furniture ?? []).filter((f) => f.id.startsWith(prefix)).map((f) => [f.id, f]));
}

/**
 * Material de Interiores → id de acabado de Plano 3D (`^[a-z0-9][a-z0-9_-]{0,47}$`): lleva el
 * prefijo `int_` para que Plano 3D sepa que viene de aquí y lo pinte con su textura.
 */
export function plano3dFloorMaterial(materialId: string): string {
  return `${INTERIORES_CATALOG_PREFIX}${materialId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`.slice(0, 48);
}

/** Op para cambiar el acabado de piso de un ambiente sin tocar su arquitectura. */
export function floorMaterialOp(levelId: string, room: Plano3dRoom, materialId: string | null): Plano3dOp | null {
  const material = materialId === null ? null : plano3dFloorMaterial(materialId);
  if ((room.floor_material ?? null) === material) return null;
  return { t: 'put', k: 'room', level: levelId, id: room.id, v: { ...room, floor_material: material } };
}

/** ¿El lote de Plano 3D cambió la arquitectura (y hay que reconstruir cuartos)? */
export function touchesArchitecture(ops: readonly { k?: string }[]): boolean {
  return ops.some((op) => op.k !== 'furniture');
}

/**
 * Mueble de Interiores que vuelve de Plano 3D (alguien lo movió allá): la vuelta exacta de
 * `toPlano3dFurniture`. Null si no es de este cuarto.
 */
export function fromPlano3dFurniture(room: Pick<LinkedRoom, 'roomId' | 'origin'>, f: Plano3dFurniture): FurniturePlacement | null {
  const prefix = `${INTERIORES_FURNITURE_PREFIX}${room.roomId}-`;
  if (!f.id.startsWith(prefix) || !f.catalog_id.startsWith(INTERIORES_CATALOG_PREFIX)) return null;
  return {
    id: f.id.slice(prefix.length),
    catalogItemId: f.catalog_id.slice(INTERIORES_CATALOG_PREFIX.length),
    position: { x: round3(f.position.x - room.origin.x), y: 0, z: round3(f.position.y - room.origin.z) },
    rotationY: round3(-f.rotation),
    lockedByUser: false,
    dimensionsM: { x: f.width, y: f.height, z: f.depth },
  };
}
