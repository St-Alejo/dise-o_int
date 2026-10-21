import { alongOf, distanceFromWall, wallFrames, type Lighting, type RoomShell } from '@interiores/shared-types';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type TimeOfDay = 'day' | 'evening' | 'night';
export const TIMES_OF_DAY: readonly { id: TimeOfDay; label: string }[] = [
  { id: 'day', label: 'Día' },
  { id: 'evening', label: 'Tarde' },
  { id: 'night', label: 'Noche' },
];

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
  /** Altura del sol en grados: mirando el cuarto desde fuera y desde dentro (recorrido). */
  readonly elevation: { outside: number; inside: number };
  /** Claridad que entra por cada ventana, además del sol directo. */
  readonly window: { color: string; intensity: number };
  /** Exposición con la que se revela la imagen. */
  readonly exposure: number;
  readonly sky: { color: string; ground: string; intensity: number };
  /** Cuánto aporta el entorno a los reflejos y a la luz ambiente. */
  readonly environment: number;
  /** Luz general del techo, para que el interior no quede plano. */
  readonly ceiling: number;
  /** Intensidad de cada lámpara colocada. */
  readonly lamp: number;
  /** Cuánto brilla la pantalla de una lámpara (0 = apagada). */
  readonly glow: number;
  /** Fuerza del halo de lo que brilla (bombillas, pantallas): solo cuando hay lámparas encendidas. */
  readonly bloom: number;
}

export const LIGHTING_PRESETS: Record<TimeOfDay, LightingPreset> = {
  // De día manda el sol que entra; las lámparas apenas se notan. El relleno es bajo a propósito:
  // la sombra y la penumbra de los rincones son lo que da volumen.
  day: {
    background: '#e9e3da',
    skyline: { top: '#7fb2e0', horizon: '#e6eef2', ground: '#d9d2c6' },
    sun: { color: '#fff0d6', intensity: 2.9 },
    elevation: { outside: 56, inside: 36 },
    window: { color: '#eaf2ff', intensity: 9 },
    exposure: 1,
    sky: { color: '#fff7ee', ground: '#8a7560', intensity: 0.34 },
    environment: 0.42,
    ceiling: 1.1,
    lamp: 3,
    glow: 0.12,
    bloom: 0,
  },
  // Por la tarde el sol entra bajo y cálido: sombras largas y lámparas que empiezan a notarse.
  evening: {
    background: '#ecd9c4',
    skyline: { top: '#7f93c2', horizon: '#ffd2a1', ground: '#cdb9a2' },
    sun: { color: '#ffb877', intensity: 3.3 },
    elevation: { outside: 32, inside: 17 },
    window: { color: '#ffd0a0', intensity: 7 },
    exposure: 1.02,
    sky: { color: '#ffe6cc', ground: '#7a6250', intensity: 0.24 },
    environment: 0.32,
    ceiling: 0.7,
    lamp: 5,
    glow: 0.7,
    bloom: 0.06,
  },
  // De noche casi no hay luz de fuera: el cuarto lo alumbran sus lámparas, con tono cálido.
  night: {
    background: '#1b1f2a',
    skyline: { top: '#0b1020', horizon: '#27304a', ground: '#15171d' },
    sun: { color: '#9db4d8', intensity: 0.12 },
    elevation: { outside: 56, inside: 36 },
    window: { color: '#8fa6d0', intensity: 0.5 },
    exposure: 1.05,
    sky: { color: '#3b4660', ground: '#1a1614', intensity: 0.22 },
    environment: 0.1,
    ceiling: 3.5,
    lamp: 9,
    glow: 1.6,
    bloom: 0.12,
  },
};

/** Tope de lámparas que alumbran: cada luz puntual cuesta en todos los materiales de la escena. */
export const MAX_LAMPS = 6;
/**
 * Distancia mínima de la luz de una lámpara a una pared. La pantalla tapa la bombilla por los
 * lados; sin eso, una lámpara de mesa pegada a la pared la quema de blanco.
 */
