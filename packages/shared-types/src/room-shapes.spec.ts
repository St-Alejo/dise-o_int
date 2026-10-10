import { describe, expect, it } from 'vitest';
import { RoomShellSchema, type Opening, type RoomShell } from './domain.js';
import {
  clampToRoom,
  createPolygonShell,
  createRectangularShell,
  fitPlacementsToRoom,
  footprint,
  isBoxRoom,
  isInsideRoom,
  resizeRoomShell,
  roomCenter,
  RoomGeometryError,
  validateRoomShell,
  wallLength,
} from './geometry.js';
import { RoomPlan } from './room-plan.js';
import { buildRoomShape, resolveNotch, ROOM_SHAPE_IDS } from './room-templates.js';
import { alongOf, overlapsOpening, positionOnWall, wallFrames } from './walls.js';

const sofa = { x: 1.8, y: 0.8, z: 0.9 };
const at = (x: number, z: number) => ({ x, y: 0, z });
/** L de 5 × 4 a la que le falta la esquina del frente a la derecha (2 × 1,5). */
const lRoom = (): RoomShell => buildRoomShape('L', { widthM: 5, depthM: 4, heightM: 2.6, notchWidthM: 2, notchDepthM: 1.5 });
const window = (wallId: string, offsetM: number): Opening => ({ id: `o-${wallId}`, type: 'window', wallId, widthM: 1, heightM: 1.2, offsetM, sillHeightM: 0.9 });

describe('plantillas de forma', () => {
  it.each(ROOM_SHAPE_IDS)('%s: planta válida, cerrada y con su caja pegada al origen', (shape) => {
    const shell = buildRoomShape(shape, { widthM: 6, depthM: 5, heightM: 2.6 });
    expect(shell.shape).toBe(shape);
    expect(() => validateRoomShell(shell)).not.toThrow();
    expect(RoomShellSchema.safeParse(shell).success).toBe(true);
    expect(shell.walls[0]!.id).toBe('w-back');
    expect({ w: shell.widthM, d: shell.depthM }).toEqual({ w: 6, d: 5 });
  });

  it('cada forma tiene su número de paredes y su área', () => {
    const size = { widthM: 6, depthM: 4, heightM: 2.6, notchWidthM: 2, notchDepthM: 2 };
    const facts = ROOM_SHAPE_IDS.map((s) => {
      const plan = RoomPlan.fromShape(s, size);
      return [s, plan.toShell().walls.length, plan.area()];
    });
    expect(facts).toEqual([
      ['rect', 4, 24],
      ['L', 6, 20],
      ['T', 8, 16],
      ['U', 8, 20],
    ]);
  });

  it('el rectángulo es exactamente el cuarto de siempre', () => {
    const shell = buildRoomShape('rect', { widthM: 4, depthM: 3.5, heightM: 2.6 });
    const legacy = createRectangularShell(4, 3.5, 2.6, { door: false, window: false });
    expect(shell.walls).toEqual(legacy.walls);
    expect(isBoxRoom(shell)).toBe(true);
  });

  it('en una L, las paredes de los lados de la caja conservan su id histórico', () => {
    const ids = lRoom().walls.map((w) => w.id);
    expect(ids).toEqual(['w-back', 'w-right', 'w-3', 'w-4', 'w-front', 'w-left']);
    expect(isBoxRoom(lRoom())).toBe(false);
  });

  it('la muesca se acota a lo que la forma admite', () => {
    expect(resolveNotch('L', { widthM: 5, depthM: 4, heightM: 2.6, notchWidthM: 99, notchDepthM: 0.01 })).toEqual({ widthM: 4.6, depthM: 0.4 });
    expect(resolveNotch('rect', { widthM: 5, depthM: 4, heightM: 2.6, notchWidthM: 2 })).toEqual({ widthM: 0, depthM: 0 });
  });

  it('una planta dada en sentido contrario o lejos del origen se normaliza', () => {
    const shell = createPolygonShell(
      [
        { x: 10, z: 24 },
        { x: 13, z: 24 },
        { x: 13, z: 22.5 },
        { x: 15, z: 22.5 },
        { x: 15, z: 20 },
        { x: 10, z: 20 },
      ],
      2.6,
    );
    expect(shell.walls.map((w) => [w.start.x, w.start.z])).toEqual(lRoom().walls.map((w) => [w.start.x, w.start.z]));
    expect(() => createPolygonShell([{ x: 0, z: 0 }, { x: 2, z: 2 }, { x: 2, z: 0 }, { x: 0, z: 2 }], 2.6)).toThrow(RoomGeometryError);
  });
});

