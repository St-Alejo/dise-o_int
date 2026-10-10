import type { RoomShell } from '@interiores/shared-types';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type TimeOfDay = 'day' | 'night';

/** Una lámpara del cuarto: dónde está su bombilla. */
export interface LampSpot {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Cómo se ilumina el cuarto a cierta hora (patrón Strategy: cambiar de hora es cambiar de preset). */
export interface LightingPreset {
  readonly background: string;
  readonly sun: { color: string; intensity: number };
  readonly sky: { color: string; ground: string; intensity: number };
  /** Cuánto aporta el entorno a los reflejos y a la luz ambiente. */
  readonly environment: number;
  /** Luz general del techo, para que el interior no quede plano. */
  readonly ceiling: number;
  /** Intensidad de cada lámpara colocada. */
  readonly lamp: number;
}

export const LIGHTING_PRESETS: Record<TimeOfDay, LightingPreset> = {
  // De día manda el sol que entra; las lámparas apenas se notan.
  day: {
    background: '#e9e3da',
    sun: { color: '#fff3e0', intensity: 1.6 },
    sky: { color: '#fff7ee', ground: '#8a7560', intensity: 0.7 },
    environment: 0.55,
    ceiling: 2.5,
    lamp: 3,
  },
  // De noche casi no hay luz de fuera: el cuarto lo alumbran sus lámparas, con tono cálido.
  night: {
    background: '#1b1f2a',
    sun: { color: '#9db4d8', intensity: 0.12 },
    sky: { color: '#3b4660', ground: '#1a1614', intensity: 0.22 },
    environment: 0.1,
    ceiling: 3.5,
    lamp: 16,
  },
};

/** Tope de lámparas que alumbran: cada luz puntual cuesta en todos los materiales de la escena. */
export const MAX_LAMPS = 6;
const LAMP_COLOR = '#ffd9a8';

/** Luces y entorno de la escena: sol con sombra, cielo, luz general del techo y las lámparas del cuarto. */
export class LightingRig {
  private readonly sun = new THREE.DirectionalLight('#fff3e0', 1.6);
  private readonly sky = new THREE.HemisphereLight('#fff7ee', '#8a7560', 0.7);
  private readonly ceiling = new THREE.PointLight('#fff1dc', 0, 0, 2);
  private readonly lamps = new Map<string, THREE.PointLight>();
  private readonly lampRoot = new THREE.Group();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private time: TimeOfDay = 'day';

  constructor(private readonly scene: THREE.Scene) {
    this.sun.position.set(-3, 6, -2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.name = 'sun';
    this.ceiling.name = 'ceiling-light';
    this.lampRoot.name = 'lamps';
    scene.add(this.sky, this.sun, this.sun.target, this.ceiling, this.lampRoot);
    this.apply();
  }

  get timeOfDay(): TimeOfDay {
    return this.time;
  }

  get lampCount(): number {
    return this.lamps.size;
  }

  /** Entorno PBR para reflejos realistas; necesita el renderer ya creado. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(env, 0.04);
    this.scene.environment = this.envTarget.texture;
    env.dispose();
    pmrem.dispose();
    this.apply();
  }

  /** Coloca el sol, su cámara de sombras y la luz del techo para que cubran el cuarto entero. */
  fitToRoom(shell: RoomShell): void {
    const span = Math.max(shell.widthM, shell.depthM);
    this.sun.position.set(shell.widthM * 0.2, shell.heightM * 2.6, -span * 0.4);
    this.sun.target.position.set(shell.widthM / 2, 0, shell.depthM / 2);
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, far: span * 5 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.ceiling.position.set(shell.widthM / 2, shell.heightM - 0.25, shell.depthM / 2);
    this.ceiling.distance = span * 2.5;
  }

  setTimeOfDay(time: TimeOfDay): void {
    this.time = time;
    this.apply();
  }

  /** Una luz por lámpara del cuarto, hasta el tope; las que ya no están se apagan y se quitan. */
  syncLamps(spots: readonly LampSpot[]): void {
    const wanted = spots.slice(0, MAX_LAMPS);
    const ids = new Set(wanted.map((s) => s.id));
    for (const [id, light] of this.lamps) {
      if (ids.has(id)) continue;
      this.lampRoot.remove(light);
      light.dispose();
      this.lamps.delete(id);
    }
    for (const spot of wanted) {
      let light = this.lamps.get(spot.id);
      if (!light) {
        // Sin sombra propia: seis mapas de sombra cúbicos serían demasiado para un portátil.
        light = new THREE.PointLight(LAMP_COLOR, LIGHTING_PRESETS[this.time].lamp, 7, 2);
        light.name = `lamp-${spot.id}`;
        this.lamps.set(spot.id, light);
        this.lampRoot.add(light);
      }
      light.position.set(spot.x, spot.y, spot.z);
    }
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.scene.environment = null;
    for (const light of this.lamps.values()) light.dispose();
    this.lamps.clear();
  }

  private apply(): void {
    const preset = LIGHTING_PRESETS[this.time];
    this.scene.background = new THREE.Color(preset.background);
    this.scene.environmentIntensity = preset.environment;
    this.sun.color.set(preset.sun.color);
    this.sun.intensity = preset.sun.intensity;
    this.sky.color.set(preset.sky.color);
    this.sky.groundColor.set(preset.sky.ground);
    this.sky.intensity = preset.sky.intensity;
    this.ceiling.intensity = preset.ceiling;
    for (const light of this.lamps.values()) light.intensity = preset.lamp;
  }
}
