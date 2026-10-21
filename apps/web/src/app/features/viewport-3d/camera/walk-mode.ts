import { WALKER, stepToward, stepWalker, type Point2, type WalkInput, type WalkWorld, type WalkerState } from '@interiores/shared-types';
import * as THREE from 'three';
import type { CameraMode, CameraPose } from './camera-mode';

export const WALK_FOV = 68;
/** Radianes de giro por píxel arrastrado. */
const LOOK_SPEED = 0.005;
const MAX_PITCH = 1.2;
/** Largo de un paso y cuánto sube y baja la cabeza en él: lo justo para sentir que se camina. */
export const STRIDE_M = 0.7;
export const BOB_M = 0.016;
/** Al parar, la cabeza termina el medio paso a esta velocidad (m/s) y queda a la altura de los ojos. */
const BOB_SETTLE_MPS = 3;

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
  /** Metros caminados: la fase del paso que marca el balanceo de la cabeza. */
  private walked = 0;

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
    this.walked = 0;
    this.apply();
  }

  /** Cuánto se separa la cabeza de la altura de los ojos ahora mismo. */
  get bob(): number {
    return Math.sin((this.walked / STRIDE_M) * Math.PI * 2) * BOB_M;
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

  /** El cuarto se corrió (se movió una pared que arrastra el origen): la persona va con él. */
  shiftBy(dx: number, dz: number): void {
    this.state = { ...this.state, x: this.state.x + dx, z: this.state.z + dz };
    if (this.goal) this.goal = { x: this.goal.x + dx, z: this.goal.z + dz };
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
    const step = Math.hypot(this.state.x - before.x, this.state.z - before.z);
    const walkedBefore = this.walked;
    if (step > 0) this.walked += step;
    else this.walked = Math.min(this.restingPhase(), this.walked + BOB_SETTLE_MPS * dt);
    const changed = this.dirty || this.goal !== null || step > 0 || before.yaw !== this.state.yaw || this.walked !== walkedBefore;
    this.dirty = false;
    if (changed) this.apply();
    return changed;
  }

  /** Siguiente punto del paso con la cabeza a la altura de los ojos (cada medio paso). */
  private restingPhase(): number {
    const half = STRIDE_M / 2;
    const n = this.walked / half;
    return Math.abs(n - Math.round(n)) < 1e-9 ? this.walked : Math.ceil(n) * half;
  }

  private apply(): void {
    this.camera.position.set(this.state.x, WALKER.eyeHeightM + this.bob, this.state.z);
    // Primero el giro (Y) y luego la inclinación (X): así la cabeza nunca se ladea.
    this.camera.rotation.set(this.pitch, this.state.yaw, 0, 'YXZ');
  }
}