describe('marcos de pared', () => {
  it('en un rectángulo coinciden con los de siempre', () => {
    const frames = wallFrames(createRectangularShell(4, 3, 2.6));
    expect(frames.map((f) => [f.id, f.rotationY, f.length, f.startAtBase])).toEqual([
      ['w-back', 0, 4, true],
      ['w-right', -Math.PI / 2, 3, true],
      ['w-front', Math.PI, 4, false],
      ['w-left', Math.PI / 2, 3, false],
    ]);
    // `along` es la coordenada del cuarto y la pieza queda pegada a la cara interior.
    expect(positionOnWall(frames[2]!, 1, 1.2, 0.04)).toEqual({ x: 1, y: 1.2, z: 3 - 0.021 });
    expect(alongOf(frames[3]!, { x: 0.5, z: 2.2 })).toBeCloseTo(2.2);
  });

  it('en una L, todas las normales apuntan al interior, también las de la muesca', () => {
    const shell = lRoom();
    for (const frame of wallFrames(shell)) {
      const mid = positionOnWall(frame, frame.length / 2, 0, 0.4);
      expect(isInsideRoom(footprint(mid, { x: 0.2, y: 1, z: 0.2 }, 0), shell), frame.id).toBe(true);
    }
    const notch = wallFrames(shell).find((f) => f.id === 'w-3')!;
    expect(notch.normal).toEqual({ x: 0, z: -1 });
    expect(notch.base).toEqual({ x: 3, z: 2.5 });
  });

  it('una abertura tapa lo que se cuelga encima, en cualquier pared', () => {
    const shell = { ...lRoom(), openings: [window('w-3', 0.7)] };
    const notch = wallFrames(shell).find((f) => f.id === 'w-3')!;
    // w-3 va de x=5 a x=3: su offset 0,7 desde el inicio es la posición 1,3 a lo largo del marco.
    expect(overlapsOpening(shell, notch, 1.3, 0.6, 1, 0.6)).toBe(true);
    expect(overlapsOpening(shell, notch, 0.3, 0.4, 1, 0.6)).toBe(false);
  });
});

describe('muebles en un cuarto en L', () => {
  const shell = lRoom();

  it('la muesca no es parte del cuarto', () => {
    expect(isInsideRoom(footprint(at(1.5, 1), sofa, 0), shell)).toBe(true);
    expect(isInsideRoom(footprint(at(4, 3.3), sofa, 0), shell)).toBe(false);
    expect(isInsideRoom(footprint(at(3, 2.5), sofa, 0), shell)).toBe(false); // montado en la esquina entrante
  });

  it('acotar saca la pieza de la muesca y la deja dentro, lo más cerca posible', () => {
    for (const start of [at(4.2, 3.4), at(3, 2.6), at(4.9, 2.4), at(9, 9), at(2.8, 3.9)]) {
      const pos = clampToRoom(start, sofa, 0, shell);
      expect(isInsideRoom(footprint(pos, sofa, 0), shell), JSON.stringify(start)).toBe(true);
    }
    // Lo que ya cabía no se mueve.
    expect(clampToRoom(at(1.5, 1), sofa, 0, shell)).toEqual(at(1.5, 1));
    // Un sofá en la muesca, cerca del ala derecha, sube a esa ala en vez de cruzar el cuarto.
    const up = clampToRoom(at(4, 2.6), sofa, 0, shell);
    expect(up.x).toBeCloseTo(4, 1);
    expect(up.z).toBeLessThan(2.06);
  });

  it('el centro útil cae dentro del cuarto', () => {
    const c = roomCenter(shell);
    expect(isInsideRoom(footprint({ ...c, y: 0 }, { x: 0.5, y: 1, z: 0.5 }, 0), shell)).toBe(true);
    expect(roomCenter(createRectangularShell(4, 3, 2.6))).toEqual({ x: 2, z: 1.5 });
  });

  it('tras cambiar el cuarto, los muebles vuelven a quedar dentro', () => {
    const placements = [
      { id: 'a', catalogItemId: 'sofa', position: at(4, 3.3), rotationY: 0, lockedByUser: false },
      { id: 'b', catalogItemId: 'sofa', position: at(1.5, 1), rotationY: 0, lockedByUser: false },
    ];
    const fit = fitPlacementsToRoom(placements, () => sofa, shell);
    expect(fit.moved).toEqual(['a']);
    expect(fit.tooBig).toEqual([]);
  });
});

