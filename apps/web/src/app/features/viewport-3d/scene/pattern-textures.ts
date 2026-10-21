import type { FinishPattern, FinishSpec } from '@interiores/shared-types';
import * as THREE from 'three';

/**
 * Dibujo de un acabado descrito por la persona ("baldosa brillante azul claro con verde"): las
 * piezas con sus colores y las juntas, y un relieve que sale de la misma máscara (la junta queda
 * hundida). Todo en canvas: no hay nada que descargar y el dibujo calza con el tamaño pedido.
 */

/** Tamaño típico de pieza de cada dibujo cuando la persona no lo dice (metros). */
export const DEFAULT_PIECE_M: Record<FinishPattern, number> = {
  plain: 1,
  grid: 0.3,
  checker: 0.3,
  subway: 0.15,
  herringbone: 0.4,
  hex: 0.2,
  mosaic: 0.05,
  planks: 0.2,
};

/** Cuántas piezas entran por lado en una repetición de la textura. */
const PIECES_PER_TILE: Record<FinishPattern, number> = {
  plain: 1,
  grid: 4,
  checker: 4,
  subway: 4,
  herringbone: 4,
  hex: 6,
  mosaic: 16,
  planks: 6,
};

const SIZE = 1024;
/** Hileras de hexágonos por repetición (par, para que la alternancia calce en el borde). */
const HEX_ROWS = 8;
/** Alto/ancho en metros de una repetición de hexágonos: 8 hileras de 1.5 r contra 6 columnas de √3 r. */
const HEX_ASPECT = (HEX_ROWS * 1.5) / (6 * Math.sqrt(3));

export interface PatternPlan {
  pattern: FinishPattern;
  pieceM: number;
  /** Metros que cubre una repetición (a lo ancho). */
  tileM: number;
  /** Alto/ancho de la repetición: 1 salvo en los hexágonos. */
  aspect: number;
  piecesPerTile: number;
}

/** Decisión de escala, separada del dibujo para probarla sin canvas. */
export function patternPlan(spec: Pick<FinishSpec, 'pattern' | 'tileSizeM'>): PatternPlan {
  const pattern = spec.pattern ?? 'plain';
  const pieceM = spec.tileSizeM ?? DEFAULT_PIECE_M[pattern];
  const piecesPerTile = PIECES_PER_TILE[pattern];
  // En hexágonos la medida es el ancho de cada pieza (de lado plano a lado plano).
  return { pattern, pieceM, tileM: pieceM * piecesPerTile, aspect: pattern === 'hex' ? HEX_ASPECT : 1, piecesPerTile };
}

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 11);

/** Un color con una variación de tono leve: ninguna baldosa real sale idéntica a la de al lado. */
function jitter(hex: string, random: () => number, amount = 0.05): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + (random() - 0.5) * amount)));
  return `#${c.getHexString()}`;
}

interface Painter {
  /** Dibuja las piezas en `color` y su forma en `height` (blanco = pieza, negro = junta). */
  (color: CanvasRenderingContext2D, height: CanvasRenderingContext2D, pick: (i: number) => string, n: number, grout: number, random: () => number): void;
}

const rect = (ctx: CanvasRenderingContext2D, fill: string, x: number, y: number, w: number, h: number) => {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
};

/** Pieza rectangular con su junta, en los dos lienzos a la vez. Envuelve en los bordes para que repita sin costura. */
function piece(color: CanvasRenderingContext2D, height: CanvasRenderingContext2D, fill: string, x: number, y: number, w: number, h: number, grout: number) {
  for (const dx of [-SIZE, 0, SIZE]) {
    for (const dy of [-SIZE, 0, SIZE]) {
      const px = x + dx + grout / 2;
      const py = y + dy + grout / 2;
      if (px > SIZE || py > SIZE || px + w < 0 || py + h < 0) continue;
      rect(color, fill, px, py, w - grout, h - grout);
      rect(height, '#fff', px, py, w - grout, h - grout);
    }
  }
}

