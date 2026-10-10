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

// ---------------------------------------------------------------------------
// Puertas, ventanas, esquinas y alto
// ---------------------------------------------------------------------------

/** Medidas con las que nace una puerta o una ventana nueva. */
export const NEW_OPENING = {
  door: { widthM: 0.9, heightM: 2.05, sillHeightM: 0 },
  window: { widthM: 1.2, heightM: 1.2, sillHeightM: 0.9 },
} as const;

const same = (shell: RoomShell): RoomEdit => ({ shell, shift: { x: 0, z: 0 } });
const withWindowFlags = (shell: RoomShell): RoomShell => ({
  ...shell,
  walls: shell.walls.map((w) => ({ ...w, hasWindow: shell.openings.some((o) => o.wallId === w.id && o.type === 'window') })),
});
const freeId = (taken: readonly string[], prefix: string): string => {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}-${n}`)) return `${prefix}-${n}`;
};

/**
 * Añade una puerta o una ventana a una pared, lo más cerca posible de `nearM` (por defecto, el
 * centro) donde quepa sin pisar otra abertura. Si la pared está llena o es muy corta, lanza.
 */
export function addOpening(shell: RoomShell, wallId: string, type: Opening['type'], nearM?: number): RoomShell {
  const wall = shell.walls.find((w) => w.id === wallId);
  if (!wall) throw new RoomGeometryError(`La pared ${wallId} no existe`);
  const length = wallLength(wall);
  const size = NEW_OPENING[type];
  const margin = ROOM_LIMITS.openingMarginM;
  const widthM = Math.min(size.widthM, length - 2 * margin);
  const heightM = Math.min(size.heightM, shell.heightM - size.sillHeightM - margin);
  const label = type === 'door' ? 'una puerta' : 'una ventana';
  if (widthM < 0.4 || heightM < 0.4) throw new RoomGeometryError(`En esa pared no cabe ${label}`);
  const half = widthM / 2;
  const wanted = Math.min(length - margin - half, Math.max(margin + half, nearM ?? length / 2));
  const others = shell.openings.filter((o) => o.wallId === wallId);
  const fits = (at: number) =>
    at - half >= margin - 1e-9 && at + half <= length - margin + 1e-9 && others.every((o) => Math.abs(o.offsetM - at) >= o.widthM / 2 + half + margin - 1e-9);
  // Se prueba cada 5 cm, alejándose del punto pedido hacia los dos lados.
  let offsetM: number | null = null;
  for (let d = 0; d <= length && offsetM === null; d += 0.05) {
    if (fits(wanted + d)) offsetM = wanted + d;
    else if (fits(wanted - d)) offsetM = wanted - d;
  }
  if (offsetM === null) throw new RoomGeometryError(`En esa pared no queda sitio para ${label}`);
  const opening: Opening = {
    id: freeId(
      shell.openings.map((o) => o.id),
      type === 'door' ? 'door' : 'win',
    ),
    type,
    wallId,
    widthM: r3(widthM),
    heightM: r3(heightM),
    offsetM: r3(offsetM),
    sillHeightM: size.sillHeightM,
  };
  const next = withWindowFlags({ ...shell, openings: [...shell.openings, opening] });
  validateOpenings(next);
  return next;
}

export function removeOpening(shell: RoomShell, openingId: string): RoomShell {
  if (!shell.openings.some((o) => o.id === openingId)) throw new RoomGeometryError(`La abertura ${openingId} no existe`);
  return withWindowFlags({ ...shell, openings: shell.openings.filter((o) => o.id !== openingId) });
}

/** Cambia el ancho, el alto o el alféizar de una abertura; si así no cabe o pisa a otra, lanza. */
export function resizeOpening(shell: RoomShell, openingId: string, size: Partial<Pick<Opening, 'widthM' | 'heightM' | 'sillHeightM'>>): RoomShell {
  if (!shell.openings.some((o) => o.id === openingId)) throw new RoomGeometryError(`La abertura ${openingId} no existe`);
  for (const v of Object.values(size)) if (!Number.isFinite(v) || (v as number) < 0) throw new RoomGeometryError('Esa medida no es válida');
  if ((size.widthM ?? 1) < 0.4 || (size.heightM ?? 1) < 0.4) throw new RoomGeometryError('Una abertura mide al menos 40 cm');
  const next = { ...shell, openings: shell.openings.map((o) => (o.id === openingId ? { ...o, ...size } : o)) };
  validateOpenings(next);
  return next;
}

/** Punto del cuarto donde está el centro de una abertura. */
function openingCentre(shell: RoomShell, o: Opening): Point2 | null {
  const wall = shell.walls.find((w) => w.id === o.wallId);
  if (!wall) return null;
  const len = wallLength(wall) || 1;
  return { x: wall.start.x + ((wall.end.x - wall.start.x) / len) * o.offsetM, z: wall.start.z + ((wall.end.z - wall.start.z) / len) * o.offsetM };
}

/** Arma el cuarto con otra lista de paredes (cambió su número): cada abertura va a la pared nueva que la contiene. */
function rewall(shell: RoomShell, walls: RoomShell['walls']): RoomEdit {
  const openings = dropOverlappingOpenings(
    shell.openings.flatMap((o) => {
      const centre = openingCentre(shell, o);
      if (!centre) return [];
      let best: { wall: RoomShell['walls'][number]; along: number; d: number } | null = null;
      for (const wall of walls) {
        const len = wallLength(wall) || 1;
        const along = ((centre.x - wall.start.x) * (wall.end.x - wall.start.x) + (centre.z - wall.start.z) * (wall.end.z - wall.start.z)) / len;
        const t = Math.min(len, Math.max(0, along));
        const d = Math.hypot(wall.start.x + ((wall.end.x - wall.start.x) / len) * t - centre.x, wall.start.z + ((wall.end.z - wall.start.z) / len) * t - centre.z);
        if (!best || d < best.d - 1e-9) best = { wall, along: t, d };
      }
      // Una abertura que quedó lejos de toda pared (se quitó la esquina que la sostenía) se pierde.
      if (!best || best.d > 0.05) return [];
      return [fitOpening({ ...o, wallId: best.wall.id, offsetM: r3(best.along) }, wallLength(best.wall), shell.heightM)];
    }),
  );
  const { shape: _shape, ...rest } = shell;
  const draft = withWindowFlags({ ...rest, walls, openings });
  const next: RoomShell = isBoxRoom(draft) ? draft : { ...draft, shape: 'free' };
  validateRoomShell(next);
  return same(next);
}

/** Parte una pared en dos añadiendo una esquina (por defecto en su mitad): después se puede mover. */
export function splitWall(shell: RoomShell, wallId: string, fraction = 0.5): RoomEdit {
  const index = shell.walls.findIndex((w) => w.id === wallId);
  const wall = shell.walls[index];
  if (!wall) throw new RoomGeometryError(`La pared ${wallId} no existe`);
  if (shell.walls.length >= 64) throw new RoomGeometryError('El cuarto ya tiene demasiadas paredes');
  const t = Math.min(0.9, Math.max(0.1, fraction));
  const mid = { x: r3(wall.start.x + (wall.end.x - wall.start.x) * t), y: 0, z: r3(wall.start.z + (wall.end.z - wall.start.z) * t) };
  const second = {
    ...wall,
    id: freeId(
      shell.walls.map((w) => w.id),
      'w',
    ),
    start: mid,
  };
  const walls = [...shell.walls.slice(0, index), { ...wall, end: mid }, second, ...shell.walls.slice(index + 1)];
  return rewall(shell, walls);
}

/** Quita una esquina (donde empieza la pared `index`): sus dos paredes pasan a ser una sola. */
export function removeVertex(shell: RoomShell, index: number): RoomEdit {
  const n = shell.walls.length;
  if (index < 0 || index >= n) throw new RoomGeometryError('Esa esquina no existe');
  if (n <= 3) throw new RoomGeometryError('Un cuarto necesita al menos tres paredes');
  const before = shell.walls[(index - 1 + n) % n]!;
  const removed = shell.walls[index]!;
  // Se conserva el id histórico (w-back, w-left…) si alguna de las dos lo tenía.
  const numbered = (id: string) => /^w-\d+$/.test(id);
  const merged = { ...before, id: numbered(before.id) && !numbered(removed.id) ? removed.id : before.id, end: removed.end };
  const walls = shell.walls.filter((_, i) => i !== index).map((w) => (w === before ? merged : w));
  const b = polygonBounds(walls.map((w) => ({ x: w.start.x, z: w.start.z })));
  const shift = { x: r3(-b.minX), z: r3(-b.minZ) };
  const slide = (v: Vector3): Vector3 => ({ x: r3(v.x + shift.x), y: 0, z: r3(v.z + shift.z) });
  // Las aberturas se buscan en el cuarto ya corrido: se corre también el de partida.
  const shifted: RoomShell = {
    ...shell,
    widthM: r3(b.maxX - b.minX),
    depthM: r3(b.maxZ - b.minZ),
    walls: shell.walls.map((w) => ({ ...w, start: slide(w.start), end: slide(w.end) })),
  };
  const edit = rewall(
    shifted,
    walls.map((w) => ({ ...w, start: slide(w.start), end: slide(w.end) })),
  );
  return { shell: edit.shell, shift };
}

/** Cambia el alto del cuarto; las puertas y ventanas que ya no caben se recortan. */
export function setRoomHeight(shell: RoomShell, heightM: number): RoomShell {
  const { minHeightM, maxHeightM } = ROOM_LIMITS;
  if (!Number.isFinite(heightM) || heightM < minHeightM || heightM > maxHeightM) {
    throw new RoomGeometryError(`El alto del cuarto debe estar entre ${minHeightM} y ${maxHeightM} m`);
  }
  const walls = new Map(shell.walls.map((w) => [w.id, w]));
  const next = { ...shell, heightM: r3(heightM), openings: shell.openings.map((o) => fitOpening(o, wallLength(walls.get(o.wallId)!), heightM)) };
  validateOpenings(next);
  return next;
}