describe('medidas de un cuarto de forma libre', () => {
  it('cambiar el ancho y el largo conserva la forma y reacomoda las aberturas', () => {
    const shell = { ...lRoom(), openings: [window('w-back', 2.5), window('w-3', 1)] };
    const next = resizeRoomShell(shell, { widthM: 10, depthM: 4, heightM: 3 });
    expect(next.walls).toHaveLength(6);
    expect(next.shape).toBe('L');
    expect(wallLength(next.walls.find((w) => w.id === 'w-3')!)).toBeCloseTo(4);
    expect(next.openings.map((o) => o.offsetM)).toEqual([5, 2]);
    expect(() => validateRoomShell(next)).not.toThrow();
    expect(next.needsCalibration).toBe(false);
  });

  it('rechaza plantas que no cierran, se cruzan o tienen paredes mínimas', () => {
    const shell = lRoom();
    const broken = { ...shell, walls: shell.walls.slice(0, 5) };
    expect(() => validateRoomShell(broken)).toThrow('no cierran');
    const tiny = buildRoomShape('L', { widthM: 5, depthM: 4, heightM: 2.6 });
    tiny.walls[1] = { ...tiny.walls[1]!, end: { ...tiny.walls[1]!.start, z: 0.1 } };
    expect(() => validateRoomShell(tiny)).toThrow(RoomGeometryError);
    expect(() => validateRoomShell({ ...shell, widthM: 7 })).toThrow('no coinciden');
  });
});

describe('RoomPlan', () => {
  const plan = RoomPlan.from(lRoom());

  it('conoce su área, su perímetro y sus esquinas', () => {
    expect(plan.area()).toBeCloseTo(17);
    expect(plan.perimeter()).toBeCloseTo(18);
    expect(plan.isRectangular).toBe(false);
    expect(plan.toShell().walls.map((_, i) => plan.convexAt(i))).toEqual([true, true, true, false, true, true]);
  });

  it('sabe cuál es la pared del fondo, la izquierda, la derecha y la del frente', () => {
    expect((['back', 'right', 'front', 'left'] as const).map((d) => plan.wallByDirection(d)?.id)).toEqual(['w-back', 'w-right', 'w-front', 'w-left']);
    expect(plan.accentWallId()).toBe('w-back');
    const box = RoomPlan.fromShape('rect', { widthM: 4, depthM: 3, heightM: 2.6 });
    expect((['back', 'right', 'front', 'left'] as const).map((d) => box.wallByDirection(d)?.id)).toEqual(['w-back', 'w-right', 'w-front', 'w-left']);
  });

  it('es inmutable: cambiar las medidas devuelve otra planta', () => {
    const bigger = plan.scaledTo({ widthM: 6, depthM: 5, heightM: 2.8 });
    expect(bigger).not.toBe(plan);
    expect(plan.toShell().widthM).toBe(5);
    expect(bigger.validate().area()).toBeCloseTo(17 * (6 / 5) * (5 / 4));
    expect(bigger.contains(footprint(at(1.5, 1), sofa, 0))).toBe(true);
    expect(bigger.clamp(at(5.8, 4.8), sofa, 0)).not.toEqual(at(5.8, 4.8));
  });
});
