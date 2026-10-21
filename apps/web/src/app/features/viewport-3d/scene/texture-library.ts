import { surfaceTextureSet, TextureManifestSchema, type MaterialDefinition, type TextureManifest, type TextureSet } from '@interiores/shared-types';
import * as THREE from 'three';
import { drawPattern } from './pattern-textures';

/** Dibujo que lleva el piso según su material. */
export type FloorPattern = 'planks' | 'tiles' | 'veins' | 'speckle';

export interface FloorTextureSpec {
  pattern: FloorPattern;
  /** Metros de piso que cubre una repetición de la textura. */
  tileM: number;
}

/**
 * Qué textura le corresponde a un material de piso (o null si va liso). Es una decisión del
 * dominio visual, separada del dibujo para poder probarla sin canvas.
 */
export function floorTextureSpec(material: Pick<MaterialDefinition, 'id' | 'kind'>): FloorTextureSpec | null {
  if (material.kind === 'wood') return { pattern: 'planks', tileM: 2.4 };
  if (material.kind === 'ceramic') return { pattern: 'tiles', tileM: 1.2 };
  if (material.kind === 'stone') return material.id.includes('microcement') ? { pattern: 'speckle', tileM: 3 } : { pattern: 'veins', tileM: 2.4 };
  return null;
}

/** Generador pseudoaleatorio con semilla: el mismo material da siempre la misma textura. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const SIZE = 512;
const grey = (v: number) => {
  const c = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${c},${c},${c})`;
};

type Painter = (ctx: CanvasRenderingContext2D, random: () => number) => void;

/**
 * Cada dibujo va en grises claros: la textura MULTIPLICA el color del material, así el roble
 * sigue siendo roble y el nogal, nogal, y solo cambia el relieve que se ve.
 */
