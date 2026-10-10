/**
 * Revisión del diseño (lógica pura): lo que un diseñador miraría antes de dar por bueno un
 * cuarto. ¿Se puede entrar? ¿Se llega a cada mueble? ¿Algo tapa la ventana? ¿Queda sitio para
 * moverse? Usa la misma física del recorrido a pie: si una persona no pasa, es un problema.
 */
import type { Mount, RoomShell, Vector3 } from './domain.js';
import { footprint, isInsideRoom, roomPolygon } from './geometry.js';
import { distanceToBoundary, pointInPolygon, signedArea, type Point2 } from './polygon.js';
import { WALKER, buildWalkWorld, canStand, type WalkWorld } from './walk.js';
import { alongOf, distanceFromWall, wallFrames } from './walls.js';

/** Un mueble tal como está colocado, con lo que la revisión necesita saber de él. */
export interface DesignPiece {
  id: string;
  name: string;
  mount: Mount;
  category: string;
  subcategory?: string;
  position: Vector3;
  rotationY: number;
  dims: Vector3;
  supportId?: string;
}

export type IssueSeverity = 'problem' | 'warning' | 'tip';

export interface DesignIssue {
  /** Estable entre revisiones: tipo + pieza (para listas y pruebas). */
  id: string;
  kind: 'outside' | 'door-blocked' | 'unreachable' | 'window-blocked' | 'crowded' | 'no-light';
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** Piezas implicadas: al pulsar el aviso se selecciona la primera. */
  placementIds: string[];
}

/** Paso de la rejilla con la que se recorre el piso. */
const GRID_M = 0.2;
/** A esta distancia de un mueble se considera que "se llega" a él (alcance del brazo). */
const REACH_M = 0.55;
/** Por debajo de esta parte del piso libre para caminar, el cuarto se siente lleno. */
const MIN_FREE_RATIO = 0.3;

const flat = (v: { x: number; z: number }): Point2 => ({ x: v.x, z: v.z });
const corners = (p: DesignPiece): Point2[] => footprint(p.position, p.dims, p.rotationY).corners.map(flat);
/** Estorba el paso: pisa el suelo, no es una alfombra y llega a la altura del cuerpo. */
const blocksWalking = (p: DesignPiece) => !p.supportId && p.mount === 'floor' && p.subcategory !== 'rug' && p.dims.y > 0.2;

/** Punto a medio metro de la puerta, hacia dentro: donde queda quien acaba de entrar. */
function doorways(shell: RoomShell): { id: string; inside: Point2 }[] {
  const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));
  return shell.openings.flatMap((o) => {
    const frame = frames.get(o.wallId);
    if (o.type !== 'door' || !frame) return [];
    const along = frame.startAtBase ? o.offsetM : frame.length - o.offsetM;
    const reach = WALKER.radiusM + 0.25;
    return [{ id: o.id, inside: { x: frame.base.x + frame.dir.x * along + frame.normal.x * reach, z: frame.base.z + frame.dir.z * along + frame.normal.z * reach } }];
  });
}

/** Celdas del piso a las que se llega caminando desde `start`. */
function reachableFrom(start: Point2, world: WalkWorld, shell: RoomShell): Point2[] {
  const cols = Math.ceil(shell.widthM / GRID_M) + 1;
  const rows = Math.ceil(shell.depthM / GRID_M) + 1;
  const at = (i: number, j: number): Point2 => ({ x: i * GRID_M, z: j * GRID_M });
  const seen = new Set<number>();
  const out: Point2[] = [];
  const queue: [number, number][] = [];
  const visit = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= cols || j >= rows || seen.has(j * cols + i)) return;
    seen.add(j * cols + i);
    if (!canStand(at(i, j), world)) return;
    out.push(at(i, j));
    queue.push([i, j]);
  };
  // Se empieza en la celda libre más cercana al punto de partida.
  const si = Math.round(start.x / GRID_M);
  const sj = Math.round(start.z / GRID_M);
  for (let r = 0; r <= 2 && !queue.length; r++) {
    for (let di = -r; di <= r && !queue.length; di++) for (let dj = -r; dj <= r && !queue.length; dj++) visit(si + di, sj + dj);
  }
  while (queue.length) {
    const [i, j] = queue.shift()!;
    visit(i + 1, j);
    visit(i - 1, j);
    visit(i, j + 1);
    visit(i, j - 1);
  }
  return out;
}

/**
 * Revisa el cuarto y devuelve los avisos, los más graves primero. Una lista vacía significa que
 * no se encontró nada que corregir.
 */
