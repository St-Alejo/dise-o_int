import { describe, expect, it } from 'vitest';
import { createRectangularShell, type Vector3 } from '@interiores/shared-types';
import { MOUNT_STRATEGIES, overlapsOpening, wallFrames, type DragContext, type Ray } from './mount-strategies';

const shell = createRectangularShell(4, 3.5, 2.6); // ventana en w-back (centro x = 2), puerta en w-front
const eye: Vector3 = { x: 2, y: 1.6, z: 3.2 };
/** Rayo desde el "ojo" hacia un punto del cuarto. */
const toward = (target: Vector3, from: Vector3 = eye): Ray => {
  const d = { x: target.x - from.x, y: target.y - from.y, z: target.z - from.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { origin: from, direction: { x: d.x / l, y: d.y / l, z: d.z / l } };
};
const ctx = (over: Partial<DragContext> = {}): DragContext => ({
  shell,
  dims: { x: 0.8, y: 0.6, z: 0.03 },
  rotationY: 0,
  grabOffset: { x: 0, z: 0 },
  supports: [],
  ...over,
});

describe('FloorMount / CeilingMount', () => {
  it('sigue el cursor sobre el piso, queda dentro del cuarto y se pega a la pared cercana', () => {
    const dims = { x: 1, y: 0.8, z: 0.5 };
    const free = MOUNT_STRATEGIES.floor.poseFor(toward({ x: 2, y: 0, z: 1.5 }), ctx({ dims }))!;
    expect(free.position.x).toBeCloseTo(2);
    expect(free.position.z).toBeCloseTo(1.5);
    expect(free.position.y).toBe(0);
    const near = MOUNT_STRATEGIES.floor.poseFor(toward({ x: 2, y: 0, z: 0.33 }), ctx({ dims }))!;
    expect(near.position.z).toBeCloseTo(0.25); // pegado a la pared del fondo (mitad del fondo = 0.25)
    const outside = MOUNT_STRATEGIES.floor.poseFor(toward({ x: 9, y: 0, z: 1 }), ctx({ dims }))!;
    expect(outside.position.x).toBeCloseTo(3.5);
  });

  it('el techo se mueve en planta pero cuelga del techo', () => {
    const pose = MOUNT_STRATEGIES.ceiling.poseFor(toward({ x: 1, y: 0, z: 1 }), ctx({ dims: { x: 0.4, y: 0.9, z: 0.4 } }))!;
    expect(pose.position.y).toBeCloseTo(1.7);
  });

  it('un rayo que no baja al piso no da pose', () => {
    expect(MOUNT_STRATEGIES.floor.poseFor({ origin: eye, direction: { x: 0, y: 1, z: 0 } }, ctx())).toBeNull();
  });
});

describe('WallMount', () => {
  it('se desliza por la pared apuntada, mirando al cuarto y a la altura del cursor', () => {
    const pose = MOUNT_STRATEGIES.wall.poseFor(toward({ x: 0.9, y: 1.5, z: 0 }), ctx())!;
    expect(pose.wallId).toBe('w-back');
    expect(pose.rotationY).toBe(0);
    expect(pose.position.x).toBeCloseTo(0.9, 2);
    expect(pose.position.z).toBeCloseTo(0.016, 2);
    expect(pose.elevationM).toBeCloseTo(1.2, 2); // centro en el cursor: 1.5 − 0.6/2
  });

  it('cambia de pared con el cursor y gira para mirar al cuarto', () => {
    const left = MOUNT_STRATEGIES.wall.poseFor(toward({ x: 0, y: 1.4, z: 1.5 }), ctx())!;
    expect(left.wallId).toBe('w-left');
    expect(left.rotationY).toBeCloseTo(Math.PI / 2);
    expect(left.position.x).toBeCloseTo(0.016, 2);
    const right = MOUNT_STRATEGIES.wall.poseFor(toward({ x: 4, y: 1.4, z: 1.5 }), ctx())!;
    expect(right.wallId).toBe('w-right');
    expect(right.rotationY).toBeCloseTo(-Math.PI / 2);
    expect(right.position.x).toBeCloseTo(4 - 0.016, 2);
  });

  it('no atraviesa el techo ni el piso ni se sale de la pared', () => {
    const high = MOUNT_STRATEGIES.wall.poseFor(toward({ x: 0.2, y: 2.55, z: 0 }), ctx())!;
    expect(high.position.y + 0.6).toBeLessThanOrEqual(2.6 + 1e-9);
    expect(high.position.x).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });

  it('marca como bloqueada la pose que tapa la ventana', () => {
    const win = shell.openings.find((o) => o.type === 'window')!;
    const overWindow = MOUNT_STRATEGIES.wall.poseFor(toward({ x: 2, y: win.sillHeightM + win.heightM / 2, z: 0 }), ctx())!;
    expect(overWindow.blockedBy).toBe('opening');
    const aside = MOUNT_STRATEGIES.wall.poseFor(toward({ x: 0.5, y: 1.4, z: 0 }), ctx())!;
    expect(aside.blockedBy).toBeUndefined();
  });

  it('las aberturas se ubican bien en paredes recorridas al revés (frente)', () => {
    const door = shell.openings.find((o) => o.type === 'door')!;
    const front = wallFrames(shell).find((w) => w.id === 'w-front')!;
    const doorCenterX = shell.widthM - door.offsetM;
    expect(overlapsOpening(shell, front, doorCenterX, 0.5, 1, 0.5)).toBe(true);
    // Lejos de la puerta (en el otro extremo de la pared) no la tapa.
    const farX = doorCenterX > shell.widthM / 2 ? 0.3 : shell.widthM - 0.3;
    expect(overlapsOpening(shell, front, farX, 0.2, 1, 0.5)).toBe(false);
  });
});

describe('SurfaceMount', () => {
  const table = { id: 'mesa', position: { x: 1, y: 0, z: 1 }, rotationY: 0, dims: { x: 0.6, y: 0.55, z: 0.4 } };
  const lamp = { x: 0.3, y: 0.5, z: 0.3 };

  it('se apoya sobre el mueble apuntado y guarda el soporte', () => {
    const pose = MOUNT_STRATEGIES.surface.poseFor(toward({ x: 1.05, y: 0.55, z: 1 }), ctx({ dims: lamp, supports: [table] }))!;
    expect(pose.supportId).toBe('mesa');
    expect(pose.position.y).toBeCloseTo(0.55);
    expect(pose.position.x).toBeCloseTo(1.05, 2);
  });

  it('queda entera sobre la tapa aunque el cursor apunte al borde', () => {
    const pose = MOUNT_STRATEGIES.surface.poseFor(toward({ x: 1.29, y: 0.55, z: 1.19 }), ctx({ dims: lamp, supports: [table] }))!;
    expect(pose.position.x).toBeCloseTo(1.15, 2); // 1 + (0.6 − 0.3)/2
    expect(pose.position.z).toBeCloseTo(1.05, 2);
  });

  it('respeta el giro del soporte', () => {
    const rotated = { ...table, rotationY: Math.PI / 2 };
    const pose = MOUNT_STRATEGIES.surface.poseFor(toward({ x: 1, y: 0.55, z: 1.25 }), ctx({ dims: lamp, supports: [rotated] }))!;
    expect(pose.supportId).toBe('mesa');
    expect(pose.rotationY).toBeCloseTo(Math.PI / 2);
  });

  it('sin mueble debajo del cursor, queda en el piso y sin soporte', () => {
    const pose = MOUNT_STRATEGIES.surface.poseFor(toward({ x: 3, y: 0, z: 2 }), ctx({ dims: lamp, supports: [table] }))!;
    expect(pose.supportId).toBeUndefined();
    expect(pose.position.y).toBe(0);
  });
});