export const LAMP_WALL_GAP = 0.4;

/** Aparta un punto de las paredes que tenga a menos de `gap` (sin sacarlo del tramo de pared). */
export function keepOffWalls(shell: RoomShell, p: { x: number; z: number }, gap = LAMP_WALL_GAP): { x: number; z: number } {
  let q = { ...p };
  for (const wall of wallFrames(shell)) {
    const along = alongOf(wall, q);
    if (along < 0 || along > wall.length) continue;
    const d = distanceFromWall(wall, q);
    if (d >= gap || d < -0.05) continue;
    q = { x: q.x + wall.normal.x * (gap - d), z: q.z + wall.normal.z * (gap - d) };
  }
  return q;
}

/** Lado del mapa de sombras (cúbico) de cada lámpara que proyecta sombra. */
export const LAMP_SHADOW_MAP = 512;

/** Ambiente guardado con el diseño: el tono de las lámparas y del techo, y cuánto alumbran. */
export const MOOD_COLORS: Record<Lighting['mood'], { lamp: string; ceiling: string }> = {
  calida: { lamp: '#ffc98f', ceiling: '#ffe7c7' },
  neutra: { lamp: '#ffd9a8', ceiling: '#fff1dc' },
  fria: { lamp: '#eef3ff', ceiling: '#e8f0ff' },
};
export const LEVEL_FACTOR: Record<Lighting['level'], number> = { tenue: 0.6, media: 1, alta: 1.45 };
/** Sin ambiente elegido, el de siempre: tono neutro y a media luz. */
export const DEFAULT_LIGHTING: Lighting = { mood: 'neutra', level: 'media' };
/** A qué altura del cuarto (fracción de su alto) va la luz general. */
export const FILL_HEIGHT = 0.72;
const DEG = Math.PI / 180;
/** Ventanas que dan claridad propia (las más grandes): cada luz cuesta en todos los materiales. */
export const MAX_WINDOW_LIGHTS = 2;
/** El sol no entra de frente por la ventana: un poco de lado, y la mancha de luz queda sesgada. */
const SUN_SKEW = 24 * DEG;

/** Una ventana vista como fuente de luz: su centro y hacia dónde mira (al interior). */
export interface WindowSpot {
  area: number;
  x: number;
  y: number;
  z: number;
  normal: { x: number; z: number };
}

/** Las ventanas del cuarto, de la más grande a la más pequeña. */
export function windowSpots(shell: RoomShell): WindowSpot[] {
  const frames = wallFrames(shell);
  const spots: WindowSpot[] = [];
  for (const opening of shell.openings) {
    if (opening.type !== 'window') continue;
    const index = shell.walls.findIndex((w) => w.id === opening.wallId);
    const wall = shell.walls[index];
    const frame = frames[index];
    if (!wall || !frame) continue;
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z) || 1;
    const t = opening.offsetM / length;
    spots.push({
      area: opening.widthM * opening.heightM,
      x: wall.start.x + (wall.end.x - wall.start.x) * t,
      y: opening.sillHeightM + opening.heightM / 2,
      z: wall.start.z + (wall.end.z - wall.start.z) * t,
      normal: { x: frame.normal.x, z: frame.normal.z },
    });
  }
  return spots.sort((a, b) => b.area - a.area);
}