export function checkDesign(shell: RoomShell, pieces: readonly DesignPiece[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const room = roomPolygon(shell);

  // 1. Muebles que se salen del cuarto (un cambio de medidas puede dejarlos fuera).
  for (const p of pieces) {
    if (p.supportId || p.mount === 'wall') continue;
    if (!isInsideRoom(footprint(p.position, p.dims, p.rotationY), shell, 0.02)) {
      issues.push({ id: `outside:${p.id}`, kind: 'outside', severity: 'problem', title: `${p.name} se sale del cuarto`, detail: 'Muévelo hacia dentro o cambia las medidas del cuarto.', placementIds: [p.id] });
    }
  }

  const obstacles = pieces.filter(blocksWalking);
  const world = buildWalkWorld(
    shell,
    obstacles.map((p) => ({ corners: corners(p), baseY: p.position.y, heightM: p.dims.y })),
  );

  // 2. La puerta: quien entra tiene que poder dar un paso.
  const doors = doorways(shell);
  const open = doors.filter((d) => canStand(d.inside, world));
  for (const door of doors.filter((d) => !open.includes(d))) {
    const culprit = [...obstacles].sort((a, b) => distanceToBoundary(door.inside, corners(a)) - distanceToBoundary(door.inside, corners(b)))[0];
    issues.push({
      id: `door-blocked:${door.id}`,
      kind: 'door-blocked',
      severity: 'problem',
      title: 'La puerta queda bloqueada',
      detail: culprit ? `${culprit.name} no deja pasar al entrar. Sepáralo de la puerta.` : 'No queda sitio para entrar por la puerta.',
      placementIds: culprit ? [culprit.id] : [],
    });
  }

  // 3. ¿Se llega a cada mueble caminando desde la puerta?
  const start = open[0]?.inside ?? doors[0]?.inside;
  const reached = start ? reachableFrom(start, world, shell) : [];
  if (start && reached.length) {
    for (const p of obstacles) {
      const outline = corners(p);
      const near = reached.some((cell) => distanceToBoundary(cell, outline) <= WALKER.radiusM + REACH_M);
      if (!near) {
        issues.push({ id: `unreachable:${p.id}`, kind: 'unreachable', severity: 'warning', title: `No se puede llegar a ${p.name}`, detail: 'Otros muebles cierran el paso. Deja un pasillo de al menos 60 cm.', placementIds: [p.id] });
      }
    }
    // 4. ¿Queda sitio para moverse?
    const free = (reached.length * GRID_M * GRID_M) / Math.abs(signedArea(room));
    if (free < MIN_FREE_RATIO && obstacles.length > 1) {
      issues.push({
        id: 'crowded',
        kind: 'crowded',
        severity: 'warning',
        title: 'El cuarto está muy lleno',
        detail: `Solo queda libre para caminar cerca del ${Math.round(free * 100)} % del piso. Quita una pieza o elige muebles más pequeños.`,
        placementIds: [],
      });
    }
  }

  // 5. Muebles altos delante de una ventana: quitan luz.
  const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));
  for (const o of shell.openings) {
    const frame = frames.get(o.wallId);
    if (o.type !== 'window' || !frame) continue;
    const centre = frame.startAtBase ? o.offsetM : frame.length - o.offsetM;
    for (const p of obstacles) {
      if (p.position.y + p.dims.y <= o.sillHeightM + 0.25) continue;
      const pts = corners(p);
      const alongs = pts.map((c) => alongOf(frame, c));
      const overlap = Math.min(centre + o.widthM / 2, Math.max(...alongs)) - Math.max(centre - o.widthM / 2, Math.min(...alongs));
      const gap = Math.min(...pts.map((c) => distanceFromWall(frame, c)));
      if (overlap > o.widthM * 0.4 && gap < 0.4 && pts.every((c) => pointInPolygon(c, room, 0.05))) {
        issues.push({ id: `window-blocked:${o.id}:${p.id}`, kind: 'window-blocked', severity: 'tip', title: `${p.name} tapa una ventana`, detail: 'Un mueble más bajo o en otra pared dejaría entrar más luz.', placementIds: [p.id] });
      }
    }
  }

  // 6. Sin lámparas, de noche no se ve nada.
  if (pieces.length > 0 && !pieces.some((p) => p.category === 'lighting')) {
    issues.push({ id: 'no-light', kind: 'no-light', severity: 'tip', title: 'No hay ninguna lámpara', detail: 'Añade una de techo, de pie o de mesa: en el modo noche el cuarto queda a oscuras.', placementIds: [] });
  }

  const order: Record<IssueSeverity, number> = { problem: 0, warning: 1, tip: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
