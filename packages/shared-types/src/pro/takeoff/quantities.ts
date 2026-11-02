/**
 * Cómputo métrico (lógica pura): cuánto mide cada superficie del cuarto, sacado de la geometría y
 * de los acabados elegidos. Es la base del presupuesto de obra: m² de piso por material, m² netos
 * de muro (sin vanos), revestimiento hasta su altura, cielo raso, guardaescoba y tabiques.
 */
import type { RoomFinishes, RoomShell } from '../../domain.js';
import { roomPolygon } from '../../geometry.js';
import { DEFAULT_FINISHES, resolveFinishMaterial, wallMaterialId, type MaterialDefinition } from '../../materials.js';
import { signedArea } from '../../polygon.js';
import { partitions, zoneArea, ZONE_DOOR_HEIGHT_M } from '../../zones.js';

export type TakeoffSurface = 'floor' | 'wall' | 'ceiling';

/** Superficie con un acabado: lo que se compra y se instala junto. */
export interface SurfaceQuantity {
  surface: TakeoffSurface;
  materialId: string;
  material: MaterialDefinition;
  areaM2: number;
}

export interface WallQuantity {
  wallId: string;
  lengthM: number;
  grossM2: number;
  openingsM2: number;
  netM2: number;
  /** Parte revestida (enchape) hasta la altura del revestimiento, sin vanos. */
  tiledM2: number;
}

export interface RoomQuantities {
  heightM: number;
  floorM2: number;
  ceilingM2: number;
  perimeterM: number;
  /** Perímetro menos el ancho de las puertas (y las dos caras de cada tabique). */
  skirtingM: number;
  walls: WallQuantity[];
  /** Tabiques nuevos de las zonas: área de construcción (una cara, sin la puerta). */
  partitionM2: number;
  partitionLengthM: number;
  doors: { existing: number; new: number };
  windows: { count: number; areaM2: number };
  surfaces: SurfaceQuantity[];
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Mide el cuarto. Sin acabados elegidos se usan los de por defecto (piso de madera, pintura blanca). */
export function measureRoom(shell: RoomShell, finishesIn: RoomFinishes | null | undefined): RoomQuantities {
  const finishes = finishesIn ?? DEFAULT_FINISHES;
  const H = shell.heightM;
  const area = Math.abs(signedArea(roomPolygon(shell)));
  const acc = new Map<string, SurfaceQuantity>();
  const add = (surface: TakeoffSurface, materialId: string, m2: number) => {
    if (m2 <= 1e-6) return;
    const material = resolveFinishMaterial(finishes, materialId);
    if (!material) return;
    const key = `${surface}:${materialId}`;
    const prev = acc.get(key);
    if (prev) prev.areaM2 += m2;
    else acc.set(key, { surface, materialId, material, areaM2: m2 });
  };

  // Piso: el de cada zona con acabado propio y el del cuarto en lo demás.
  let zoneFloors = 0;
  for (const zone of shell.zones ?? []) {
    const zf = finishes.zones?.[zone.id];
    if (!zf) continue;
    const a = zoneArea(zone);
    zoneFloors += a;
    add('floor', zf.floor, a);
  }
  add('floor', finishes.floor, area - zoneFloors);
  add('ceiling', finishes.ceiling, area);

  // Muros del cuarto: brutos, vanos, revestimiento y lo que queda para el acabado de la pared.
  const tiles = finishes.wallTiles;
  const walls: WallQuantity[] = shell.walls.map((w) => {
    const L = Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z);
    const mine = shell.openings.filter((o) => o.wallId === w.id);
    const openings = mine.reduce((s, o) => s + o.widthM * Math.max(0, Math.min(H, o.sillHeightM + o.heightM) - o.sillHeightM), 0);
    const tiled =
      tiles && (!tiles.walls || tiles.walls.includes(w.id))
        ? L * Math.min(tiles.heightM, H) - mine.reduce((s, o) => s + o.widthM * Math.max(0, Math.min(tiles.heightM, o.sillHeightM + o.heightM) - o.sillHeightM), 0)
        : 0;
    const net = L * H - openings;
    if (tiled > 0) add('wall', tiles!.material, tiled);
    add('wall', wallMaterialId(finishes, w), net - tiled);
    return { wallId: w.id, lengthM: round(L, 3), grossM2: round(L * H), openingsM2: round(openings), netM2: round(net), tiledM2: round(Math.max(0, tiled)) };
  });

  // Tabiques de las zonas: se construyen y se acaban por las dos caras.
  const parts = partitions(shell);
  const doorArea = (p: (typeof parts)[number]) => (p.door ? p.door.widthM * Math.min(ZONE_DOOR_HEIGHT_M, H) : 0);
  const partitionM2 = parts.reduce((s, p) => s + p.lengthM * H - doorArea(p), 0);
  const outerMaterial = finishes.walls['all'] ?? DEFAULT_FINISHES.walls['all']!;
  for (const p of parts) {
    const face = p.lengthM * H - doorArea(p);
    add('wall', outerMaterial, face);
    const zf = finishes.zones?.[p.zoneId];
    const zt = zf?.wallTiles;
    const tiled = zt ? Math.max(0, p.lengthM * Math.min(zt.heightM, H) - (p.door ? p.door.widthM * Math.min(zt.heightM, ZONE_DOOR_HEIGHT_M) : 0)) : 0;
    if (zt && tiled > 0) add('wall', zt.material, tiled);
    add('wall', zf?.walls ?? outerMaterial, face - tiled);
  }

  const perimeter = walls.reduce((s, w) => s + w.lengthM, 0);
  const roomDoors = shell.openings.filter((o) => o.type === 'door');
  const zoneDoors = parts.filter((p) => p.door);
  const skirting = perimeter - roomDoors.reduce((s, o) => s + o.widthM, 0) + parts.reduce((s, p) => s + 2 * p.lengthM - (p.door ? 2 * p.door.widthM : 0), 0);
  const windows = shell.openings.filter((o) => o.type === 'window');
  return {
    heightM: H,
    floorM2: round(area),
    ceilingM2: round(area),
    perimeterM: round(perimeter),
    skirtingM: round(Math.max(0, skirting)),
    walls,
    partitionM2: round(partitionM2),
    partitionLengthM: round(parts.reduce((s, p) => s + p.lengthM, 0)),
    doors: { existing: roomDoors.length, new: zoneDoors.length },
    windows: { count: windows.length, areaM2: round(windows.reduce((s, o) => s + o.widthM * o.heightM, 0)) },
    surfaces: [...acc.values()].map((s) => ({ ...s, areaM2: round(s.areaM2) })),
  };
}
