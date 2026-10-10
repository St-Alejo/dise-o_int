/**
 * Recorrer el cuarto a pie (lógica pura, sin Three.js): una persona es un círculo en planta que
 * avanza hacia donde mira, no atraviesa paredes ni muebles y se desliza a lo largo de ellos en vez
 * de quedarse pegada. La web solo traduce teclas y gestos a `WalkInput` y pinta la cámara.
 *
 * Giro (`yaw`) igual que una cámara de Three.js: con 0 se mira hacia −z (la pared del fondo) y
 * crece al girar a la izquierda.
 */
import type { RoomShell } from './domain.js';
import { roomCenter, roomPolygon } from './geometry.js';
import { closestOnBoundary, closestOnSegment, distanceToBoundary, pointInPolygon, type Point2 } from './polygon.js';

export const WALKER = {
  /** Medio ancho de hombros: lo que la persona se separa de paredes y muebles. */
  radiusM: 0.25,
  eyeHeightM: 1.6,
  walkMps: 1.5,
  runMps: 3,
  /** Giro con el teclado, en radianes por segundo. */
  turnRps: 1.8,
} as const;

/** Tramo máximo que se avanza de una vez: menor que el radio, para no saltarse una pared. */
const MAX_STEP_M = 0.08;

export interface WalkWorld {
  /** Planta del cuarto: fuera de ella no se camina. */
  room: Point2[];
  walls: [Point2, Point2][];
  /** Huellas de lo que estorba el paso (muebles). */
  obstacles: Point2[][];
}

export interface WalkerState {
  x: number;
  z: number;
  yaw: number;
}

export interface WalkInput {
  /** 1 = adelante, −1 = atrás. */
  forward: number;
  /** 1 = a la derecha, −1 = a la izquierda. */
  strafe: number;
  /** 1 = girar a la izquierda, −1 = a la derecha (teclado). */
  turn?: number;
  run?: boolean;
}

/** Algo que ocupa sitio en el cuarto: su huella en planta y entre qué alturas está. */
export interface WalkBody {
  corners: readonly Point2[];
  baseY: number;
  heightM: number;
}

/**
 * El mundo por el que se camina. Estorba lo que queda a la altura del cuerpo: una alfombra se
 * pisa y una lámpara de techo o un cuadro alto no molestan. Las puertas están cerradas: el
 * recorrido es dentro del cuarto.
 */
export function buildWalkWorld(shell: Pick<RoomShell, 'walls' | 'widthM' | 'depthM'>, bodies: readonly WalkBody[] = []): WalkWorld {
  const flat = (v: { x: number; z: number }): Point2 => ({ x: v.x, z: v.z });
  return {
    room: roomPolygon(shell),
    walls: shell.walls.map((w) => [flat(w.start), flat(w.end)]),
    obstacles: bodies.filter((b) => b.baseY < WALKER.eyeHeightM && b.baseY + b.heightM > 0.2).map((b) => b.corners.map(flat)),
  };
}

const centroid = (poly: readonly Point2[]): Point2 => ({
  x: poly.reduce((sum, v) => sum + v.x, 0) / poly.length,
  z: poly.reduce((sum, v) => sum + v.z, 0) / poly.length,
});

/** Saca el círculo de lo que esté pisando: paredes primero, luego muebles; varias pasadas para los rincones. */
function resolve(point: Point2, world: WalkWorld, radius: number): Point2 {
  let p = point;
  /** A un radio de `edge`, en la dirección de `toward` (que no puede coincidir con `edge`). */
  const offset = (edge: Point2, toward: Point2): Point2 => {
    const d = Math.hypot(toward.x - edge.x, toward.z - edge.z) || 1;
    return { x: edge.x + ((toward.x - edge.x) / d) * radius, z: edge.z + ((toward.z - edge.z) / d) * radius };
  };
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const [a, b] of world.walls) {
      const edge = closestOnSegment(p, a, b);
      const d = Math.hypot(p.x - edge.x, p.z - edge.z);
      if (d >= radius - 1e-9) continue;
      // Justo sobre la pared no hay dirección de salida: se empuja hacia el interior del cuarto.
      p = offset(edge, d > 1e-9 ? p : centroid(world.room));
      moved = true;
    }
    for (const quad of world.obstacles) {
      const edge = closestOnBoundary(p, quad);
      const d = Math.hypot(p.x - edge.x, p.z - edge.z);
      const inside = pointInPolygon(p, quad);
      if (!inside && d >= radius - 1e-9) continue;
      const middle = centroid(quad);
      if (d <= 1e-9) {
        // Justo sobre el borde del mueble: se sale alejándose de su centro.
        p = offset(edge, { x: 2 * edge.x - middle.x, z: 2 * edge.z - middle.z });
      } else if (inside) {
        // Dentro del mueble: se sale por el borde más cercano y se queda a un radio de él.
        p = offset(edge, { x: 2 * edge.x - p.x, z: 2 * edge.z - p.z });
      } else {
        p = offset(edge, p);
      }
      moved = true;
    }
    if (!moved) break;
  }
  return p;
}