const PAINTERS: Record<FloorPattern, Painter> = {
  // Listones a lo largo, con juntas desfasadas y veta fina.
  planks(ctx, random) {
    const rows = 8;
    const h = SIZE / rows;
    for (let r = 0; r < rows; r++) {
      let x = -random() * SIZE * 0.5;
      while (x < SIZE) {
        const w = SIZE * (0.35 + random() * 0.3);
        ctx.fillStyle = grey(0.86 + random() * 0.14);
        ctx.fillRect(x, r * h, w, h);
        ctx.fillStyle = grey(0.62);
        ctx.fillRect(x + w - 1.5, r * h, 1.5, h);
        x += w;
      }
      ctx.fillStyle = grey(0.66);
      ctx.fillRect(0, r * h, SIZE, 1.5);
    }
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#000';
    for (let i = 0; i < 220; i++) {
      const y = random() * SIZE;
      const x = random() * SIZE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 40 + random() * 120, y + (random() - 0.5) * 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  // Baldosas cuadradas con junta.
  tiles(ctx, random) {
    const n = 2;
    const s = SIZE / n;
    ctx.fillStyle = grey(0.7);
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = grey(0.92 + random() * 0.08);
        ctx.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      }
    }
  },
  // Mármol o travertino: fondo claro con vetas suaves.
  veins(ctx, random) {
    ctx.fillStyle = grey(0.97);
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = '#000';
    for (let i = 0; i < 14; i++) {
      ctx.globalAlpha = 0.04 + random() * 0.08;
      ctx.lineWidth = 0.6 + random() * 2.4;
      let x = random() * SIZE;
      let y = random() * SIZE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 12; k++) {
        x += 20 + random() * 50;
        y += (random() - 0.5) * 70;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  // Microcemento: moteado fino.
  speckle(ctx, random) {
    ctx.fillStyle = grey(0.95);
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 2600; i++) {
      ctx.globalAlpha = 0.03 + random() * 0.07;
      ctx.fillStyle = random() > 0.5 ? '#000' : '#fff';
      const r = 1 + random() * 5;
      ctx.beginPath();
      ctx.arc(random() * SIZE, random() * SIZE, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};

/**
 * Mapas de un acabado listos para el material. `tint` se multiplica por `map` para llegar al color
 * exacto del material; null = el color del material tal cual.
 */
export interface SurfaceMaps {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  normalScale: number;
  /** Oclusión (R) y rugosidad (G): el mismo mapa sirve para las dos cosas. */
  armMap: THREE.Texture | null;
  /** Relieve barato para las texturas de canvas, que no traen normal. */
  bumpMap: THREE.Texture | null;
  tint: THREE.Color | null;
}

export type SurfaceKind = 'floor' | 'wall' | 'ceiling';

const NONE: SurfaceMaps = { map: null, normalMap: null, normalScale: 1, armMap: null, bumpMap: null, tint: null };

/** Color que, multiplicado por una textura de color medio `avg`, da `target` en promedio (espacio lineal). */
export function tintFor(target: string, avg: string): THREE.Color {
  const t = new THREE.Color(target);
  const a = new THREE.Color(avg);
  const ratio = (x: number, y: number) => Math.min(4, x / Math.max(y, 0.02));
  return new THREE.Color(ratio(t.r, a.r), ratio(t.g, a.g), ratio(t.b, a.b));
}

/**
 * Texturas de los acabados (Flyweight: cada imagen se carga una vez y se comparte). Primero las
 * PBR reales que sembró la API; si no hay (seed sin red, pruebas), las de canvas. Los acabados
 * descritos por la persona se dibujan con su patrón y sus colores.
 */
export class TextureLibrary {
  private readonly canvasCache = new Map<string, THREE.Texture | null>();
  private readonly patternCache = new Map<string, ReturnType<typeof drawPattern>>();
  private readonly loaded = new Map<string, THREE.Texture>();
  private manifest: TextureManifest | null = null;
  private loader: THREE.TextureLoader | null = null;

  /** `onChange` se llama cuando termina de llegar algo (manifiesto o imagen): hay que volver a pintar. */
  constructor(private readonly onChange: () => void = () => undefined) {}

  /** Pide el manifiesto de texturas a la API. Sin red o sin texturas sembradas, queda el canvas. */
  async load(url = '/api/textures'): Promise<void> {
    if (typeof fetch === 'undefined' || typeof document === 'undefined') return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const parsed = TextureManifestSchema.safeParse(await res.json());
      if (!parsed.success || !Object.keys(parsed.data.sets).length) return;
      this.manifest = parsed.data;
      this.onChange();
    } catch {
      /* sin red: siguen las de canvas */
    }
  }

  /** Para las pruebas y para quien ya tenga el manifiesto. */
  setManifest(manifest: TextureManifest | null): void {
    this.manifest = manifest;
  }

  get credits(): string | null {
    return this.manifest?.credits || null;
  }

  surface(material: MaterialDefinition, where: SurfaceKind): SurfaceMaps {
    if (material.spec) {
      if (!this.patternCache.has(material.id)) this.patternCache.set(material.id, drawPattern(material.id, material.spec));
      const pattern = this.patternCache.get(material.id);
      if (pattern) return { ...NONE, map: pattern.map, normalMap: pattern.normalMap, normalScale: 0.8, tint: new THREE.Color('#ffffff') };
    }
    const set = surfaceTextureSet(this.manifest, material);
    if (set) {
      const normalMap = this.texture(set, 'normal');
      const armMap = this.texture(set, 'arm');
      // La pintura va lisa de color: de la textura solo toma el relieve fino del enlucido.
      if (material.kind === 'paint' && !material.spec) return { ...NONE, normalMap, armMap, normalScale: 0.35 };
      return { map: this.texture(set, 'albedo'), normalMap, normalScale: 1, armMap, bumpMap: null, tint: tintFor(material.color, set.avgColor) };
    }
    if (where !== 'floor') return NONE;
    const map = this.floor(material);
    return map ? { ...NONE, map, bumpMap: map } : NONE;
  }

  /** Textura de canvas del piso para ese material, o null si va liso o no hay canvas (pruebas). */
  floor(material: MaterialDefinition): THREE.Texture | null {
    if (this.canvasCache.has(material.id)) return this.canvasCache.get(material.id)!;
    const spec = floorTextureSpec(material);
    const texture = spec ? this.draw(material.id, spec) : null;
    this.canvasCache.set(material.id, texture);
    return texture;
  }

  dispose(): void {
    for (const texture of this.canvasCache.values()) texture?.dispose();
    for (const pattern of this.patternCache.values()) {
      pattern?.map.dispose();
      pattern?.normalMap.dispose();
    }
    for (const texture of this.loaded.values()) texture.dispose();
    this.canvasCache.clear();
    this.patternCache.clear();
    this.loaded.clear();
  }

  private texture(set: TextureSet, map: keyof TextureSet['maps']): THREE.Texture {
    const url = set.maps[map];
    const cached = this.loaded.get(url);
    if (cached) return cached;
    this.loader ??= new THREE.TextureLoader();
    const texture = this.loader.load(url, () => this.onChange());
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    // Las coordenadas de piso y paredes van en metros: una repetición cada `sizeM`.
    texture.repeat.set(1 / set.sizeM, 1 / set.sizeM);
    texture.colorSpace = map === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = 8;
    this.loaded.set(url, texture);
    return texture;
  }

  private draw(id: string, spec: FloorTextureSpec): THREE.Texture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return null;
    PAINTERS[spec.pattern](ctx, prng(seedOf(id)));
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1 / spec.tileM, 1 / spec.tileM);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }
}
