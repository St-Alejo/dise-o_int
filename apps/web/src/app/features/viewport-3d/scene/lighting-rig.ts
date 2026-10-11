import { wallFrames, type RoomShell } from '@interiores/shared-types';
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
  /** Cielo que se ve por las ventanas: de arriba al horizonte, y el suelo de fuera. */
  readonly skyline: { top: string; horizon: string; ground: string };
  readonly sun: { color: string; intensity: number };
  readonly sky: { color: string; ground: string; intensity: number };
  /** Cuánto aporta el entorno a los reflejos y a la luz ambiente. */
  readonly environment: number;
  /** Luz general del techo, para que el interior no quede plano. */
  readonly ceiling: number;
  /** Intensidad de cada lámpara colocada. */
  readonly lamp: number;
  /** Cuánto brilla la pantalla de una lámpara (0 = apagada). */
  readonly glow: number;
}

export const LIGHTING_PRESETS: Record<TimeOfDay, LightingPreset> = {
  // De día manda el sol que entra; las lámparas apenas se notan.
  day: {
    background: '#e9e3da',
    skyline: { top: '#7fb2e0', horizon: '#e6eef2', ground: '#d9d2c6' },
    sun: { color: '#fff0d6', intensity: 2.1 },
    sky: { color: '#fff7ee', ground: '#8a7560', intensity: 0.62 },
    environment: 0.55,
    ceiling: 2.5,
    lamp: 3,
    glow: 0.12,
  },
  // De noche casi no hay luz de fuera: el cuarto lo alumbran sus lámparas, con tono cálido.
  night: {
    background: '#1b1f2a',
    skyline: { top: '#0b1020', horizon: '#27304a', ground: '#15171d' },
    sun: { color: '#9db4d8', intensity: 0.12 },
    sky: { color: '#3b4660', ground: '#1a1614', intensity: 0.22 },
    environment: 0.1,
    ceiling: 3.5,
    lamp: 16,
    glow: 1.6,
  },
};

/** Tope de lámparas que alumbran: cada luz puntual cuesta en todos los materiales de la escena. */
export const MAX_LAMPS = 6;
const LAMP_COLOR = '#ffd9a8';
/** A qué altura del cuarto (fracción de su alto) va la luz general. */
export const FILL_HEIGHT = 0.72;
const DEG = Math.PI / 180;
/** Altura del sol: alto para ver el cuarto desde fuera; más bajo dentro, para que entre por la ventana. */
const SUN_ELEVATION = { outside: 60 * DEG, inside: 36 * DEG };
/** El sol no entra de frente por la ventana: un poco de lado, y la mancha de luz queda sesgada. */
const SUN_SKEW = 24 * DEG;

/** De dónde viene el sol en planta (vector unitario que apunta hacia dentro del cuarto). */
export function sunHeading(shell: RoomShell): { x: number; z: number } {
  const frames = wallFrames(shell);
  let best: { area: number; x: number; z: number } | null = null;
  for (const opening of shell.openings) {
    if (opening.type !== 'window') continue;
    const index = shell.walls.findIndex((w) => w.id === opening.wallId);
    const frame = frames[index];
    if (!frame) continue;
    const area = opening.widthM * opening.heightM;
    if (!best || area > best.area) best = { area, x: frame.normal.x, z: frame.normal.z };
  }
  // Sin ventanas, el sol viene del fondo, como siempre.
  const n = best ?? { x: 0.25, z: 1 };
  const cos = Math.cos(SUN_SKEW);
  const sin = Math.sin(SUN_SKEW);
  const x = n.x * cos - n.z * sin;
  const z = n.x * sin + n.z * cos;
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}

/** Cielo en degradado, como textura panorámica (se ve por las ventanas al recorrer el cuarto). */
function skyTexture(colors: LightingPreset['skyline']): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, colors.top);
  gradient.addColorStop(0.47, colors.horizon);
  gradient.addColorStop(0.53, colors.ground);
  gradient.addColorStop(1, colors.ground);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Luces y entorno de la escena: sol con sombra, cielo, luz general del techo y las lámparas del cuarto. */
export class LightingRig {
  private readonly sun = new THREE.DirectionalLight('#fff3e0', 1.6);
  private readonly sky = new THREE.HemisphereLight('#fff7ee', '#8a7560', 0.7);
  private readonly ceiling = new THREE.PointLight('#fff1dc', 0, 0, 2);
  private readonly lamps = new Map<string, THREE.PointLight>();
  private readonly lampRoot = new THREE.Group();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private skies: Partial<Record<TimeOfDay, THREE.Texture | null>> = {};
  private time: TimeOfDay = 'day';
  /** Se mira desde dentro del cuarto (recorrido): el sol baja y entra por la ventana. */
  private interior = false;
  private shell: RoomShell | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.sun.position.set(-3, 6, -2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    // Borde de sombra suave: una sombra de sol nunca es una línea dura.
    this.sun.shadow.radius = 3.5;
    this.sun.shadow.blurSamples = 16;
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

  /** Brillo de las pantallas de lámpara a esta hora. */
  get glow(): number {
    return LIGHTING_PRESETS[this.time].glow;
  }

  /** Entorno PBR para reflejos realistas; necesita el renderer ya creado. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(env, 0.04);
    this.scene.environment = this.envTarget.texture;
    env.dispose();
    pmrem.dispose();
    this.skies = { day: skyTexture(LIGHTING_PRESETS.day.skyline), night: skyTexture(LIGHTING_PRESETS.night.skyline) };
    this.apply();
  }

  /** Coloca el sol, su cámara de sombras y la luz del techo para que cubran el cuarto entero. */
  fitToRoom(shell: RoomShell): void {
    this.shell = shell;
    const span = Math.max(shell.widthM, shell.depthM);
    // Lejos del techo: una luz pegada a él deja una mancha quemada justo encima.
    this.ceiling.position.set(shell.widthM / 2, shell.heightM * FILL_HEIGHT, shell.depthM / 2);
    this.ceiling.distance = span * 2.5;
    this.aimSun();
  }

  /** Dentro del cuarto el sol entra por la ventana; desde fuera alumbra desde arriba. */
  setInterior(interior: boolean): void {
    if (this.interior === interior) return;
    this.interior = interior;
    this.aimSun();
    this.apply();
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
    for (const texture of Object.values(this.skies)) texture?.dispose();
    this.skies = {};
    for (const light of this.lamps.values()) light.dispose();
    this.lamps.clear();
  }

  private aimSun(): void {
    const shell = this.shell;
    if (!shell) return;
    const span = Math.max(shell.widthM, shell.depthM);
    const heading = sunHeading(shell);
    const elevation = this.interior ? SUN_ELEVATION.inside : SUN_ELEVATION.outside;
    const distance = span * 3;
    const centre = { x: shell.widthM / 2, z: shell.depthM / 2 };
    this.sun.position.set(
      centre.x - heading.x * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      centre.z - heading.z * Math.cos(elevation) * distance,
    );
    this.sun.target.position.set(centre.x, 0, centre.z);
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.5, far: distance + span * 2 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  private apply(): void {
    const preset = LIGHTING_PRESETS[this.time];
    this.scene.background = this.skies[this.time] ?? new THREE.Color(preset.background);
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
