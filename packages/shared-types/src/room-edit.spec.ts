import { describe, expect, it } from 'vitest';
import type { FurniturePlacement, Opening, RoomShell } from './domain.js';
import { createRectangularShell, footprint, isBoxRoom, isInsideRoom, RoomGeometryError, validateRoomShell, wallLength } from './geometry.js';
import { carryPlacements, moveOpening, moveVertex, moveWall } from './room-edit.js';
import { RoomPlan } from './room-plan.js';
import { buildRoomShape } from './room-templates.js';
import { snapMove } from './snapping.js';
import { distanceFromWall, wallFrames } from './walls.js';

const rect = (): RoomShell => createRectangularShell(4, 3, 2.6, { door: false, window: false });
const lRoom = (): RoomShell => buildRoomShape('L', { widthM: 5, depthM: 4, heightM: 2.6, notchWidthM: 2, notchDepthM: 1.5 });
const withOpening = (shell: RoomShell, o: Partial<Opening> & Pick<Opening, 'wallId' | 'offsetM'>): RoomShell => ({
  ...shell,
  openings: [...shell.openings, { id: `o-${shell.openings.length}`, type: 'window', widthM: 1, heightM: 1.2, sillHeightM: 0.9, ...o }],
});
const piece = (id: string, x: number, z: number, extra: Partial<FurniturePlacement> = {}): FurniturePlacement => ({
  id,
  catalogItemId: 'sofa',
  position: { x, y: 0, z },
  rotationY: 0,
  lockedByUser: false,
  origin: 'user',
  ...extra,
});
const sofa = { x: 1.8, y: 0.8, z: 0.9 };

describe('mover una pared', () => {
  it('hacia fuera agranda el cuarto y hacia dentro lo achica; las vecinas se estiran', () => {
    const wider = moveWall(rect(), 'w-right', 1);
    expect(wider.shell).toMatchObject({ widthM: 5, depthM: 3 });
    expect(wider.shift).toEqual({ x: 0, z: 0 });
    expect(isBoxRoom(wider.shell)).toBe(true);
    expect(wider.shell.walls.map((w) => w.id)).toEqual(rect().walls.map((w) => w.id));
    expect(wallLength(wider.shell.walls[0]!)).toBeCloseTo(5);

    const shallower = moveWall(rect(), 'w-front', -0.5);
    expect(shallower.shell.depthM).toBe(2.5);
    expect(() => validateRoomShell(shallower.shell)).not.toThrow();
  });

  it('empujar la pared izquierda o la del fondo corre el origen: `shift` lo dice', () => {
    const edit = moveWall(rect(), 'w-left', 0.6);
    expect(edit.shell.widthM).toBe(4.6);
    expect(edit.shift).toEqual({ x: 0.6, z: 0 });
    const back = moveWall(rect(), 'w-back', -0.4);
    expect(back.shell.depthM).toBe(2.6);
    expect(back.shift).toEqual({ x: 0, z: -0.4 });
  });

  it('en una L mueve solo ese tramo y la planta sigue siendo una L', () => {
    const before = RoomPlan.from(lRoom());
    // La pared del fondo de la muesca (la que mira al frente en el ala derecha).
    const notch = before.frames().find((f) => f.normal.z < -0.9 && f.length < 4)!;
    const edit = moveWall(lRoom(), notch.id, 0.5);
    expect(edit.shell.walls).toHaveLength(6);
    expect(edit.shell.shape).toBe('L');
    expect(RoomPlan.from(edit.shell).area()).toBeCloseTo(before.area() + 0.5 * notch.length);
  });

  it('rechaza lo que deja un cuarto imposible', () => {
    expect(() => moveWall(rect(), 'w-right', -3.5)).toThrow(RoomGeometryError);
    expect(() => moveWall(rect(), 'w-right', 40)).toThrow(RoomGeometryError);
    expect(() => moveWall(rect(), 'no-existe', 1)).toThrow(RoomGeometryError);
    // En la L, meter la muesca más allá de la pared de enfrente cruza las paredes.
    const notch = RoomPlan.from(lRoom())
      .frames()
      .find((f) => f.normal.z < -0.9 && f.length < 4)!;
    expect(() => moveWall(lRoom(), notch.id, -3)).toThrow(RoomGeometryError);
  });

  it('las ventanas se quedan donde estaban aunque su pared crezca por el inicio', () => {
    // w-back va de x = 0 a x = 4: una ventana centrada en x = 1.
    const shell = withOpening(rect(), { wallId: 'w-back', offsetM: 1 });
    const edit = moveWall(shell, 'w-left', 1);
    // El cuarto creció 1 m por la izquierda: la ventana sigue en el mismo sitio, ahora a 2 m del inicio.
    expect(edit.shell.openings[0]!.offsetM).toBeCloseTo(2);
    expect(edit.shell.walls[0]!.hasWindow).toBe(true);
    // Si la pared se achica hasta dejarla fuera, la ventana se mete dentro en vez de perderse.
    const tight = moveWall(withOpening(rect(), { wallId: 'w-back', offsetM: 3.3 }), 'w-right', -1.5);
    const o = tight.shell.openings[0]!;
    expect(o.offsetM + o.widthM / 2).toBeLessThanOrEqual(2.5);
  });
});

