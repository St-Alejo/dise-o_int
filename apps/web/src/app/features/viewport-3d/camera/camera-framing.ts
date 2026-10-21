import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { effectiveDimensions, roomCenter, type CatalogItem, type FurniturePlacement, type RoomShell } from '@interiores/shared-types';
import type { CameraPose } from './camera-mode';
import { ORBIT_FOV } from './orbit-mode';
import { planViewSpan, type RoomCamera } from './room-camera';

/** Vistas rápidas de la cámara de órbita. */
export type ViewPreset = 'corner' | 'top' | 'plan' | 'front' | 'left' | 'right';

/** Lo que el encuadre necesita del visor: la cámara, los controles y avisar que hay que redibujar. */
export interface FramingHost {
  readonly camera: RoomCamera;
  controls(): OrbitControls | null;
  /** En el recorrido la cámara la lleva la persona: no se reencuadra. */
  walking(): boolean;
  resetOrbit(): void;
  /** Tras mover la cámara cambian las paredes que se cortan. */
  cameraMoved(): void;
}

/**
 * Encuadres de la cámara de órbita: el cuarto entero, las vistas rápidas (frente, lados, desde
 * arriba, plano ortográfico) y acercarse a la pieza seleccionada (tecla F).
 */
export class CameraFraming {
  constructor(private readonly host: FramingHost) {}

  /** Vista de órbita por defecto: el cuarto entero, desde el frente y algo por encima. */
  homePose(shell: RoomShell | null): CameraPose {
    const camera = this.host.camera;
    if (!shell) return { position: camera.position.clone(), target: new THREE.Vector3(), fov: ORBIT_FOV };
    const cx = shell.widthM / 2;
    const cz = shell.depthM / 2;
    const span = Math.max(shell.widthM, shell.depthM);
    return {
      position: new THREE.Vector3(cx + span * 0.1, shell.heightM * 1.6 + span * 0.2, shell.depthM + span * 0.55),
      target: new THREE.Vector3(cx, 0.4, cz),
      fov: ORBIT_FOV,
    };
  }

  frameRoom(shell: RoomShell | null): void {
    if (!shell || this.host.walking()) return;
    const camera = this.host.camera;
    const controls = this.host.controls();
    this.host.resetOrbit();
    camera.setOrthographic(null);
    this.setFov(ORBIT_FOV);
    const home = this.homePose(shell);
    camera.position.copy(home.position);
    camera.lookAt(home.target);
    if (controls) {
      controls.target.copy(home.target);
      controls.maxDistance = Math.max(shell.widthM, shell.depthM) * 3;
      controls.update();
    }
    this.host.cameraMoved();
  }

  /** Lleva la cámara de órbita a una vista conocida del cuarto. */
  viewFrom(shell: RoomShell | null, preset: ViewPreset): void {
    if (!shell || this.host.walking()) return;
    if (preset === 'corner') return this.frameRoom(shell);
    const camera = this.host.camera;
    const controls = this.host.controls();
    const centre = roomCenter(shell);
    const span = Math.max(shell.widthM, shell.depthM);
    if (controls) controls.maxDistance = span * 3;
    // Casi vertical: justo encima, los controles de órbita pierden la referencia del "arriba".
    const above = new THREE.Vector3(centre.x, span * 1.9 + 2, centre.z + 0.01);
    if (preset === 'plan') {
      // Sin perspectiva: lo que se ve es el plano a escala, y se sigue pudiendo editar.
      this.setFov(ORBIT_FOV);
      camera.setOrthographic(planViewSpan(shell.widthM, shell.depthM, camera.aspect));
      return this.lookFrom(above, new THREE.Vector3(centre.x, 0, centre.z));
    }
    camera.setOrthographic(null);
    this.setFov(ORBIT_FOV);
    const target = new THREE.Vector3(centre.x, 0.6, centre.z);
    const away = span * 1.5 + 1.5;
    const position: Record<Exclude<ViewPreset, 'corner' | 'plan'>, THREE.Vector3> = {
      top: above,
      front: new THREE.Vector3(centre.x, shell.heightM * 0.7, shell.depthM + away),
      left: new THREE.Vector3(-away, shell.heightM * 0.7, centre.z),
      right: new THREE.Vector3(shell.widthM + away, shell.heightM * 0.7, centre.z),
    };
    this.lookFrom(position[preset], preset === 'top' ? new THREE.Vector3(centre.x, 0, centre.z) : target);
  }

  /** Acerca la cámara a una pieza conservando la dirección desde la que se mira. */
  frameItem(placement: FurniturePlacement, item: CatalogItem): void {
    if (this.host.walking()) return;
    const dims = effectiveDimensions(item.dimensionsM, placement);
    const target = new THREE.Vector3(placement.position.x, placement.position.y + dims.y / 2, placement.position.z);
    const from = this.host.camera.position.clone().sub(this.host.controls()?.target ?? target);
    const distance = Math.max(1.6, Math.hypot(dims.x, dims.y, dims.z) * 2.2);
    this.lookFrom(target.clone().add(from.normalize().multiplyScalar(distance)), target);
  }

  private setFov(fov: number): void {
    const camera = this.host.camera;
    if (camera.fov === fov) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  private lookFrom(position: THREE.Vector3, target: THREE.Vector3): void {
    const camera = this.host.camera;
    const controls = this.host.controls();
    camera.position.copy(position);
    camera.lookAt(target);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
    this.host.cameraMoved();
  }
}
