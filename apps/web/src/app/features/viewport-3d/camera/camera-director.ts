import { signal } from '@angular/core';
import * as THREE from 'three';
import type { FrameSystem } from '../scene/render-loop';
import type { CameraMode, CameraModeId, CameraPose } from './camera-mode';

export const TRANSITION_S = 0.9;

interface Transition {
  from: CameraPose;
  to: CameraPose;
  next: CameraMode;
  elapsed: number;
}

/** Suavizado de entrada y salida (cúbico): la cámara arranca y frena sin tirones. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Contexto del patrón State para la cámara: tiene el modo activo, le delega cada frame y, al
 * cambiar de modo, lleva la cámara en vuelo desde donde está hasta donde el modo nuevo quiere
 * empezar (de la vista de "casa de muñecas" a la altura de los ojos y de vuelta).
 */
export class CameraDirector implements FrameSystem {
  /** El modo en el que se está o hacia el que se va. */
  readonly mode = signal<CameraModeId>('orbit');
  /** Hay una transición en curso. */
  readonly moving = signal(false);

  private current: CameraMode;
  private transition: Transition | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly modes: Record<CameraModeId, CameraMode>,
    /** Aviso al llegar a un modo (para lo que depende de él: recorte de paredes, foco). */
    private readonly onArrive: (id: CameraModeId) => void = () => undefined,
  ) {
    this.current = modes.orbit;
  }

  get active(): CameraMode {
    return this.current;
  }

  switchTo(id: CameraModeId, opts: { instant?: boolean } = {}): void {
    const next = this.modes[id];
    if (next === this.current && !this.transition) return;
    if (this.transition?.next === next) return;
    this.current.exit();
    this.mode.set(id);
    const to = next.entryPose();
    if (opts.instant) {
      this.place(to);
      this.arrive(next);
      return;
    }
    this.transition = { from: this.poseNow(), to, next, elapsed: 0 };
    this.moving.set(true);
  }

  update(dt: number): boolean {
    const t = this.transition;
    if (!t) return this.current.update(dt);
    t.elapsed += dt;
    const k = ease(Math.min(1, t.elapsed / TRANSITION_S));
    this.place({
      position: t.from.position.clone().lerp(t.to.position, k),
      target: t.from.target.clone().lerp(t.to.target, k),
      fov: t.from.fov + (t.to.fov - t.from.fov) * k,
    });
    if (t.elapsed >= TRANSITION_S) {
      // Se termina exactamente en la pose de entrada, sin el error de redondeo de la interpolación.
      this.place(t.to);
      this.arrive(t.next);
    }
    return true;
  }

  private arrive(next: CameraMode): void {
    this.transition = null;
    this.moving.set(false);
    this.current = next;
    next.enter();
    this.onArrive(next.id);
  }

  private poseNow(): CameraPose {
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    return { position: this.camera.position.clone(), target: this.camera.position.clone().addScaledVector(forward, 3), fov: this.camera.fov };
  }

  private place(pose: CameraPose): void {
    this.camera.position.copy(pose.position);
    this.camera.lookAt(pose.target);
    if (this.camera.fov !== pose.fov) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
