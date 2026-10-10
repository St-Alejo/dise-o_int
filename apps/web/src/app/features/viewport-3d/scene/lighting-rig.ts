import type { RoomShell } from '@interiores/shared-types';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Luces y entorno de la escena: un sol con sombra, luz de relleno y reflejos PBR. */
export class LightingRig {
  private readonly sun = new THREE.DirectionalLight('#fff3e0', 1.6);
  private readonly fill = new THREE.HemisphereLight('#fff7ee', '#8a7560', 0.7);
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.sun.position.set(-3, 6, -2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.name = 'sun';
    scene.add(this.fill, this.sun, this.sun.target);
  }

  /** Entorno PBR para reflejos realistas; necesita el renderer ya creado. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(env, 0.04);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.55;
    env.dispose();
    pmrem.dispose();
  }

  /** Coloca el sol y su cámara de sombras para que cubran el cuarto entero. */
  fitToRoom(shell: RoomShell): void {
    const span = Math.max(shell.widthM, shell.depthM);
    this.sun.position.set(shell.widthM * 0.2, shell.heightM * 2.6, -span * 0.4);
    this.sun.target.position.set(shell.widthM / 2, 0, shell.depthM / 2);
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, far: span * 5 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.scene.environment = null;
  }
}
