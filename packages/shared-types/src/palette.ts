/**
 * Paletas de color para "Recomendar": a partir de uno o más colores ancla (lo que la persona fijó,
 * o la paleta del estilo) se arma una armonía con los papeles de un cuarto: pared, acento, piso,
 * textil y detalle. Funciones puras y deterministas con la semilla.
 */

export const HARMONIES = ['analoga', 'complementaria', 'triadica', 'monocroma'] as const;
export type Harmony = (typeof HARMONIES)[number];

export interface Palette {
  harmony: Harmony;
  /** Pared (claro y apagado), acento, piso, textil y detalle, en ese orden. */
  colors: [string, string, string, string, string];
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function hexToHsl(hex: string): Hsl {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue: number;
  if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { h: (hue * 60) % 360, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = clamp(s);
  const lig = clamp(l);
  const f = (t: number) => {
    const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
    const p = 2 * lig - q;
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const toHex = (v: number) =>
    Math.round(clamp(v) * 255)
      .toString(16)
      .padStart(2, '0');
  if (sat === 0) return `#${toHex(lig)}${toHex(lig)}${toHex(lig)}`;
  return `#${toHex(f(hue + 1 / 3))}${toHex(f(hue))}${toHex(f(hue - 1 / 3))}`;
}

/** Generador determinista (mulberry32): misma semilla, misma paleta. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tonos de la armonía a partir del tono ancla. */
function hues(base: number, harmony: Harmony): [number, number, number] {
  switch (harmony) {
    case 'analoga':
      return [base, base + 30, base - 30];
    case 'complementaria':
      return [base, base + 180, base + 20];
    case 'triadica':
      return [base, base + 120, base + 240];
    case 'monocroma':
      return [base, base, base];
  }
}

/**
 * Arma la paleta. `anchors` manda: el primero que tenga color de verdad fija el tono; si la
 * persona fijó varios (azul claro y verde), el segundo pasa a ser el acento.
 */
export function harmonize(anchors: readonly string[], harmony: Harmony, rand: () => number = Math.random): Palette {
  const parsed = anchors.map(hexToHsl);
  const chromatic = parsed.filter((c) => c.s > 0.12);
  const base = chromatic[0] ?? parsed[0] ?? { h: rand() * 360, s: 0.3, l: 0.6 };
  const [h0, h1, h2] = hues(base.h, harmony);
  const jitter = () => (rand() - 0.5) * 12;
  const sat = Math.max(0.15, base.s);
  // Pared: muy clara y apagada; sobre ella todo se lee bien.
  const wall = hslToHex({ h: h0 + jitter(), s: Math.min(0.22, sat * 0.4), l: 0.88 + rand() * 0.06 });
  const accent = chromatic[1] ? anchors[parsed.indexOf(chromatic[1])]! : hslToHex({ h: h1 + jitter(), s: clamp(sat * 0.9, 0.25, 0.6), l: 0.38 + rand() * 0.15 });
  // Piso: tonos naturales (madera, piedra), del lado cálido salvo que la paleta sea fría.
  const warm = h0 < 70 || h0 > 300;
  const floor = hslToHex({ h: warm ? 30 + jitter() : 35 + jitter() * 2, s: 0.18 + rand() * 0.2, l: 0.45 + rand() * 0.25 });
  const textile = hslToHex({ h: h2 + jitter(), s: clamp(sat * 0.7, 0.15, 0.5), l: 0.55 + rand() * 0.15 });
  const detail = hslToHex({ h: h1 + jitter(), s: clamp(sat, 0.3, 0.75), l: 0.3 + rand() * 0.15 });
  return { harmony, colors: [wall, accent, floor, textile, detail] };
}

/** Rasgos de una paleta para comparar propuestas (y para el modelo de preferencias). */
export function paletteFeatures(colors: readonly string[]): { warmth: number; lightness: number; contrast: number; saturation: number } {
  const hsl = colors.map(hexToHsl);
  const n = hsl.length || 1;
  const warmth = hsl.reduce((s, c) => s + (c.s < 0.08 ? 0.5 : c.h < 70 || c.h > 300 ? 1 : 0), 0) / n;
  const ls = hsl.map((c) => c.l);
  return {
    warmth,
    lightness: ls.reduce((a, b) => a + b, 0) / n,
    contrast: ls.length ? Math.max(...ls) - Math.min(...ls) : 0,
    saturation: hsl.reduce((s, c) => s + c.s, 0) / n,
  };
}
