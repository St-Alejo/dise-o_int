/**
 * Propuesta automática de instalaciones (lógica pura): a partir del cuarto y sus muebles sugiere
 * los puntos eléctricos e hidrosanitarios que pondría un diseñador. Lo que la persona puso a mano
 * (`auto` ausente) se respeta; lo propuesto antes se reemplaza.
 *
 * - Tomas por el perímetro: ningún punto de la pared a más de 1,8 m de una toma.
 * - Tomas junto a la mesa de noche, el escritorio, el mueble de TV, la nevera y el mesón.
 * - GFCI a menos de 1,8 m de un lavamanos, lavaplatos, ducha o tina (y todas en un baño).
 * - Un interruptor junto a cada puerta, del lado de la chapa, a 1,20 m, que enciende las luces.
 * - Una salida de luz por luminaria de techo o de pared (una al centro si no hay ninguna).
 * - Agua fría, caliente y desagüe de cada aparato sanitario o de cocina, a sus alturas.
 */
import type { RoomShell, RoomType } from '../../domain.js';
import type { DesignPiece } from '../../design-check.js';
import { roomPolygon, rotateXZ } from '../../geometry.js';
import { interiorAnchor, pointInPolygon, type Point2 } from '../../polygon.js';
import { alongOf, distanceFromWall, wallFrames, type WallFrame } from '../../walls.js';
import { partitions } from '../../zones.js';
import type { InstallationKind, InstallationPoint, InstallationsSpec } from '../technical.js';
import { assignCircuits } from './circuits.js';
import { INSTALLATION_INFO, isOutlet, placePoints } from './points.js';

/** Distancia máxima a una toma desde cualquier punto de la pared (regla de 1,8 m). */
export const OUTLET_REACH_M = 1.8;
/** Distancia a un aparato con agua dentro de la cual una toma debe ser GFCI. */
export const WET_REACH_M = 1.8;

const WET_FIXTURES = new Set(['sink', 'vanity', 'bathtub', 'shower']);
const OUTLET_NEXT_TO = new Set(['nightstand', 'desk', 'tv-stand', 'dressing-table', 'fridge', 'kitchen-base', 'stove', 'sink', 'kitchen-island']);

export interface ProposalInput {
  shell: RoomShell;
  pieces: readonly DesignPiece[];
  roomType: RoomType;
  installations: InstallationsSpec;
}

interface WallSpot {
  frame: WallFrame;
  /** Metros desde `base` del marco. */
  along: number;
}

/** De `along` (desde la base del marco) a `offsetM` (desde `wall.start`). */
const offsetOf = (s: WallSpot) => (s.frame.startAtBase ? s.along : s.frame.length - s.along);

/** La pared detrás de una pieza (la que mira hacia donde mira la pieza), o la más cercana. */
function wallBehind(frames: readonly WallFrame[], piece: DesignPiece): WallSpot | null {
  const center = { x: piece.position.x, z: piece.position.z };
  const front = rotateXZ(0, 1, piece.rotationY);
  let best: (WallSpot & { score: number }) | null = null;
  for (const f of frames) {
    const along = alongOf(f, center);
    if (along < -0.05 || along > f.length + 0.05) continue;
    const dist = distanceFromWall(f, center);
    if (dist < -0.05) continue;
    const facing = f.normal.x * front.x + f.normal.z * front.z;
    // Se prefiere la pared que la pieza tiene a la espalda; si ninguna, la más cercana.
    const score = dist - (facing > 0.7 ? 10 : 0);
    if (!best || score < best.score) best = { frame: f, along: Math.min(f.length - 0.1, Math.max(0.1, along)), score };
  }
  return best ? { frame: best.frame, along: best.along } : null;
}

