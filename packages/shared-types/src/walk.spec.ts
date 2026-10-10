import { describe, expect, it } from 'vitest';
import { createRectangularShell, footprint } from './geometry.js';
import { pointInPolygon } from './polygon.js';
import { buildRoomShape } from './room-templates.js';
import { WALKER, buildWalkWorld, canStand, stepToward, stepWalker, walkStart, type WalkBody, type WalkerState } from './walk.js';

const room = createRectangularShell(4, 3, 2.6);
/** Sofá de 2 × 1 contra la pared del fondo, centrado. */
const sofa: WalkBody = { corners: footprint({ x: 2, y: 0, z: 0.5 }, { x: 2, y: 0.8, z: 1 }, 0).corners, baseY: 0, heightM: 0.8 };
const R = WALKER.radiusM;

/** Mantiene las teclas pulsadas `seconds` segundos a 60 cuadros por segundo. */
function hold(state: WalkerState, input: Parameters<typeof stepWalker>[1], seconds: number, world = buildWalkWorld(room)): WalkerState {
  let s = state;
  for (let i = 0; i < Math.round(seconds * 60); i++) s = stepWalker(s, input, 1 / 60, world);
  return s;
}

describe('caminar por el cuarto', () => {
  it('avanza hacia donde mira, a paso de persona', () => {
    const end = hold({ x: 2, z: 2.5, yaw: 0 }, { forward: 1, strafe: 0 }, 1);
    expect(end.x).toBeCloseTo(2);
    expect(end.z).toBeCloseTo(2.5 - WALKER.walkMps, 1);
    // Girado 90° a la izquierda se mira hacia −x; a la derecha del que mira queda −z.
    const left = hold({ x: 2, z: 1.5, yaw: Math.PI / 2 }, { forward: 1, strafe: 0 }, 0.5);
    expect(left.x).toBeLessThan(1.4);
    expect(left.z).toBeCloseTo(1.5);
    const strafed = hold({ x: 2, z: 1.5, yaw: Math.PI / 2 }, { forward: 0, strafe: 1 }, 0.5);
    expect(strafed.z).toBeLessThan(0.9);
  });

  it('moverse en diagonal no es más rápido y correr sí', () => {
    const straight = hold({ x: 2, z: 2.5, yaw: 0 }, { forward: 1, strafe: 0 }, 0.5);
    const diagonal = hold({ x: 2, z: 2.5, yaw: 0 }, { forward: 1, strafe: 1 }, 0.5);
    expect(Math.hypot(diagonal.x - 2, diagonal.z - 2.5)).toBeCloseTo(2.5 - straight.z, 2);
    const run = hold({ x: 2, z: 2.5, yaw: 0 }, { forward: 1, strafe: 0, run: true }, 0.5);
    expect(2.5 - run.z).toBeCloseTo((2.5 - straight.z) * 2, 1);
  });

  it('no atraviesa las paredes: se queda a un radio de ellas', () => {
    const end = hold({ x: 2, z: 1.5, yaw: 0 }, { forward: 1, strafe: 0 }, 5);
    expect(end.z).toBeCloseTo(R, 2);
    const corner = hold({ x: 2, z: 1.5, yaw: Math.PI / 4 }, { forward: 1, strafe: 0 }, 6);
    expect(corner.x).toBeCloseTo(R, 2);
    expect(corner.z).toBeCloseTo(R, 2);
  });

  it('se desliza a lo largo de la pared en vez de quedarse pegado', () => {
    // Mirando en diagonal hacia la pared del fondo: llega a ella y sigue avanzando de lado.
    const end = hold({ x: 3, z: 0.6, yaw: Math.PI / 4 }, { forward: 1, strafe: 0 }, 1.5);
    expect(end.z).toBeCloseTo(R, 2);
    expect(end.x).toBeLessThan(2);
  });

  it('no entra en los muebles, pero pisa las alfombras y pasa bajo lo que cuelga', () => {
    const world = buildWalkWorld(room, [sofa]);
    const end = hold({ x: 2, z: 2.5, yaw: 0 }, { forward: 1, strafe: 0 }, 4, world);
    // El sofá llega hasta z = 1: la persona se queda a un radio de su frente.
    expect(end.z).toBeCloseTo(1 + R, 2);

    const rug: WalkBody = { corners: footprint({ x: 2, y: 0, z: 2 }, { x: 2, y: 0.02, z: 1.4 }, 0).corners, baseY: 0, heightM: 0.02 };
    const pendant: WalkBody = { corners: footprint({ x: 2, y: 0, z: 2 }, { x: 0.5, y: 0.5, z: 0.5 }, 0).corners, baseY: 2.1, heightM: 0.5 };
    expect(buildWalkWorld(room, [rug, pendant]).obstacles).toHaveLength(0);
    expect(buildWalkWorld(room, [rug, pendant, sofa]).obstacles).toHaveLength(1);
  });

  it('rodea un mueble deslizándose por su borde', () => {
    const world = buildWalkWorld(room, [sofa]);
    // Camina hacia el sofá un poco en diagonal: al tocarlo se corre hacia un lado.
    const end = hold({ x: 2.2, z: 2.5, yaw: -0.5 }, { forward: 1, strafe: 0 }, 3, world);
    expect(end.x).toBeGreaterThan(3 + R - 0.05);
    expect(canStand(end, world)).toBe(true);
  });

  it('girar con el teclado cambia hacia dónde se mira sin moverse', () => {
    const end = hold({ x: 2, z: 1.5, yaw: 0 }, { forward: 0, strafe: 0, turn: 1 }, 1);
    expect(end).toMatchObject({ x: 2, z: 1.5 });
    expect(end.yaw).toBeCloseTo(WALKER.turnRps, 2);
  });
});

