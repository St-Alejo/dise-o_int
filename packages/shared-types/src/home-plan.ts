/**
 * Planta conjunta de una vivienda (lógica pura): dónde va cada cuarto respecto a los demás, cómo
 * se pegan entre sí al arrastrarlos y qué ocupa el conjunto. Cada cuarto conserva su propia planta;
 * aquí solo se decide el desplazamiento con el que se dibuja junto a los otros.
 */

export interface PlanPoint {
  x: number;
  z: number;
}

/** Un cuarto en la planta conjunta: su contorno (en sus propias coordenadas) y dónde se colocó. */
export interface HomeRoom {
  id: string;
  outline: readonly PlanPoint[];
  /** Desplazamiento guardado; sin él, el cuarto aún no se ha colocado. */
  position?: PlanPoint | null;
}

/** Rectángulo que ocupa un cuarto ya colocado, en metros de la planta conjunta. */
export interface RoomBox {
  id: string;
  x: number;
  z: number;
  widthM: number;
  depthM: number;
}

/** Separación entre cuartos que todavía no se han colocado a mano. */
export const HOME_GAP_M = 0.6;
/** A partir de qué ancho la fila de cuartos sin colocar salta a la siguiente. */
export const HOME_ROW_M = 14;
/** A qué distancia un borde se pega al de otro cuarto. */
export const HOME_SNAP_M = 0.3;

const round = (value: number) => Math.round(value * 100) / 100;

/** Caja que encierra un contorno, en sus propias coordenadas. */
export function outlineBounds(outline: readonly PlanPoint[]): { minX: number; minZ: number; widthM: number; depthM: number } {
  if (!outline.length) return { minX: 0, minZ: 0, widthM: 0, depthM: 0 };
  const xs = outline.map((p) => p.x);
  const zs = outline.map((p) => p.z);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  return { minX, minZ, widthM: Math.max(...xs) - minX, depthM: Math.max(...zs) - minZ };
}

/** El rectángulo que ocupa un cuarto colocado en `position`. */
export function roomBox(room: Pick<HomeRoom, 'id' | 'outline'>, position: PlanPoint): RoomBox {
  const b = outlineBounds(room.outline);
  return { id: room.id, x: position.x + b.minX, z: position.z + b.minZ, widthM: b.widthM, depthM: b.depthM };
}

/**
 * Dónde va cada cuarto. Los que ya se colocaron a mano se quedan; los demás se ponen en fila, a la
 * derecha de lo que haya, saltando de fila cuando esta se hace muy ancha.
 */
export function arrangeHome(rooms: readonly HomeRoom[]): Map<string, PlanPoint> {
  const placed = new Map<string, PlanPoint>();
  const boxes: RoomBox[] = [];
  for (const room of rooms) {
    if (!room.position) continue;
    placed.set(room.id, { x: room.position.x, z: room.position.z });
    boxes.push(roomBox(room, room.position));
  }
  const taken = homeBounds(boxes);
  // Los nuevos empiezan debajo de lo ya colocado, para no caer encima de nada.
  const startZ = boxes.length ? taken.z + taken.depthM + HOME_GAP_M : 0;
  const startX = boxes.length ? taken.x : 0;
  let x = startX;
  let z = startZ;
  let rowDepth = 0;
  for (const room of rooms) {
    if (room.position) continue;
    const b = outlineBounds(room.outline);
    if (x > startX && x + b.widthM - startX > HOME_ROW_M) {
      x = startX;
      z += rowDepth + HOME_GAP_M;
      rowDepth = 0;
    }
    placed.set(room.id, { x: round(x - b.minX), z: round(z - b.minZ) });
    x += b.widthM + HOME_GAP_M;
    rowDepth = Math.max(rowDepth, b.depthM);
  }
  return placed;
}

/** El rectángulo que encierra todos los cuartos (vacío en el origen si no hay ninguno). */
export function homeBounds(boxes: readonly RoomBox[]): Omit<RoomBox, 'id'> {
  if (!boxes.length) return { x: 0, z: 0, widthM: 0, depthM: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const z = Math.min(...boxes.map((b) => b.z));
  return {
    x,
    z,
    widthM: Math.max(...boxes.map((b) => b.x + b.widthM)) - x,
    depthM: Math.max(...boxes.map((b) => b.z + b.depthM)) - z,
  };
}

/** Dos cuartos se pisan (tocarse por un borde no cuenta: así es como comparten pared). */
export function boxesOverlap(a: RoomBox, b: RoomBox, slack = 0.01): boolean {
  return a.x < b.x + b.widthM - slack && b.x < a.x + a.widthM - slack && a.z < b.z + b.depthM - slack && b.z < a.z + a.depthM - slack;
}

/** Dos cuartos comparten pared: se tocan por un borde a lo largo de al menos `minM` metros. */
export function shareWall(a: RoomBox, b: RoomBox, minM = 0.5, slack = 0.02): boolean {
  const overlapX = Math.min(a.x + a.widthM, b.x + b.widthM) - Math.max(a.x, b.x);
  const overlapZ = Math.min(a.z + a.depthM, b.z + b.depthM) - Math.max(a.z, b.z);
  const touchX = Math.abs(a.x + a.widthM - b.x) <= slack || Math.abs(b.x + b.widthM - a.x) <= slack;
  const touchZ = Math.abs(a.z + a.depthM - b.z) <= slack || Math.abs(b.z + b.depthM - a.z) <= slack;
  return (touchX && overlapZ >= minM) || (touchZ && overlapX >= minM);
}

/** El ajuste más corto, dentro de la tolerancia, que lleva un borde a uno de los candidatos. */
function nearest(edges: readonly number[], targets: readonly number[], tolerance: number): number {
  let best = 0;
  let bestAbs = tolerance;
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge;
      if (Math.abs(delta) <= bestAbs) {
        best = delta;
        bestAbs = Math.abs(delta);
      }
    }
  }
  return best;
}

/**
 * Corrige el rectángulo que se está arrastrando para que sus bordes se peguen a los de los demás:
 * un lado contra el lado opuesto (comparten pared) o alineado con el mismo lado. Cada eje se
 * ajusta por separado y solo si hay algo a menos de `tolerance`.
 */
export function snapRoom(moving: RoomBox, others: readonly RoomBox[], tolerance = HOME_SNAP_M): { x: number; z: number } {
  // Solo atraen los cuartos que quedan cerca en el otro eje: alinearse con uno lejano confunde.
  const reach = tolerance * 2;
  const nearX = others.filter((o) => moving.z < o.z + o.depthM + reach && o.z < moving.z + moving.depthM + reach);
  const nearZ = others.filter((o) => moving.x < o.x + o.widthM + reach && o.x < moving.x + moving.widthM + reach);
  const dx = nearest(
    [moving.x, moving.x + moving.widthM],
    nearX.flatMap((o) => [o.x, o.x + o.widthM]),
    tolerance,
  );
  const dz = nearest(
    [moving.z, moving.z + moving.depthM],
    nearZ.flatMap((o) => [o.z, o.z + o.depthM]),
    tolerance,
  );
  return { x: round(moving.x + dx), z: round(moving.z + dz) };
}