/** ¿Se puede estar de pie en este punto? Dentro del cuarto y sin pisar paredes ni muebles. */
export function canStand(point: Point2, world: WalkWorld, radius: number = WALKER.radiusM): boolean {
  if (!pointInPolygon(point, world.room)) return false;
  const settled = resolve(point, world, radius);
  return Math.hypot(settled.x - point.x, settled.z - point.z) < 1e-6;
}

/** Avanza `(dx, dz)` en tramos cortos, deslizándose contra lo que encuentre. */
function advance(from: Point2, dx: number, dz: number, world: WalkWorld, radius: number): Point2 {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / MAX_STEP_M));
  let p = from;
  for (let i = 0; i < steps; i++) {
    const next = resolve({ x: p.x + dx / steps, z: p.z + dz / steps }, world, radius);
    if (!pointInPolygon(next, world.room)) break; // red de seguridad: nunca fuera del cuarto
    p = next;
  }
  return p;
}

/** Un paso de tiempo del caminante con las teclas pulsadas. */
export function stepWalker(state: WalkerState, input: WalkInput, dt: number, world: WalkWorld, radius: number = WALKER.radiusM): WalkerState {
  const yaw = state.yaw + (input.turn ?? 0) * WALKER.turnRps * dt;
  const push = Math.hypot(input.forward, input.strafe);
  if (push < 1e-6 || dt <= 0) return { ...state, yaw };
  const distance = ((input.run ? WALKER.runMps : WALKER.walkMps) * dt) / Math.max(1, push);
  // Adelante = (−sin, −cos); derecha = (cos, −sin).
  const dx = (-Math.sin(yaw) * input.forward + Math.cos(yaw) * input.strafe) * distance;
  const dz = (-Math.cos(yaw) * input.forward - Math.sin(yaw) * input.strafe) * distance;
  const p = advance({ x: state.x, z: state.z }, dx, dz, world, radius);
  return { x: p.x, z: p.z, yaw };
}

/**
 * Un paso hacia un punto elegido con el cursor ("ir allí"). `arrived` es true al llegar o al
 * quedar bloqueado: en los dos casos ya no tiene sentido seguir empujando.
 */
export function stepToward(
  state: WalkerState,
  target: Point2,
  dt: number,
  world: WalkWorld,
  radius: number = WALKER.radiusM,
): { state: WalkerState; arrived: boolean } {
  const toX = target.x - state.x;
  const toZ = target.z - state.z;
  const remaining = Math.hypot(toX, toZ);
  if (remaining < 0.05) return { state, arrived: true };
  const distance = Math.min(remaining, WALKER.runMps * dt);
  const p = advance({ x: state.x, z: state.z }, (toX / remaining) * distance, (toZ / remaining) * distance, world, radius);
  const progressed = Math.hypot(p.x - state.x, p.z - state.z);
  return { state: { ...state, x: p.x, z: p.z }, arrived: progressed < distance * 0.2 };
}

/** Metros libres en línea recta desde `from` en la dirección de `yaw` (hasta `max`). */
export function clearAhead(from: Point2, yaw: number, world: WalkWorld, max = 8): number {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  const step = 0.25;
  let run = 0;
  while (run + step <= max && canStand({ x: from.x + dx * (run + step), z: from.z + dz * (run + step) }, world)) run += step;
  return run;
}

/** Holgura alrededor de un punto: distancia a la pared o al mueble más cercano. */
function clearance(p: Point2, world: WalkWorld): number {
  let best = distanceToBoundary(p, world.room);
  for (const quad of world.obstacles) best = Math.min(best, distanceToBoundary(p, quad));
  return best;
}

/**
 * Dónde empezar el recorrido y hacia dónde mirar: un lugar despejado desde el que se vea un buen
 * tramo de cuarto. Empezar en el centro mirando al fondo puede dejar a la persona a un palmo de
 * una pared o de un mueble; aquí se puntúa cada punto libre por su holgura y por lo lejos que se
 * ve en su mejor dirección.
 */
export function walkStart(shell: Pick<RoomShell, 'walls' | 'widthM' | 'depthM'>, world: WalkWorld): WalkerState {
  const fallback = { ...roomCenter(shell), yaw: 0 };
  let best: { state: WalkerState; score: number } | null = null;
  const step = 0.25;
  for (let x = step; x < shell.widthM; x += step) {
    for (let z = step; z < shell.depthM; z += step) {
      const p = { x, z };
      if (!canStand(p, world)) continue;
      let view = { yaw: 0, run: -1 };
      // Ocho direcciones; a igual vista gana mirar hacia el fondo (yaw 0), que va primero.
      for (let k = 0; k < 8; k++) {
        const yaw = (k * Math.PI) / 4;
        const run = clearAhead(p, yaw, world);
        if (run > view.run + 1e-9) view = { yaw, run };
      }
      const score = Math.min(1.5, clearance(p, world)) + 0.35 * view.run;
      if (!best || score > best.score + 1e-9) best = { state: { x, z, yaw: view.yaw }, score };
    }
  }
  return best?.state ?? fallback;
}
