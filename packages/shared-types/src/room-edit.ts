/**
 * Editar la planta del cuarto a mano (lógica pura): mover una pared, mover una esquina o deslizar
 * una puerta o ventana por su pared. Cada operación devuelve un cuarto nuevo y válido, o lanza
 * `RoomGeometryError` si el resultado no lo sería (paredes que se cruzan, lados demasiado cortos).
 *
 * Las paredes conservan su id: lo que cuelga de ellas y sus aberturas las siguen. Como la caja del
 * cuarto vive pegada al origen, empujar la pared izquierda o la del fondo corre todo lo demás:
 * `shift` dice cuánto, y `carryPlacements` lleva los muebles consigo.
 */
import type { FurniturePlacement, Opening, RoomShape, RoomShell, Vector3 } from './domain.js';
import {
  ROOM_LIMITS,
  RoomGeometryError,
  clampToRoom,
  dropOverlappingOpenings,
  fitOpening,
  isBoxRoom,
  roomPolygon,
  validateOpenings,
  validateRoomShell,
  wallLength,
} from './geometry.js';
import { polygonBounds, type Point2 } from './polygon.js';
import { alongOf, positionOnWall, wallFrames } from './walls.js';

export interface RoomEdit {
  shell: RoomShell;
  /** Cuánto se corrió el origen: lo que hay que sumarle a lo que ya estaba dentro del cuarto. */
  shift: Point2;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0;

/** Tras editar a mano, la planta deja de ser una plantilla salvo que siga siendo un rectángulo. */
function shapeAfter(before: RoomShell, after: RoomShell, keepTemplate: boolean): RoomShape | undefined {
  if (isBoxRoom(after)) return before.shape === undefined ? undefined : 'rect';
  if (keepTemplate && before.shape && before.shape !== 'rect') return before.shape;
  return 'free';
}

/** Arma el cuarto con los vértices nuevos: lo lleva al origen y reacomoda las aberturas. */
function rebuild(shell: RoomShell, points: readonly Point2[], keepTemplate: boolean): RoomEdit {
  const b = polygonBounds(points);
  const shift = { x: r3(-b.minX), z: r3(-b.minZ) };
  const moved = points.map((p) => ({ x: r3(p.x + shift.x), z: r3(p.z + shift.z) }));
  const widthM = r3(b.maxX - b.minX);
  const depthM = r3(b.maxZ - b.minZ);
  const { minSideM, maxSideM } = ROOM_LIMITS;
  if (Math.min(widthM, depthM) < minSideM || Math.max(widthM, depthM) > maxSideM) {
    throw new RoomGeometryError(`El cuarto debe medir entre ${minSideM} y ${maxSideM} m de lado`);
  }
  const walls = shell.walls.map((w, i) => {
    const a = moved[i]!;
    const c = moved[(i + 1) % moved.length]!;
    return { ...w, start: { x: a.x, y: 0, z: a.z }, end: { x: c.x, y: 0, z: c.z } };
  });

  // Cada abertura se queda donde estaba en el cuarto (no a la misma distancia del inicio de su pared).
  const openings: Opening[] = dropOverlappingOpenings(
    shell.openings.flatMap((o) => {
      const index = shell.walls.findIndex((w) => w.id === o.wallId);
      const old = shell.walls[index];
      const next = walls[index];
      if (!old || !next) return [];
      const oldLen = wallLength(old) || 1;
      const centre = {
        x: old.start.x + ((old.end.x - old.start.x) / oldLen) * o.offsetM + shift.x,
        z: old.start.z + ((old.end.z - old.start.z) / oldLen) * o.offsetM + shift.z,
      };
      const len = wallLength(next) || 1;
      const along = ((centre.x - next.start.x) * (next.end.x - next.start.x) + (centre.z - next.start.z) * (next.end.z - next.start.z)) / len;
      return [fitOpening({ ...o, offsetM: r3(along) }, len, shell.heightM)];
    }),
  );

  const draft: RoomShell = {
    ...shell,
    widthM,
    depthM,
    walls: walls.map((w) => ({ ...w, hasWindow: openings.some((o) => o.wallId === w.id && o.type === 'window') })),
    openings,
  };
  const shape = shapeAfter(shell, draft, keepTemplate);
  const { shape: _old, ...rest } = draft;
  const next: RoomShell = shape ? { ...rest, shape } : rest;
  validateRoomShell(next);
  return { shell: next, shift };
}

/**
 * Mueve una pared en paralelo a sí misma: `outwardM` positivo agranda el cuarto, negativo lo
 * achica. Sus dos esquinas resbalan por las paredes vecinas, que se alargan o se acortan.
 */
export function moveWall(shell: RoomShell, wallId: string, outwardM: number): RoomEdit {
  const index = shell.walls.findIndex((w) => w.id === wallId);
  if (index < 0) throw new RoomGeometryError(`La pared ${wallId} no existe`);
  const poly = roomPolygon(shell);
  const n = poly.length;
  const normal = wallFrames(shell)[index]!.normal;
  const a = poly[index]!;
  const b = poly[(index + 1) % n]!;
  // Un punto cualquiera de la recta nueva de la pared.
  const onLine = { x: a.x - normal.x * outwardM, z: a.z - normal.z * outwardM };
  const slide = (corner: Point2, neighbour: Point2): Point2 => {
    const along = (corner.x - neighbour.x) * normal.x + (corner.z - neighbour.z) * normal.z;
    // Vecina paralela a la pared (dos tramos en línea): la esquina simplemente se traslada.
    if (Math.abs(along) < 1e-6) return { x: corner.x - normal.x * outwardM, z: corner.z - normal.z * outwardM };
    const t = ((onLine.x - neighbour.x) * normal.x + (onLine.z - neighbour.z) * normal.z) / along;
    return { x: neighbour.x + (corner.x - neighbour.x) * t, z: neighbour.z + (corner.z - neighbour.z) * t };
  };
  const next = [...poly];
  next[index] = slide(a, poly[(index - 1 + n) % n]!);
  next[(index + 1) % n] = slide(b, poly[(index + 2) % n]!);
  return rebuild(shell, next, true);
}

/** Lleva una esquina (donde empieza la pared `index`) a otro punto; la planta pasa a ser de forma libre. */
export function moveVertex(shell: RoomShell, index: number, to: Point2): RoomEdit {
  const poly = roomPolygon(shell);
  if (index < 0 || index >= poly.length) throw new RoomGeometryError('Esa esquina no existe');
  const next = [...poly];
  next[index] = { x: to.x, z: to.z };
  return rebuild(shell, next, false);
}

/** Desliza una puerta o ventana por su pared hasta `offsetM` (medido desde el inicio de la pared). */
export function moveOpening(shell: RoomShell, openingId: string, offsetM: number): RoomShell {
  const opening = shell.openings.find((o) => o.id === openingId);
  const wall = opening && shell.walls.find((w) => w.id === opening.wallId);
  if (!opening || !wall) throw new RoomGeometryError(`La abertura ${openingId} no existe`);
  const edge = ROOM_LIMITS.openingMarginM + opening.widthM / 2;
  const clamped = r3(Math.min(wallLength(wall) - edge, Math.max(edge, offsetM)));
  const next = { ...shell, openings: shell.openings.map((o) => (o.id === openingId ? { ...o, offsetM: clamped } : o)) };
  validateOpenings(next);
  return next;
}

/**
 * Lleva los muebles al cuarto editado: todos se corren con el origen; los de pared siguen pegados
 * a su pared, los de piso se meten dentro si quedaron fuera y lo apoyado acompaña a su soporte.
 */
export function carryPlacements(
  placements: readonly FurniturePlacement[],
  dimensionsOf: (p: FurniturePlacement) => Vector3 | undefined,
  edit: RoomEdit,
): FurniturePlacement[] {
  const { shell, shift } = edit;
  const frames = new Map(wallFrames(shell).map((f) => [f.id, f]));
  const pushed = new Map<string, Point2>();
  const first = placements.map((p) => {
    const dims = dimensionsOf(p);
    const base = { x: p.position.x + shift.x, y: p.position.y, z: p.position.z + shift.z };
    if (!dims || p.supportId) return { ...p, position: base };
    const frame = p.wallId ? frames.get(p.wallId) : undefined;
    let next: FurniturePlacement;
    if (frame) {
      const half = Math.min(dims.x, frame.length) / 2;
      const along = Math.min(frame.length - half, Math.max(half, alongOf(frame, base)));
      next = { ...p, position: positionOnWall(frame, along, base.y, dims.z), rotationY: frame.rotationY };
    } else {
      next = { ...p, position: clampToRoom(base, dims, p.rotationY, shell) };
    }
    pushed.set(p.id, { x: next.position.x - base.x, z: next.position.z - base.z });
    return next;
  });
  return first.map((p) => {
    const extra = p.supportId ? pushed.get(p.supportId) : undefined;
    return extra ? { ...p, position: { x: p.position.x + extra.x, y: p.position.y, z: p.position.z + extra.z } } : p;
  });
}
