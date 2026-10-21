/**
 * Zonas interiores de un cuarto (baño privado, vestidor, rincón del tocador): qué lados son tabiques
 * nuevos, dónde queda la puerta y qué se exige para que la zona sea construible. Funciones puras.
 */
import type { RoomShell, Zone } from './domain.js';
import { RoomGeometryError, roomPolygon } from './geometry.js';
import { distanceToBoundary, isSimplePolygon, pointInPolygon, segmentsCross, signedArea, type Point2 } from './polygon.js';

/** Un lado a menos de esto de una pared del cuarto se apoya en ella (no es tabique). */
const ON_WALL_M = 0.03;
/** Lo mínimo que mide de área una zona cerrada: menos no entra ni un inodoro con su paso. */
export const MIN_ZONE_AREA_M2 = 1.2;
/** Margen entre la puerta y las esquinas del tabique. */
const DOOR_MARGIN_M = 0.05;

export interface ZoneEdge {
  index: number;
  a: Point2;
  b: Point2;
  lengthM: number;
  /** true = tabique nuevo; false = coincide con una pared del cuarto. */
  partition: boolean;
}

export function zoneArea(zone: Pick<Zone, 'outline'>): number {
  return Math.abs(signedArea(zone.outline));
}

/** Los lados del contorno de la zona, marcando cuáles son tabiques (en una zona abierta, ninguno). */
export function zoneEdges(shell: Pick<RoomShell, 'walls'>, zone: Pick<Zone, 'outline' | 'open'>): ZoneEdge[] {
  const room = roomPolygon(shell);
  const pts = zone.outline;
  return pts.map((a, index) => {
    const b = pts[(index + 1) % pts.length]!;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const onWall = distanceToBoundary(a, room) < ON_WALL_M && distanceToBoundary(b, room) < ON_WALL_M && distanceToBoundary(mid, room) < ON_WALL_M;
    return { index, a, b, lengthM: Math.hypot(b.x - a.x, b.z - a.z), partition: !zone.open && !onWall };
  });
}

function polygonsOverlap(p: readonly Point2[], q: readonly Point2[]): boolean {
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      if (segmentsCross(p[i]!, p[(i + 1) % p.length]!, q[j]!, q[(j + 1) % q.length]!)) return true;
    }
  }
  const centroid = (poly: readonly Point2[]) => ({
    x: poly.reduce((s, v) => s + v.x, 0) / poly.length,
    z: poly.reduce((s, v) => s + v.z, 0) / poly.length,
  });
  return pointInPolygon(centroid(p), q) || pointInPolygon(centroid(q), p);
}

/**
 * Lanza `RoomGeometryError` si alguna zona no se puede construir: fuera del cuarto, cruzada,
 * demasiado chica, encimada con otra o con la puerta en un lado que no es tabique.
 */
export function validateZones(shell: Pick<RoomShell, 'walls' | 'zones'>): void {
  const zones = shell.zones ?? [];
  if (new Set(zones.map((z) => z.id)).size !== zones.length) throw new RoomGeometryError('Hay zonas con el mismo id');
  const room = roomPolygon(shell);
  zones.forEach((zone, i) => {
    const label = zone.name ?? zone.id;
    if (!isSimplePolygon(zone.outline)) throw new RoomGeometryError(`Los lados de la zona "${label}" se cruzan`);
    if (zone.outline.some((p) => !pointInPolygon(p, room, ON_WALL_M))) throw new RoomGeometryError(`La zona "${label}" se sale del cuarto`);
    if (!zone.open && zoneArea(zone) < MIN_ZONE_AREA_M2) {
      throw new RoomGeometryError(`La zona "${label}" es demasiado chica (mínimo ${MIN_ZONE_AREA_M2} m²)`);
    }
    for (const other of zones.slice(i + 1)) {
      if (polygonsOverlap(zone.outline, other.outline)) throw new RoomGeometryError(`Las zonas "${label}" y "${other.name ?? other.id}" se enciman`);
    }
    if (zone.door) {
      const edge = zoneEdges(shell, zone)[zone.door.edge];
      if (!edge || !edge.partition) throw new RoomGeometryError(`La puerta de "${label}" tiene que ir en un tabique`);
      const half = zone.door.widthM / 2;
      if (zone.door.offsetM - half < DOOR_MARGIN_M || zone.door.offsetM + half > edge.lengthM - DOOR_MARGIN_M) {
        throw new RoomGeometryError(`La puerta de "${label}" no cabe en su tabique`);
      }
    }
  });
}

/** ¿En qué zona cae un punto? null = en el espacio común del cuarto. */
export function zoneAt(shell: Pick<RoomShell, 'zones'>, p: Point2): Zone | null {
  return shell.zones?.find((z) => pointInPolygon(p, z.outline)) ?? null;
}

/** Grosor de un tabique interior (más fino que un muro). */
export const PARTITION_THICKNESS_M = 0.08;
/** Alto del hueco de la puerta de una zona. */
export const ZONE_DOOR_HEIGHT_M = 2.05;

