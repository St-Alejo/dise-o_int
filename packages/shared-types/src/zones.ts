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
