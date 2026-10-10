import type { MaterialDefinition } from '@interiores/shared-types';
import * as THREE from 'three';

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
 * Texturas del piso generadas en el navegador (Flyweight: una por material, compartida). No hay
 * archivos que descargar: la CSP no permite CDN y así la app no pesa más.
 */
export class TextureLibrary {
  private readonly cache = new Map<string, THREE.Texture | null>();

  /** Textura del piso para ese material, o null si va liso o no hay canvas (pruebas). */
  floor(material: MaterialDefinition): THREE.Texture | null {
    if (this.cache.has(material.id)) return this.cache.get(material.id)!;
    const spec = floorTextureSpec(material);
    const texture = spec ? this.draw(material.id, spec) : null;
    this.cache.set(material.id, texture);
    return texture;
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture?.dispose();
    this.cache.clear();
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
    // Las coordenadas del piso van en metros: una repetición cada `tileM`.
    texture.repeat.set(1 / spec.tileM, 1 / spec.tileM);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }
}