describe('caminar por un cuarto en L', () => {
  // 5 × 4 sin la esquina del frente a la derecha (2 × 1,5): la muesca empieza en x = 3, z = 2,5.
  const shell = buildRoomShape('L', { widthM: 5, depthM: 4, heightM: 2.6, notchWidthM: 2, notchDepthM: 1.5 });
  const world = buildWalkWorld(shell);

  it('la muesca no se pisa: caminar hacia ella termina contra su pared', () => {
    // Desde el ala derecha hacia el frente (yaw = π mira a +z): choca con el fondo de la muesca.
    let s: WalkerState = { x: 4, z: 1, yaw: Math.PI };
    for (let i = 0; i < 300; i++) s = stepWalker(s, { forward: 1, strafe: 0 }, 1 / 60, world);
    expect(s.z).toBeCloseTo(2.5 - R, 2);
    expect(pointInPolygon(s, world.room)).toBe(true);
  });

  it('se recorre de punta a punta doblando la esquina sin salirse nunca', () => {
    // Del ala derecha al fondo de la parte izquierda: primero hacia −x, luego hacia +z.
    let s: WalkerState = { x: 4.5, z: 1.2, yaw: Math.PI / 2 };
    for (let i = 0; i < 180; i++) {
      s = stepWalker(s, { forward: 1, strafe: 0 }, 1 / 60, world);
      expect(pointInPolygon(s, world.room)).toBe(true);
    }
    s = { ...s, yaw: Math.PI };
    for (let i = 0; i < 240; i++) {
      s = stepWalker(s, { forward: 1, strafe: 0 }, 1 / 60, world);
      expect(pointInPolygon(s, world.room)).toBe(true);
    }
    expect(s.x).toBeLessThan(3 - R + 0.01);
    expect(s.z).toBeCloseTo(4 - R, 2);
  });
});

describe('ir a un punto', () => {
  it('camina en línea recta hasta llegar', () => {
    const world = buildWalkWorld(room);
    let s: WalkerState = { x: 1, z: 2.5, yaw: 0 };
    let arrived = false;
    for (let i = 0; i < 300 && !arrived; i++) ({ state: s, arrived } = stepToward(s, { x: 3, z: 1 }, 1 / 60, world));
    expect(arrived).toBe(true);
    expect(Math.hypot(s.x - 3, s.z - 1)).toBeLessThan(0.06);
  });

  it('si el punto queda dentro de un mueble, se detiene al toparse con él', () => {
    const world = buildWalkWorld(room, [sofa]);
    let s: WalkerState = { x: 2, z: 2.5, yaw: 0 };
    let arrived = false;
    let frames = 0;
    for (; frames < 600 && !arrived; frames++) ({ state: s, arrived } = stepToward(s, { x: 2, z: 0.5 }, 1 / 60, world));
    expect(arrived).toBe(true);
    expect(frames).toBeLessThan(120);
    expect(s.z).toBeGreaterThan(1 + R - 0.05);
  });
});

describe('dónde empieza el recorrido', () => {
  it('en el centro si está libre; si lo ocupa un mueble, en el hueco más cercano', () => {
    expect(walkStart(room, buildWalkWorld(room))).toEqual({ x: 2, z: 1.5, yaw: 0 });
    const table: WalkBody = { corners: footprint({ x: 2, y: 0, z: 1.5 }, { x: 1.4, y: 0.75, z: 0.9 }, 0).corners, baseY: 0, heightM: 0.75 };
    const world = buildWalkWorld(room, [table]);
    const start = walkStart(room, world);
    expect(canStand(start, world)).toBe(true);
    expect(Math.hypot(start.x - 2, start.z - 1.5)).toBeLessThan(1.3);
  });

  it('en una U cae dentro del cuarto, no en el hueco', () => {
    const shell = buildRoomShape('U', { widthM: 6, depthM: 4.5, heightM: 2.6 });
    const world = buildWalkWorld(shell);
    expect(canStand(walkStart(shell, world), world)).toBe(true);
  });
});
