import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraMode, CameraPose } from './camera-mode';

export const ORBIT_FOV = 50;

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
