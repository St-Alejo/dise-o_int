import { WALKER, buildWalkWorld, createRectangularShell, walkStart } from '@interiores/shared-types';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraDirector, TRANSITION_S } from './camera-director';
import type { CameraMode, CameraModeId, CameraPose } from './camera-mode';
import { WALK_FOV, WalkMode } from './walk-mode';

const shell = createRectangularShell(4, 3, 2.6);
const world = buildWalkWorld(shell);

/** Modo de mentira que anota lo que el director le pide. */
class FakeMode implements CameraMode {
  log: string[] = [];
  constructor(
    readonly id: CameraModeId,
    private readonly pose: CameraPose,
  ) {}
  entryPose = () => this.pose;
  enter = () => void this.log.push('enter');
  exit = () => void this.log.push('exit');
  update = () => {
    this.log.push('update');
    return false;
  };
}

const pose = (x: number, y: number, z: number, fov: number): CameraPose => ({ position: new THREE.Vector3(x, y, z), target: new THREE.Vector3(x, y, z - 1), fov });

function setup() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
  camera.position.set(2, 6, 6);
  camera.lookAt(2, 0, 1.5);
  const orbit = new FakeMode('orbit', pose(2, 6, 6, 50));
  const walk = new FakeMode('walk', pose(2, 1.6, 1.5, 68));
  const arrived: CameraModeId[] = [];
  const director = new CameraDirector(camera, { orbit, walk }, (id) => arrived.push(id));
  return { camera, orbit, walk, arrived, director };
}

describe('CameraDirector', () => {
  it('delega cada frame en el modo activo', () => {
    const { director, orbit } = setup();
    expect(director.mode()).toBe('orbit');
    director.update(0.016);
    expect(orbit.log).toEqual(['update']);
  });

  it('al cambiar de modo vuela desde donde está hasta donde el modo nuevo empieza', () => {
    const { camera, director, orbit, walk, arrived } = setup();
    director.switchTo('walk');
    // El modo nuevo se anuncia de inmediato, pero no toma el control hasta llegar.
    expect(director.mode()).toBe('walk');
    expect(director.moving()).toBe(true);
    expect(orbit.log).toEqual(['exit']);
    expect(walk.log).toEqual([]);

    expect(director.update(TRANSITION_S / 2)).toBe(true);
    expect(camera.position.y).toBeGreaterThan(1.6);
    expect(camera.position.y).toBeLessThan(6);
    expect(camera.fov).toBeGreaterThan(50);

    director.update(TRANSITION_S / 2 + 0.01);
    expect(camera.position.toArray()).toEqual([2, 1.6, 1.5]);
    expect(camera.fov).toBe(68);
    expect(director.moving()).toBe(false);
    expect(walk.log).toEqual(['enter']);
    expect(arrived).toEqual(['walk']);

    director.update(0.016);
    expect(walk.log).toEqual(['enter', 'update']);
  });

  it('pedir el modo en el que ya se está no hace nada, y se puede cambiar sin vuelo', () => {
    const { camera, director, orbit, walk, arrived } = setup();
    director.switchTo('orbit');
    expect(orbit.log).toEqual([]);
    director.switchTo('walk', { instant: true });
    expect(camera.position.toArray()).toEqual([2, 1.6, 1.5]);
    expect(walk.log).toEqual(['enter']);
    expect(arrived).toEqual(['walk']);
    expect(director.moving()).toBe(false);
  });
});

describe('WalkMode', () => {
  function walker() {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    const mode = new WalkMode(
      camera,
      () => world,
      () => walkStart(shell, world),
    );
    mode.enter();
    return { camera, mode };
  }
  const run = (mode: WalkMode, seconds: number) => {
    let moved = false;
    for (let i = 0; i < Math.round(seconds * 60); i++) moved = mode.update(1 / 60) || moved;
    return moved;
  };

  it('empieza en el centro del cuarto, a la altura de los ojos y mirando al fondo', () => {
    const { camera, mode } = walker();
    expect(camera.position.toArray()).toEqual([2, WALKER.eyeHeightM, 1.5]);
    expect(camera.getWorldDirection(new THREE.Vector3()).z).toBeCloseTo(-1);
    expect(mode.entryPose().fov).toBe(WALK_FOV);
    expect(mode.entryPose().target.z).toBeCloseTo(0.5);
  });

  it('las teclas mueven a la persona y al soltarlas se detiene', () => {
    const { camera, mode } = walker();
    expect(mode.key('KeyW', true)).toBe(true);
    expect(run(mode, 0.5)).toBe(true);
    expect(camera.position.z).toBeCloseTo(1.5 - WALKER.walkMps * 0.5, 1);
    mode.key('KeyW', false);
    expect(run(mode, 0.2)).toBe(false);

    // Las flechas laterales giran; A y D desplazan de lado.
    mode.key('KeyD', true);
    run(mode, 0.4);
    expect(camera.position.x).toBeGreaterThan(2.4);
    mode.releaseKeys();
    expect(run(mode, 0.2)).toBe(false);
    expect(mode.key('KeyX', true)).toBe(false);
  });

  it('no atraviesa la pared aunque se mantenga la tecla', () => {
    const { camera, mode } = walker();
    mode.key('ArrowUp', true);
    mode.key('ShiftLeft', true);
    run(mode, 4);
    expect(camera.position.z).toBeCloseTo(WALKER.radiusM, 2);
  });

  it('arrastrar gira la vista y la inclinación tiene tope', () => {
    const { camera, mode } = walker();
    mode.look(100, 0);
    expect(mode.update(1 / 60)).toBe(true);
    expect(mode.walker.yaw).toBeCloseTo(0.5);
    mode.look(0, 5000);
    mode.update(1 / 60);
    expect(camera.rotation.x).toBeCloseTo(1.2);
    expect(camera.rotation.z).toBeCloseTo(0); // la cabeza no se ladea
  });

  it('ir a un punto camina hasta él, y una tecla lo cancela', () => {
    const { camera, mode } = walker();
    mode.goTo({ x: 3.2, z: 2.2 });
    run(mode, 2);
    expect(camera.position.x).toBeCloseTo(3.2, 1);
    expect(camera.position.z).toBeCloseTo(2.2, 1);
    expect(run(mode, 0.2)).toBe(false);

    mode.goTo({ x: 0.5, z: 0.5 });
    run(mode, 0.1);
    mode.key('KeyS', true);
    run(mode, 0.1);
    mode.key('KeyS', false);
    const stopped = camera.position.clone();
    run(mode, 0.5);
    expect(camera.position.distanceTo(stopped)).toBeLessThan(1e-6);
  });
});
