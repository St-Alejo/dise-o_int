import { WALKER, stepToward, stepWalker, type Point2, type WalkInput, type WalkWorld, type WalkerState } from '@interiores/shared-types';
import * as THREE from 'three';
import type { CameraMode, CameraPose } from './camera-mode';

export const WALK_FOV = 68;
/** Radianes de giro por píxel arrastrado. */
const LOOK_SPEED = 0.005;
const MAX_PITCH = 1.2;

/** Teclas de movimiento (por posición en el teclado, no por letra: sirve en cualquier distribución). */
const MOVE_KEYS: Record<string, Partial<WalkInput>> = {
  KeyW: { forward: 1 },
  ArrowUp: { forward: 1 },
  KeyS: { forward: -1 },
  ArrowDown: { forward: -1 },
  KeyA: { strafe: -1 },
  KeyD: { strafe: 1 },
  ArrowLeft: { turn: 1 },
  KeyQ: { turn: 1 },
  ArrowRight: { turn: -1 },
  KeyE: { turn: -1 },
};
const RUN_KEYS = ['ShiftLeft', 'ShiftRight'];

/**
 * Recorrido a pie: la cámara va a la altura de los ojos, se mueve con el teclado o yendo a un
 * punto, y mira arrastrando. La colisión la resuelve `stepWalker` (shared-types): este modo solo
 * traduce teclas y gestos y coloca la cámara.
 */
export class WalkMode implements CameraMode {
  readonly id = 'walk';
  private state: WalkerState = { x: 0, z: 0, yaw: 0 };
  private pitch = 0;
  private readonly keys = new Set<string>();
  private goal: Point2 | null = null;
  /** Hay que redibujar aunque no haya movimiento (se arrastró para mirar). */
  private dirty = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: () => WalkWorld,
    private readonly start: () => WalkerState,
  ) {}

  get walker(): Readonly<WalkerState> {
    return this.state;
  }

  entryPose(): CameraPose {
    const s = this.start();
    const position = new THREE.Vector3(s.x, WALKER.eyeHeightM, s.z);
    return { position, target: position.clone().add(new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw))), fov: WALK_FOV };
  }

  enter(): void {
    this.state = this.start();
    this.pitch = 0;
    this.goal = null;
    this.keys.clear();
    this.apply();
  }

  exit(): void {
    this.keys.clear();
    this.goal = null;
  }

  /** Registra una tecla; devuelve true si es una de las del recorrido. */
  key(code: string, down: boolean): boolean {
    if (!(code in MOVE_KEYS) && !RUN_KEYS.includes(code)) return false;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    return true;
  }

  /** Suelta todas las teclas (el canvas perdió el foco: no debe quedarse caminando solo). */
  releaseKeys(): void {
    this.keys.clear();
  }

  /** Arrastrar "agarra" la vista, como en un visor de calles: hacia la derecha se gira a la izquierda. */
  look(dxPx: number, dyPx: number): void {
    this.state = { ...this.state, yaw: this.state.yaw + dxPx * LOOK_SPEED };
    this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, this.pitch + dyPx * LOOK_SPEED));
    this.dirty = true;
  }

  /** Caminar hasta un punto del piso (doble clic). Una tecla de movimiento lo cancela. */
  goTo(point: Point2): void {
    this.goal = point;
  }

  update(dt: number): boolean {
    const input: WalkInput = { forward: 0, strafe: 0, turn: 0, run: RUN_KEYS.some((k) => this.keys.has(k)) };
    for (const code of this.keys) {
      const move = MOVE_KEYS[code];
      if (!move) continue;
      input.forward += move.forward ?? 0;
      input.strafe += move.strafe ?? 0;
      input.turn = (input.turn ?? 0) + (move.turn ?? 0);
    }
    const before = this.state;
    if (input.forward !== 0 || input.strafe !== 0) this.goal = null;
    if (this.goal) {
      const result = stepToward(this.state, this.goal, dt, this.world());
      this.state = result.state;
      if (result.arrived) this.goal = null;
    } else {
      this.state = stepWalker(this.state, input, dt, this.world());
    }
    const changed = this.dirty || this.goal !== null || before.x !== this.state.x || before.z !== this.state.z || before.yaw !== this.state.yaw;
    this.dirty = false;
    if (changed) this.apply();
    return changed;
  }

  private apply(): void {
    this.camera.position.set(this.state.x, WALKER.eyeHeightM, this.state.z);
    // Primero el giro (Y) y luego la inclinación (X): así la cabeza nunca se ladea.
    this.camera.rotation.set(this.pitch, this.state.yaw, 0, 'YXZ');
  }
}
