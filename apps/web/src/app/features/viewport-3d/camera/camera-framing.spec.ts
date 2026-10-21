import { createRectangularShell, type CatalogItem, type FurniturePlacement } from '@interiores/shared-types';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraFraming } from './camera-framing';
import { ORBIT_FOV, RoomCamera } from './room-camera';

const shell = createRectangularShell(4, 3, 2.6);

function setup(walking = false) {
  const camera = new RoomCamera(30, 1.5, 0.05, 120);
  const log: string[] = [];
  const framing = new CameraFraming({
    camera,
    controls: () => null,
    walking: () => walking,
    resetOrbit: () => void log.push('reset'),
    cameraMoved: () => void log.push('moved'),
  });
  return { camera, framing, log };
}

describe('CameraFraming', () => {
  it('encuadra el cuarto entero desde el frente, con el fov de órbita', () => {
    const { camera, framing, log } = setup();
    framing.frameRoom(shell);
    expect(camera.fov).toBe(ORBIT_FOV);
    expect(camera.position.z).toBeGreaterThan(shell.depthM);
    expect(camera.position.y).toBeGreaterThan(shell.heightM);
    expect(log).toEqual(['reset', 'moved']);
  });

  it('en el recorrido no toca la cámara', () => {
    const { camera, framing, log } = setup(true);
    const before = camera.position.clone();
    framing.frameRoom(shell);
    framing.viewFrom(shell, 'top');
    expect(camera.position.equals(before)).toBe(true);
    expect(log).toEqual([]);
  });

  it('la vista de plano es ortográfica y las demás vuelven a perspectiva', () => {
    const { camera, framing } = setup();
    framing.viewFrom(shell, 'plan');
    expect(camera.orthographic).toBe(true);
    framing.viewFrom(shell, 'left');
    expect(camera.orthographic).toBe(false);
    expect(camera.position.x).toBeLessThan(0);
  });

  it('se acerca a la pieza conservando desde dónde se mira', () => {
    const { camera, framing } = setup();
    camera.position.set(2, 3, 10);
    const placement = { position: { x: 2, y: 0, z: 1 }, rotationY: 0 } as FurniturePlacement;
    const item = { dimensionsM: { x: 1, y: 0.8, z: 0.6 } } as CatalogItem;
    framing.frameItem(placement, item);
    const target = new THREE.Vector3(2, 0.4, 1);
    expect(camera.position.distanceTo(target)).toBeCloseTo(Math.hypot(1, 0.8, 0.6) * 2.2, 3);
    expect(camera.position.z).toBeGreaterThan(target.z);
  });
});
