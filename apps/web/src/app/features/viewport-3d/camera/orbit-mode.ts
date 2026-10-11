import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraMode, CameraPose } from './camera-mode';

export const ORBIT_FOV = 50;
/**
 * Campo de visión de la vista cenital: tan estrecho que las paredes casi no convergen y el cuarto
 * se lee como un plano. Es un teleobjetivo, no una cámara ortográfica: así todo lo demás (apuntar,
 * etiquetas, posprocesado) sigue trabajando con la misma cámara.
 */
export const PLAN_FOV = 9;

/** A qué altura hay que subir la cámara para que un cuarto de ese lado quepa entero con ese campo. */
export function planViewHeight(spanM: number, fovDeg = PLAN_FOV, margin = 1.3): number {
  return (spanM * margin) / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/** Vista de "casa de muñecas": se gira alrededor del cuarto con OrbitControls. */
export class OrbitMode implements CameraMode {
  readonly id = 'orbit';
  /** Última vista de órbita: al volver del recorrido se regresa a ella. */
  private last: CameraPose | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    /** Los controles los crea el viewport cuando ya existe el canvas. */
    private readonly controls: () => OrbitControls | null,
    /** Vista por defecto (el cuarto encuadrado) si todavía no hay una guardada. */
    private readonly home: () => CameraPose,
  ) {}

  entryPose(): CameraPose {
    return this.last ?? this.home();
  }

  enter(): void {
    const controls = this.controls();
    if (!controls) return;
    controls.target.copy(this.entryPose().target);
    controls.enabled = true;
    controls.update();
  }

  exit(): void {
    const controls = this.controls();
    this.last = { position: this.camera.position.clone(), target: (controls?.target ?? new THREE.Vector3()).clone(), fov: ORBIT_FOV };
    if (controls) controls.enabled = false;
  }

  update(): boolean {
    return this.controls()?.update() ?? false;
  }

  /** Olvida la vista guardada (se abrió otro cuarto o se pidió "centrar vista"). */
  reset(): void {
    this.last = null;
  }
}