/** Un tabique de una zona: de `a` a `b`, con su puerta (medida desde `a`) si la tiene. */
export interface Partition {
  zoneId: string;
  edge: number;
  a: Point2;
  b: Point2;
  lengthM: number;
  door: { offsetM: number; widthM: number } | null;
}

/** Todos los tabiques de todas las zonas cerradas del cuarto. */
export function partitions(shell: Pick<RoomShell, 'walls' | 'zones'>): Partition[] {
  return (shell.zones ?? []).flatMap((zone) =>
    zoneEdges(shell, zone)
      .filter((e) => e.partition)
      .map((e) => ({
        zoneId: zone.id,
        edge: e.index,
        a: e.a,
        b: e.b,
        lengthM: e.lengthM,
        door: zone.door && zone.door.edge === e.index ? { offsetM: zone.door.offsetM, widthM: zone.door.widthM } : null,
      })),
  );
}

/** Los tramos macizos de los tabiques (sin el hueco de la puerta): lo que no se puede atravesar. */
export function partitionSolids(shell: Pick<RoomShell, 'walls' | 'zones'>): { a: Point2; b: Point2 }[] {
  const at = (p: Partition, t: number): Point2 => ({ x: p.a.x + ((p.b.x - p.a.x) * t) / p.lengthM, z: p.a.z + ((p.b.z - p.a.z) * t) / p.lengthM });
  return partitions(shell).flatMap((p) => {
    if (!p.door) return [{ a: p.a, b: p.b }];
    const from = p.door.offsetM - p.door.widthM / 2;
    const to = p.door.offsetM + p.door.widthM / 2;
    return [
      ...(from > 0.01 ? [{ a: p.a, b: at(p, from) }] : []),
      ...(to < p.lengthM - 0.01 ? [{ a: at(p, to), b: p.b }] : []),
    ];
  });
}

/**
 * Plantilla de zona en una esquina del cuarto: un rectángulo de `widthM` × `depthM` apoyado en
 * dos paredes, en la esquina más alejada de la puerta del cuarto (para no estorbar la entrada),
 * con su puerta en el tabique más largo. null si el cuarto no tiene esquina donde quepa.
 */
export function cornerZone(
  shell: Pick<RoomShell, 'walls' | 'openings' | 'zones'>,
  opts: { id: string; kind: Zone['kind']; name?: string; widthM: number; depthM: number; doorWidthM?: number },
): Zone | null {
  const room = roomPolygon(shell);
  const xs = room.map((p) => p.x);
  const zs = room.map((p) => p.z);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const w = opts.widthM;
  const d = opts.depthM;
  const door = shell.openings.find((o) => o.type === 'door');
  const doorWall = door ? shell.walls.find((wl) => wl.id === door.wallId) : undefined;
  const doorAt = doorWall
    ? (() => {
        const len = Math.hypot(doorWall.end.x - doorWall.start.x, doorWall.end.z - doorWall.start.z) || 1;
        const t = door!.offsetM / len;
        return { x: doorWall.start.x + (doorWall.end.x - doorWall.start.x) * t, z: doorWall.start.z + (doorWall.end.z - doorWall.start.z) * t };
      })()
    : { x: minX, z: maxZ };
  const corners = [
    { x: minX, z: minZ, sx: 1, sz: 1 },
    { x: maxX, z: minZ, sx: -1, sz: 1 },
    { x: maxX, z: maxZ, sx: -1, sz: -1 },
    { x: minX, z: maxZ, sx: 1, sz: -1 },
  ].sort((p, q) => Math.hypot(q.x - doorAt.x, q.z - doorAt.z) - Math.hypot(p.x - doorAt.x, p.z - doorAt.z));
  for (const c of corners) {
    const pts = [
      { x: c.x, z: c.z },
      { x: c.x + c.sx * w, z: c.z },
      { x: c.x + c.sx * w, z: c.z + c.sz * d },
      { x: c.x, z: c.z + c.sz * d },
    ];
    // Siempre en el mismo sentido de giro que el cuarto, para que los lados se lean igual.
    const outline = signedArea(pts) * signedArea(room) < 0 ? [...pts].reverse() : pts;
    const zone: Zone = { id: opts.id, kind: opts.kind, ...(opts.name ? { name: opts.name } : {}), outline, open: false };
    const edges = zoneEdges(shell, zone).filter((e) => e.partition);
    const longest = edges.sort((a, b) => b.lengthM - a.lengthM)[0];
    if (!longest) continue;
    const doorWidth = Math.min(opts.doorWidthM ?? 0.7, longest.lengthM - 2 * DOOR_MARGIN_M - 0.1);
    if (doorWidth < 0.5) continue;
    const candidate: Zone = { ...zone, door: { edge: longest.index, offsetM: longest.lengthM / 2, widthM: doorWidth } };
    try {
      validateZones({ walls: shell.walls, zones: [...(shell.zones ?? []).filter((z) => z.id !== opts.id), candidate] });
      return candidate;
    } catch {
      /* esa esquina no sirve: la siguiente */
    }
  }
  return null;
}
