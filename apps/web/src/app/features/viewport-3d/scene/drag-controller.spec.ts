import { createRectangularShell, type CatalogItem, type FurniturePlacement, type Vector3 } from '@interiores/shared-types';
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SceneCommand, SceneState } from '../commands';
import { DragController, type DragHost, type DragStore, type DragTargets } from './drag-controller';

const SIZE = { width: 800, height: 600 };
const shell = createRectangularShell(4, 3.5, 2.6);
const sofa = { id: 'sofa', mount: 'floor', dimensionsM: { x: 1, y: 0.8, z: 0.5 } } as CatalogItem;

/** Cámara cenital: mover el cursor a la derecha mueve el punto del piso hacia +x. */
function topCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, SIZE.width / SIZE.height, 0.05, 120);
  camera.position.set(2, 6, 1.75);
  camera.up.set(0, 0, -1);
  camera.lookAt(2, 0, 1.75);
  camera.updateMatrixWorld();
  return camera;
}

const pointer = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }) as PointerEvent;

describe('DragController', () => {
  let placements: FurniturePlacement[];
  let selected: string | null;
  let executed: SceneCommand[];
  let placed: { id: string; position: Vector3 }[];
  let poseValid: boolean;
  let readOnly: boolean;
  let cameraEnabled: boolean;
  let picked: string | null;
  let controller: DragController;

  beforeEach(() => {
    placements = [{ id: 'p1', catalogItemId: 'sofa', position: { x: 2, y: 0, z: 1.75 }, rotationY: 0, lockedByUser: false }];
    selected = null;
    executed = [];
    placed = [];
    poseValid = true;
    readOnly = false;
    cameraEnabled = true;
    picked = 'p1';

    const store: DragStore = {
      placements: () => placements,
      catalog: () => new Map([[sofa.id, sofa]]),
      shell: () => shell,
      select: (id) => (selected = id),
      dependentsOf: () => [],
      isPoseValid: () => poseValid,
      execute: (cmd) => executed.push(cmd),
    };
    const targets: DragTargets = {
      pick: () => picked,
      place: (id, position) => placed.push({ id, position }),
    };
    const canvas = {
      style: {},
      getBoundingClientRect: () => ({ left: 0, top: 0, ...SIZE }),
      setPointerCapture: () => undefined,
      hasPointerCapture: () => false,
      releasePointerCapture: () => undefined,
    } as unknown as HTMLCanvasElement;
    const host: DragHost = {
      canvas: () => canvas,
      readOnly: () => readOnly,
      setCameraEnabled: (enabled) => (cameraEnabled = enabled),
      refreshSelection: () => undefined,
    };
    controller = new DragController({ scene: new THREE.Scene(), camera: topCamera(), invalidate: () => undefined }, store, targets, host);
  });

  const apply = (cmd: SceneCommand): SceneState => cmd.apply({ placements, finishes: null });

  it('arrastrar un mueble de piso lo mueve con un solo comando y suelta la cámara mientras dura', () => {
    controller.onPointerDown(pointer(400, 300));
    expect(selected).toBe('p1');
    expect(controller.dragging()).toBe(true);
    expect(cameraEnabled).toBe(false);

    controller.onPointerMove(pointer(480, 300));
    expect(controller.holds('p1')).toBe(true);
    expect(controller.poseOf('p1')!.position.x).toBeGreaterThan(2.1);

    controller.onPointerUp(pointer(480, 300));
    expect(controller.dragging()).toBe(false);
    expect(cameraEnabled).toBe(true);
    expect(executed).toHaveLength(1);
    const moved = apply(executed[0]!).placements[0]!;
    expect(moved.position.x).toBeGreaterThan(2.1);
    expect(moved.position.z).toBeCloseTo(1.75, 2);
    expect(moved.lockedByUser).toBe(true);
  });

  it('un clic con un leve temblor no es un arrastre', () => {
    controller.onPointerDown(pointer(400, 300));
    controller.onPointerMove(pointer(402, 301));
    controller.onPointerUp(pointer(402, 301));
    expect(selected).toBe('p1');
    expect(executed).toHaveLength(0);
  });

  it('si la pose choca, avisa y al soltar la pieza vuelve a donde estaba', () => {
    poseValid = false;
    controller.onPointerDown(pointer(400, 300));
    controller.onPointerMove(pointer(480, 300));
    expect(controller.invalidDrop()).toBe(true);

    controller.onPointerUp(pointer(480, 300));
    expect(controller.invalidDrop()).toBe(false);
    expect(executed).toHaveLength(0);
    expect(placed.at(-1)).toEqual({ id: 'p1', position: { x: 2, y: 0, z: 1.75 } });
  });

  it('en solo lectura selecciona pero no arrastra', () => {
    readOnly = true;
    controller.onPointerDown(pointer(400, 300));
    controller.onPointerMove(pointer(480, 300));
    controller.onPointerUp(pointer(480, 300));
    expect(selected).toBe('p1');
    expect(controller.dragging()).toBe(false);
    expect(executed).toHaveLength(0);
  });

  it('un clic en el vacío deselecciona', () => {
    selected = 'p1';
    picked = null;
    controller.onPointerDown(pointer(100, 100));
    controller.onPointerUp(pointer(100, 100));
    expect(selected).toBeNull();
  });
});