export function proposeInstallations(input: ProposalInput): InstallationsSpec {
  const { shell, pieces } = input;
  const frames = wallFrames(shell);
  const room = roomPolygon(shell);
  const closed = (shell.zones ?? []).filter((z) => !z.open);
  const kept = input.installations.points.filter((p) => !p.auto);
  const out: InstallationPoint[] = [];
  const counter = new Map<string, number>();
  const nextId = (kind: InstallationKind) => {
    const n = (counter.get(kind) ?? 0) + 1;
    counter.set(kind, n);
    return `auto-${kind}-${n}`;
  };
  const onWall = (kind: InstallationKind, spot: WallSpot, heightM = INSTALLATION_INFO[kind].heightM, extra: Partial<InstallationPoint> = {}): InstallationPoint => {
    const p: InstallationPoint = { id: nextId(kind), kind, wallId: spot.frame.id, offsetM: Math.round(offsetOf(spot) * 100) / 100, heightM, auto: true, ...extra };
    out.push(p);
    return p;
  };
  const onFloor = (kind: InstallationKind, at: Point2, heightM = INSTALLATION_INFO[kind].heightM, extra: Partial<InstallationPoint> = {}): InstallationPoint => {
    const p: InstallationPoint = { id: nextId(kind), kind, at: { x: Math.round(at.x * 100) / 100, z: Math.round(at.z * 100) / 100 }, heightM, auto: true, ...extra };
    out.push(p);
    return p;
  };

  // Puertas del cuarto, en coordenadas del marco de su pared.
  const doorGaps = new Map<string, [number, number][]>();
  for (const o of shell.openings.filter((x) => x.type === 'door')) {
    const f = frames.find((x) => x.id === o.wallId);
    if (!f) continue;
    const c = f.startAtBase ? o.offsetM : f.length - o.offsetM;
    doorGaps.set(f.id, [...(doorGaps.get(f.id) ?? []), [c - o.widthM / 2, c + o.widthM / 2]]);
  }
  const inDoor = (frameId: string, along: number, margin = 0.15) => (doorGaps.get(frameId) ?? []).some(([a, b]) => along > a - margin && along < b + margin);

  // 1. Luces: una por luminaria de techo o de pared.
  const lights: InstallationPoint[] = [];
  for (const p of pieces.filter((x) => x.category === 'lighting')) {
    if (p.mount === 'ceiling') lights.push(onFloor('light', { x: p.position.x, z: p.position.z }, shell.heightM));
    else if (p.mount === 'wall') {
      const spot = wallBehind(frames, p);
      if (spot) lights.push(onWall('light', spot, Math.round((p.position.y + p.dims.y / 2) * 100) / 100));
    }
  }
  if (!lights.length) lights.push(onFloor('light', interiorAnchor(room), shell.heightM));
  for (const z of closed) {
    if (!lights.some((l) => l.at && pointInPolygon(l.at, z.outline))) lights.push(onFloor('light', interiorAnchor(z.outline), shell.heightM));
  }
  const inZone = (p: InstallationPoint) => !!p.at && closed.some((z) => pointInPolygon(p.at!, z.outline));

  // 2. Interruptores junto a cada puerta, del lado de la chapa (el que tiene más pared libre).
  for (const o of shell.openings.filter((x) => x.type === 'door')) {
    const f = frames.find((x) => x.id === o.wallId);
    if (!f) continue;
    const c = f.startAtBase ? o.offsetM : f.length - o.offsetM;
    const left = c - o.widthM / 2;
    const right = f.length - (c + o.widthM / 2);
    const along = right >= left ? c + o.widthM / 2 + 0.15 : c - o.widthM / 2 - 0.15;
    if (along <= 0.05 || along >= f.length - 0.05) continue;
    onWall('switch', { frame: f, along }, 1.2, { controls: lights.filter((l) => !inZone(l)).map((l) => l.id) });
  }
  for (const z of closed) {
    const part = partitions(shell).find((p) => p.zoneId === z.id && p.door);
    if (!part?.door) continue;
    const dx = (part.b.x - part.a.x) / part.lengthM;
    const dz = (part.b.z - part.a.z) / part.lengthM;
    const t = Math.min(part.lengthM - 0.05, part.door.offsetM + part.door.widthM / 2 + 0.15);
    const base = { x: part.a.x + dx * t, z: part.a.z + dz * t };
    // Del lado de fuera de la zona.
    const n = { x: -dz, z: dx };
    const probe = { x: base.x + n.x * 0.1, z: base.z + n.z * 0.1 };
    const s = pointInPolygon(probe, z.outline) ? -1 : 1;
    onFloor('switch', { x: base.x + n.x * 0.05 * s, z: base.z + n.z * 0.05 * s }, 1.2, { controls: lights.filter((l) => l.at && pointInPolygon(l.at, z.outline)).map((l) => l.id) });
  }

  // 3. Tomas junto a los muebles que las necesitan.
  const outletSpots: WallSpot[] = [];
  const near = (spot: WallSpot, gap: number) => outletSpots.some((s) => s.frame.id === spot.frame.id && Math.abs(s.along - spot.along) < gap);
  for (const p of pieces) {
    const sub = p.subcategory ?? '';
    if (p.supportId || !OUTLET_NEXT_TO.has(sub)) continue;
    const spot = wallBehind(frames, p);
    if (!spot || inDoor(spot.frame.id, spot.along) || near(spot, 1)) continue;
    const kitchen = ['kitchen-base', 'stove', 'sink', 'kitchen-island'].includes(sub);
    outletSpots.push(spot);
    onWall('outlet', spot, kitchen ? 1.1 : sub === 'tv-stand' ? 0.6 : 0.3, sub === 'fridge' ? { watts: 400 } : {});
    if (sub === 'tv-stand') onWall('tv-data', { frame: spot.frame, along: Math.min(spot.frame.length - 0.1, spot.along + 0.25) }, 0.6);
  }

  // 4. Tomas por el perímetro: tramos de como mucho 3,6 m entre tomas.
  for (const f of frames) {
    if (f.length < 0.6) continue;
    const n = Math.max(1, Math.ceil(f.length / (2 * OUTLET_REACH_M)));
    for (let i = 0; i < n; i++) {
      let along = ((i + 0.5) * f.length) / n;
      const gap = (doorGaps.get(f.id) ?? []).find(([a, b]) => along > a - 0.2 && along < b + 0.2);
      if (gap) along = gap[0] - 0.2 > 0.2 ? gap[0] - 0.2 : gap[1] + 0.2;
      if (along < 0.15 || along > f.length - 0.15 || inDoor(f.id, along)) continue;
      const spot = { frame: f, along };
      if (near(spot, 0.9)) continue;
      // Que no caiga dentro de una zona cerrada (su tabique la separa del cuarto).
      const at = { x: f.base.x + f.dir.x * along + f.normal.x * 0.05, z: f.base.z + f.dir.z * along + f.normal.z * 0.05 };
      if (closed.some((z) => pointInPolygon(at, z.outline))) continue;
      outletSpots.push(spot);
      onWall('outlet', spot);
    }
  }

  // 5. Agua: cada aparato con sus puntos.
  for (const p of pieces) {
    const sub = p.subcategory ?? '';
    if (p.supportId || !['toilet', 'bidet', 'vanity', 'sink', 'shower', 'bathtub'].includes(sub)) continue;
    const spot = wallBehind(frames, p);
    const back = rotateXZ(0, -1, p.rotationY);
    const toward = (d: number): Point2 => ({ x: p.position.x + back.x * d, z: p.position.z + back.z * d });
    const side = (s: WallSpot, d: number): WallSpot => ({ frame: s.frame, along: Math.min(s.frame.length - 0.05, Math.max(0.05, s.along + d)) });
    if (sub === 'toilet') {
      if (spot) onWall('cold-water', side(spot, -0.2), 0.2);
      onFloor('drain', toward(Math.max(0, p.dims.z / 2 - 0.3)), 0);
    } else if (sub === 'bidet') {
      if (spot) {
        onWall('cold-water', side(spot, -0.1), 0.2);
        onWall('hot-water', side(spot, 0.1), 0.2);
      }
      onFloor('drain', toward(Math.max(0, p.dims.z / 2 - 0.25)), 0);
    } else if (sub === 'vanity' || sub === 'sink') {
      if (!spot) continue;
      onWall('cold-water', side(spot, -0.1), 0.55);
      onWall('hot-water', side(spot, 0.1), 0.55);
      onWall('drain', spot, 0.5);
    } else if (sub === 'shower') {
      if (spot) {
        onWall('cold-water', side(spot, -0.1), 1.1);
        onWall('hot-water', side(spot, 0.1), 1.1);
      }
      onFloor('floor-drain', { x: p.position.x, z: p.position.z });
    } else if (sub === 'bathtub') {
      if (spot) {
        onWall('cold-water', side(spot, -0.1), 0.6);
        onWall('hot-water', side(spot, 0.1), 0.6);
      }
      onFloor('drain', { x: p.position.x, z: p.position.z }, 0);
    }
  }

  // 6. Tomas cerca del agua (o todas en un baño): GFCI.
  const wet = pieces.filter((p) => !p.supportId && WET_FIXTURES.has(p.subcategory ?? '')).map((p) => ({ x: p.position.x, z: p.position.z }));
  const placed = new Map(placePoints(shell, out).map((pp) => [pp.point.id, pp.at]));
  const all = out.map((p) => {
    if (!isOutlet(p.kind) || p.kind === 'outlet-gfci') return p;
    const at = placed.get(p.id);
    const close = at && wet.some((w) => Math.hypot(w.x - at.x, w.z - at.z) <= WET_REACH_M);
    return close || input.roomType === 'bathroom' ? { ...p, kind: 'outlet-gfci' as const, heightM: Math.max(p.heightM, 1.1) } : p;
  });

  return assignCircuits({ ...input.installations, points: [...kept, ...all] });
}

/** Quita lo propuesto y deja lo puesto a mano. */
export function clearProposed(spec: InstallationsSpec): InstallationsSpec {
  return assignCircuits({ ...spec, points: spec.points.filter((p) => !p.auto) });
}