const PAINTERS: Record<FinishPattern, Painter> = {
  plain(color, height, pick) {
    rect(color, pick(0), 0, 0, SIZE, SIZE);
    rect(height, '#fff', 0, 0, SIZE, SIZE);
  },
  grid(color, height, pick, n, grout) {
    const s = SIZE / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) piece(color, height, pick(i * n + j), i * s, j * s, s, s, grout);
  },
  checker(color, height, pick, n, grout) {
    const s = SIZE / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) piece(color, height, pick((i + j) % 2), i * s, j * s, s, s, grout);
  },
  subway(color, height, pick, n, grout) {
    // Baldosa de metro: el doble de ancha que de alta (la medida es el largo), cada hilada
    // corrida media pieza.
    const w = SIZE / n;
    const h = w / 2;
    for (let r = 0; r < n * 2; r++) {
      const shift = r % 2 ? w / 2 : 0;
      for (let c = 0; c < n; c++) piece(color, height, pick(r * n + c), c * w + shift, r * h, w, h, grout);
    }
  },
  planks(color, height, pick, n, grout, random) {
    // Cada hilada se corta en 2 o 3 tablones en puntos al azar; el último da la vuelta al borde
    // hasta el primer corte, así la repetición no tiene costura.
    const h = SIZE / n;
    for (let r = 0; r < n; r++) {
      const count = 2 + Math.floor(random() * 2);
      const cuts = Array.from({ length: count }, (_, i) => ((i + random() * 0.6) / count) * SIZE).sort((p, q) => p - q);
      cuts.forEach((x, k) => {
        const next = k + 1 < count ? cuts[k + 1]! : cuts[0]! + SIZE;
        piece(color, height, pick(r * 7 + k), x, r * h, next - x, h, grout * 0.6);
      });
    }
  },
  herringbone(color, height, pick, n, grout) {
    // Espiga 2:1 en unidades u (tablilla = 2u × u). Cada par (horizontal + vertical) avanza en
    // escalera por (1, 1) y las bandas se corren (2, −2): así cubre el plano sin huecos. La
    // repetición mide 2n unidades por lado; k ∈ [0, 2n), m ∈ [0, n/2) son los pares de una vuelta.
    const u = SIZE / (n * 2);
    const wrap = (v: number) => ((v % SIZE) + SIZE) % SIZE;
    let i = 0;
    for (let k = 0; k < n * 2; k++) {
      for (let m = 0; m < n / 2; m++) {
        const x = wrap((k + 2 * m) * u);
        const y = wrap((k - 2 * m) * u);
        piece(color, height, pick(i++), x, y, u * 2, u, grout);
        piece(color, height, pick(i++), x, wrap(y + u), u, u * 2, grout);
      }
    }
  },
  hex(color, height, pick, n, grout) {
    // n columnas de hexágonos (punta arriba) y HEX_ROWS hileras: en vertical el lienzo cubre
    // HEX_ASPECT veces lo que cubre en horizontal, y la textura lo compensa al repetir.
    const w = SIZE / n;
    const r = w / Math.sqrt(3);
    const rowStep = SIZE / HEX_ROWS;
    const squash = rowStep / (1.5 * r);
    const draw = (ctx: CanvasRenderingContext2D, fill: string, cx: number, cy: number) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let a = 0; a < 6; a++) {
        const ang = (Math.PI / 3) * a + Math.PI / 6;
        const rr = r - grout / 2;
        ctx.lineTo(cx + rr * Math.cos(ang), cy + rr * Math.sin(ang) * squash);
      }
      ctx.closePath();
      ctx.fill();
    };
    for (let row = -1; row <= HEX_ROWS; row++) {
      for (let col = -1; col <= n; col++) {
        // La pieza de la hilera -1 es la misma que la de la última: mismo color, sin costura.
        const wrappedRow = (row + HEX_ROWS) % HEX_ROWS;
        const wrappedCol = (col + n) % n;
        const fill = pick(wrappedRow * n + wrappedCol);
        const cx = col * w + (wrappedRow % 2 ? w / 2 : 0);
        const cy = row * rowStep;
        draw(color, fill, cx, cy);
        draw(height, '#fff', cx, cy);
      }
    }
  },
  mosaic(color, height, pick, n, grout, random) {
    const s = SIZE / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) piece(color, height, pick(Math.floor(random() * 1000)), i * s, j * s, s, s, grout);
  },
};

/** Normal a partir de una altura en grises (Sobel). La junta, más baja, hace que la luz se quiebre en ella. */
export function heightToNormal(height: Uint8ClampedArray, size: number, strength = 2.5): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const h = (x: number, y: number) => height[(((y + size) % size) * size + ((x + size) % size)) * 4]! / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * strength;
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

export interface PatternMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  plan: PatternPlan;
}

function canvas2d(size: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** Dibuja el acabado: null si no hay canvas (pruebas o navegadores muy viejos). */
export function drawPattern(id: string, spec: FinishSpec): PatternMaps | null {
  const color = canvas2d(SIZE);
  const height = canvas2d(SIZE);
  if (!color || !height) return null;
  const plan = patternPlan(spec);
  const random = prng(seedOf(id) ^ 0x5bd1e995);
  const grout = plan.pattern === 'plain' ? 0 : Math.max(2, (SIZE / plan.piecesPerTile) * 0.035);
  rect(color, spec.groutColor ?? '#d9d6d0', 0, 0, SIZE, SIZE);
  rect(height, '#000', 0, 0, SIZE, SIZE);
  // El tono de cada pieza depende solo de su número: la pieza repetida en el borde sale igual.
  const seed = seedOf(id);
  const pick = (i: number) => jitter(spec.colors[Math.abs(i) % spec.colors.length]!, prng(seed + Math.abs(i) * 7919), spec.kind === 'paint' ? 0 : 0.06);
  PAINTERS[plan.pattern](color, height, pick, plan.piecesPerTile, grout, random);

  const normalCtx = canvas2d(SIZE)!;
  const normal = normalCtx.createImageData(SIZE, SIZE);
  normal.data.set(heightToNormal(height.getImageData(0, 0, SIZE, SIZE).data, SIZE));
  normalCtx.putImageData(normal, 0, 0);

  const texture = (ctx: CanvasRenderingContext2D, srgb: boolean) => {
    const t = new THREE.CanvasTexture(ctx.canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / plan.tileM, 1 / (plan.tileM * plan.aspect));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: texture(color, true), normalMap: texture(normalCtx, false), plan };
}