/** De dónde viene el sol en planta (vector unitario que apunta hacia dentro del cuarto). */
export function sunHeading(shell: RoomShell): { x: number; z: number } {
  const best = windowSpots(shell)[0]?.normal ?? null;
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
  private readonly windowRoot = new THREE.Group();
  private renderer: THREE.WebGLRenderer | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private skies: Partial<Record<TimeOfDay, THREE.Texture | null>> = {};
  private time: TimeOfDay = 'day';
  /** Se mira desde dentro del cuarto (recorrido): el sol baja y entra por la ventana. */
  private interior = false;
  private shell: RoomShell | null = null;
  private mood: Lighting = DEFAULT_LIGHTING;
  /** Cuántas lámparas proyectan sombra (según la calidad del visor). */
  private lampShadows = 0;
  /** Las últimas lámparas pedidas: al cambiar el cuarto se vuelven a apartar de sus paredes. */
  private spots: readonly LampSpot[] = [];

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
    this.windowRoot.name = 'window-lights';
    scene.add(this.sky, this.sun, this.sun.target, this.ceiling, this.lampRoot, this.windowRoot);
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
    this.renderer = renderer;
    // Puede llamarse otra vez (la GPU se perdió y volvió): lo anterior ya no sirve.
    this.envTarget?.dispose();
    for (const texture of Object.values(this.skies)) texture?.dispose();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(env, 0.04);
    this.scene.environment = this.envTarget.texture;
    env.dispose();
    pmrem.dispose();
    this.skies = {
      day: skyTexture(LIGHTING_PRESETS.day.skyline),
      evening: skyTexture(LIGHTING_PRESETS.evening.skyline),
      night: skyTexture(LIGHTING_PRESETS.night.skyline),
    };
    this.apply();
  }

  /** Lado del mapa de sombras del sol (la calidad del visor lo baja en equipos justos). */
  setShadowSize(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** Coloca el sol, su cámara de sombras y la luz del techo para que cubran el cuarto entero. */
  fitToRoom(shell: RoomShell): void {
    this.shell = shell;
    const span = Math.max(shell.widthM, shell.depthM);
    // Lejos del techo: una luz pegada a él deja una mancha quemada justo encima.
    this.ceiling.position.set(shell.widthM / 2, shell.heightM * FILL_HEIGHT, shell.depthM / 2);
    this.ceiling.distance = span * 2.5;
    this.syncWindows(shell, span);
    this.syncLamps(this.spots);
    this.aimSun();
    this.apply();
  }

  /** La claridad de cada ventana: una luz ancha y sin borde que entra hacia el piso del cuarto. */
  private syncWindows(shell: RoomShell, span: number): void {
    for (const child of this.windowRoot.children) (child as Partial<THREE.SpotLight>).dispose?.();
    this.windowRoot.clear();
    for (const spot of windowSpots(shell).slice(0, MAX_WINDOW_LIGHTS)) {
      const light = new THREE.SpotLight('#ffffff', 0, span * 2.2, 1.15, 1, 1.6);
      light.name = 'window-light';
      light.position.set(spot.x + spot.normal.x * 0.08, spot.y, spot.z + spot.normal.z * 0.08);
      light.target.position.set(spot.x + spot.normal.x * span * 0.55, 0.2, spot.z + spot.normal.z * span * 0.55);
      this.windowRoot.add(light, light.target);
    }
  }

  /** Ambiente de luz del diseño (cálida/neutra/fría y tenue/media/alta). */
  setMood(lighting: Lighting | null | undefined): void {
    const next = lighting ?? DEFAULT_LIGHTING;
    if (next.mood === this.mood.mood && next.level === this.mood.level) return;
    this.mood = next;
    this.apply();
  }

  get lighting(): Lighting {
    return this.mood;
  }

  /**
   * Las primeras `count` lámparas proyectan sombra. Cada una es un mapa cúbico (seis vistas
   * por cuadro), así que solo en calidad alta y con pocas.
   */
  setLampShadows(count: number): void {
    if (count === this.lampShadows) return;
    this.lampShadows = count;
    this.syncLampShadows();
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
    this.aimSun();
    this.apply();
  }

  /** Una luz por lámpara del cuarto, hasta el tope; las que ya no están se apagan y se quitan. */
  syncLamps(spots: readonly LampSpot[]): void {
    this.spots = spots;
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
        light = new THREE.PointLight(MOOD_COLORS[this.mood.mood].lamp, this.lampIntensity(), 7, 2);
        light.name = `lamp-${spot.id}`;
        light.shadow.mapSize.set(LAMP_SHADOW_MAP, LAMP_SHADOW_MAP);
        light.shadow.bias = -0.002;
        light.shadow.normalBias = 0.03;
        light.shadow.radius = 4;
        // La bombilla está dentro de su pantalla: lo que quede a menos de esto no tapa la luz.
        light.shadow.camera.near = 0.12;
        this.lamps.set(spot.id, light);
        this.lampRoot.add(light);
      }
      const at = this.shell ? keepOffWalls(this.shell, spot) : spot;
      light.position.set(at.x, spot.y, at.z);
    }
    this.syncLampShadows();
  }

  private syncLampShadows(): void {
    let i = 0;
    for (const light of this.lamps.values()) {
      const cast = i++ < this.lampShadows;
      if (light.castShadow === cast) continue;
      light.castShadow = cast;
      if (!cast) {
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    }
  }

  private lampIntensity(): number {
    return LIGHTING_PRESETS[this.time].lamp * LEVEL_FACTOR[this.mood.level];
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.scene.environment = null;
    for (const texture of Object.values(this.skies)) texture?.dispose();
    this.skies = {};
    for (const light of this.lamps.values()) light.dispose();
    this.lamps.clear();
    for (const child of this.windowRoot.children) (child as Partial<THREE.SpotLight>).dispose?.();
    this.windowRoot.clear();
    this.renderer = null;
  }

  private aimSun(): void {
    const shell = this.shell;
    if (!shell) return;
    const span = Math.max(shell.widthM, shell.depthM);
    const heading = sunHeading(shell);
    const angles = LIGHTING_PRESETS[this.time].elevation;
    const elevation = (this.interior ? angles.inside : angles.outside) * DEG;
    const distance = span * 3;
    const centre = { x: shell.widthM / 2, z: shell.depthM / 2 };
    this.sun.position.set(
      centre.x - heading.x * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      centre.z - heading.z * Math.cos(elevation) * distance,
    );
    this.sun.target.position.set(centre.x, 0, centre.z);
    // La cámara de sombras abarca justo el cuarto (su diagonal, con alto y un margen): cuanto más
    // ajustada, más fina la sombra con el mismo mapa.
    const reach = Math.hypot(shell.widthM, shell.depthM, shell.heightM) / 2 + 0.3;
    Object.assign(this.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: Math.max(0.5, distance - reach * 1.5), far: distance + reach * 1.5 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  private apply(): void {
    const preset = LIGHTING_PRESETS[this.time];
    this.scene.background = this.skies[this.time] ?? new THREE.Color(preset.background);
    this.scene.environmentIntensity = preset.environment;
    // El posprocesado lo lee de aquí: el halo depende de la hora, no de la calidad.
    this.scene.userData['bloom'] = preset.bloom;
    this.sun.color.set(preset.sun.color);
    this.sun.intensity = preset.sun.intensity;
    this.sky.color.set(preset.sky.color);
    this.sky.groundColor.set(preset.sky.ground);
    this.sky.intensity = preset.sky.intensity;
    const colors = MOOD_COLORS[this.mood.mood];
    const level = LEVEL_FACTOR[this.mood.level];
    this.ceiling.color.set(colors.ceiling);
    this.ceiling.intensity = preset.ceiling * level;
    if (this.renderer) this.renderer.toneMappingExposure = preset.exposure;
    for (const child of this.windowRoot.children) {
      if (!(child instanceof THREE.SpotLight)) continue;
      child.color.set(preset.window.color);
      child.intensity = preset.window.intensity;
    }
    for (const light of this.lamps.values()) {
      light.color.set(colors.lamp);
      light.intensity = this.lampIntensity();
    }
  }
}