describe('mover una esquina', () => {
  it('convierte el rectángulo en una planta de forma libre válida', () => {
    const edit = moveVertex(rect(), 2, { x: 5, z: 3.5 });
    expect(edit.shell.shape).toBe('free');
    expect(edit.shell).toMatchObject({ widthM: 5, depthM: 3.5 });
    expect(isBoxRoom(edit.shell)).toBe(false);
    expect(() => validateRoomShell(edit.shell)).not.toThrow();
    expect(edit.shell.walls.map((w) => w.id)).toEqual(rect().walls.map((w) => w.id));
  });

  it('no deja cruzar las paredes ni usar una esquina que no existe', () => {
    expect(() => moveVertex(rect(), 2, { x: 1, z: -2 })).toThrow(RoomGeometryError);
    expect(() => moveVertex(rect(), 9, { x: 1, z: 1 })).toThrow(RoomGeometryError);
  });
});

describe('deslizar una abertura', () => {
  const shell = withOpening(withOpening(rect(), { wallId: 'w-back', offsetM: 1 }), { wallId: 'w-back', offsetM: 3 });

  it('la mueve por su pared sin salirse de ella', () => {
    expect(moveOpening(shell, 'o-0', 1.4).openings[0]!.offsetM).toBe(1.4);
    expect(moveOpening(shell, 'o-0', -5).openings[0]!.offsetM).toBeCloseTo(0.55);
  });

  it('no la deja encima de otra', () => {
    expect(() => moveOpening(shell, 'o-0', 2.6)).toThrow(RoomGeometryError);
    expect(() => moveOpening(shell, 'nada', 1)).toThrow(RoomGeometryError);
  });
});

describe('llevar los muebles al cuarto editado', () => {
  const dims = () => sofa;

  it('todos se corren con el origen y quedan dentro', () => {
    const edit = moveWall(rect(), 'w-left', 1);
    const [moved] = carryPlacements([piece('a', 2, 1.5)], dims, edit);
    expect(moved!.position).toMatchObject({ x: 3, z: 1.5 });
  });

  it('al achicar el cuarto, lo que quedó fuera se mete dentro y lo apoyado lo sigue', () => {
    const edit = moveWall(rect(), 'w-right', -1);
    const [a, lamp] = carryPlacements([piece('a', 3, 1.5), piece('lamp', 3.2, 1.5, { supportId: 'a', position: { x: 3.2, y: 0.8, z: 1.5 } })], dims, edit);
    expect(isInsideRoom(footprint(a!.position, sofa, 0), edit.shell)).toBe(true);
    expect(a!.position.x).toBeCloseTo(2.1);
    // La lámpara conserva su lugar sobre el mueble: se movió lo mismo que él.
    expect(lamp!.position.x - a!.position.x).toBeCloseTo(0.2);
    expect(lamp!.position.y).toBe(0.8);
  });

  it('lo colgado sigue pegado a su pared', () => {
    const picture = { x: 0.8, y: 0.6, z: 0.04 };
    const edit = moveWall(rect(), 'w-right', 0.75);
    const frame = wallFrames(edit.shell).find((f) => f.id === 'w-right')!;
    const [hung] = carryPlacements([piece('p', 3.98, 1.5, { wallId: 'w-right', position: { x: 3.98, y: 1.4, z: 1.5 } })], () => picture, edit);
    expect(distanceFromWall(frame, hung!.position)).toBeCloseTo(0.021);
    expect(hung!.position.y).toBe(1.4);
    expect(hung!.rotationY).toBeCloseTo(frame.rotationY);
  });
});

describe('guías de alineación', () => {
  const other = { minX: 2, maxX: 3, minZ: 0, maxZ: 1 };
  const box = (x: number, z: number) => ({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.4, maxZ: z + 0.4 });

  it('alinea un borde con el de otro mueble y devuelve la guía', () => {
    // Su borde izquierdo (1,96) queda a 4 cm del borde izquierdo del otro (2).
    const snap = snapMove(box(2.46, 2), [other]);
    expect(snap.dx).toBeCloseTo(0.04);
    expect(snap.guides).toEqual([expect.objectContaining({ axis: 'x', at: 2, from: 0 })]);
    expect(snap.guides[0]!.to).toBeCloseTo(2.4);
  });

  it('cada eje se resuelve por separado y gana la línea más cercana', () => {
    const snap = snapMove(box(2.52, 0.53), [other]);
    expect(snap.dx).toBeCloseTo(-0.02); // centros
    expect(snap.dz).toBeCloseTo(-0.03); // centros
    expect(snap.guides.map((g) => g.axis)).toEqual(['x', 'z']);
  });

  it('sin nada cerca cae en la rejilla, y sin rejilla no se mueve', () => {
    const free = snapMove(box(0.73, 2.12), [other]);
    expect(free.guides).toEqual([]);
    expect(0.73 + free.dx).toBeCloseTo(0.75);
    expect(2.12 + free.dz).toBeCloseTo(2.1);
    expect(snapMove(box(0.73, 2.12), [], { gridM: 0 })).toMatchObject({ dx: 0, dz: 0 });
  });
});
