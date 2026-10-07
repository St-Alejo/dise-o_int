/** Pared, iluminación, textiles y decoración. Los objetos de pared tienen su cara trasera en z = −d/2. */
import type { FurnitureRecipe } from '../registry.js';
import { SLOTS } from './slots.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ----------------------------------------------------------------------------- pared
export const mirror: FurnitureRecipe = {
  kind: 'mirror',
  label: 'Espejo',
  slots: [SLOTS.frame, SLOTS.glass],
  defaultDims: { x: 0.7, y: 0.9, z: 0.03 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    if (ctx.str('shape', 'rect') === 'round') {
      b.disc(SLOTS.frame.slot, w / 2, d * 0.7, [0, h / 2, -d / 2], 48, h / w);
      b.disc(SLOTS.glass.slot, w / 2 - 0.03, d, [0, h / 2, -d / 2], 48, (h - 0.06) / (w - 0.06));
      return;
    }
    const f = clamp(Math.min(w, h) * 0.05, 0.015, 0.05);
    b.box(SLOTS.frame.slot, w, f, d, [0, 0, 0]);
    b.box(SLOTS.frame.slot, w, f, d, [0, h - f, 0]);
    for (const sx of [-1, 1]) b.box(SLOTS.frame.slot, f, h - 2 * f, d, [sx * (w / 2 - f / 2), f, 0]);
    b.box(SLOTS.glass.slot, w - 2 * f, h - 2 * f, d * 0.6, [0, f, -d / 2 + d * 0.3]);
  },
};

export const wallArt: FurnitureRecipe = {
  kind: 'wall-art',
  label: 'Cuadro',
  slots: [SLOTS.frame, SLOTS.canvas],
  defaultDims: { x: 0.8, y: 0.6, z: 0.03 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const f = clamp(Math.min(w, h) * 0.04, 0.012, 0.04);
    b.box(SLOTS.frame.slot, w, f, d, [0, 0, 0]);
    b.box(SLOTS.frame.slot, w, f, d, [0, h - f, 0]);
    for (const sx of [-1, 1]) b.box(SLOTS.frame.slot, f, h - 2 * f, d, [sx * (w / 2 - f / 2), f, 0]);
    b.box(SLOTS.canvas.slot, w - 2 * f, h - 2 * f, d * 0.6, [0, f, -d / 2 + d * 0.3]);
  },
};

export const wallShelf: FurnitureRecipe = {
  kind: 'wall-shelf',
  label: 'Repisa',
  slots: [SLOTS.body, SLOTS.metal],
  defaultDims: { x: 0.8, y: 0.2, z: 0.22 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const t = 0.025;
    b.box(SLOTS.body.slot, w, t, d, [0, h - t, 0], 0.003);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - Math.min(0.12, w * 0.15));
      b.box(SLOTS.metal.slot, 0.02, h - t, 0.008, [x, 0, -d / 2 + 0.004]);
      b.box(SLOTS.metal.slot, 0.02, 0.008, d * 0.8, [x, h - t - 0.008, -d / 2 + d * 0.4]);
    }
  },
};

export const tv: FurnitureRecipe = {
  kind: 'tv',
  label: 'Televisor',
  slots: [SLOTS.base, SLOTS.screen],
  defaultDims: { x: 1.23, y: 0.71, z: 0.06 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const stand = ctx.bool('stand', false);
    const panelY = stand ? Math.min(0.1, h * 0.15) : 0;
    const panelD = stand ? Math.min(0.06, d) : d;
    if (stand) {
      b.box(SLOTS.base.slot, w * 0.35, 0.015, d, [0, 0, 0], 0.004);
      b.box(SLOTS.base.slot, 0.06, panelY, 0.03, [0, 0, 0]);
    }
    b.box(SLOTS.base.slot, w, h - panelY, panelD - 0.004, [0, panelY, -panelD / 2 + (panelD - 0.004) / 2], 0.006);
    b.box(SLOTS.screen.slot, w - 0.02, h - panelY - 0.02, 0.004, [0, panelY + 0.01, panelD / 2 - 0.002]);
  },
};

export const curtains: FurnitureRecipe = {
  kind: 'curtains',
  label: 'Cortinas',
  slots: [SLOTS.textile, SLOTS.metal],
  defaultDims: { x: 2.2, y: 2.4, z: 0.12 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const rod = 0.025;
    b.box(SLOTS.metal.slot, w, rod, rod, [0, h - rod, 0]);
    const open = clamp(ctx.num('open', 0.35), 0, 0.9);
    const pw = (w / 2) * (1 - open * 0.6);
    const folds = Math.max(2, Math.round(pw / 0.12));
    for (const sx of [-1, 1]) b.wavyPanel(SLOTS.textile.slot, pw, h - rod - 0.01, d, folds, [sx * (w / 2 - pw / 2), 0, 0]);
  },
};

export const sconce: FurnitureRecipe = {
  kind: 'sconce',
  label: 'Aplique de pared',
  slots: [SLOTS.base, SLOTS.shade],
  defaultDims: { x: 0.2, y: 0.3, z: 0.22 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const r = w / 2;
    const k = Math.min(1, (d - 0.04) / (2 * r));
    b.box(SLOTS.base.slot, Math.min(0.09, w), h * 0.55, 0.02, [0, 0, -d / 2 + 0.01], 0.004);
    b.box(SLOTS.base.slot, 0.015, 0.015, d - r * k, [0, h * 0.35, -d / 2 + (d - r * k) / 2]);
    b.lathe(SLOTS.shade.slot, [[r, h * 0.4], [r * 0.6, h]], [0, 0, d / 2 - r * k], 28, k);
  },
};

// ----------------------------------------------------------------------------- iluminación
export const tableLamp: FurnitureRecipe = {
  kind: 'table-lamp',
  label: 'Lámpara de mesa',
  slots: [SLOTS.base, SLOTS.shade],
  defaultDims: { x: 0.32, y: 0.52, z: 0.32 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const k = d / w;
    const br = w * 0.28;
    const style = ctx.str('base', 'urn');
    if (style === 'urn') {
      b.lathe(SLOTS.base.slot, [[0, 0], [br * 0.7, 0], [br, h * 0.15], [br * 0.9, h * 0.35], [br * 0.3, h * 0.45], [0.012, h * 0.47]], [0, 0, 0], 24, k);
    } else {
      b.cylinder(SLOTS.base.slot, br, br, 0.02, [0, 0, 0], 24, k);
    }
    b.cylinder(SLOTS.base.slot, 0.008, 0.008, h * 0.62, [0, 0.01, 0], 8);
    b.lathe(SLOTS.shade.slot, [[w / 2, h * 0.58], [w * 0.36, h]], [0, 0, 0], 32, k);
  },
};

export const floorLamp: FurnitureRecipe = {
  kind: 'floor-lamp',
  label: 'Lámpara de pie',
  slots: [SLOTS.base, SLOTS.shade],
  defaultDims: { x: 0.45, y: 1.6, z: 0.45 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const k = d / w;
    b.cylinder(SLOTS.base.slot, w * 0.32, w * 0.3, 0.025, [0, 0, 0], 28, k);
    b.cylinder(SLOTS.base.slot, 0.012, 0.012, h * 0.82, [0, 0.025, 0], 10);
    b.lathe(SLOTS.shade.slot, [[w / 2, h * 0.78], [w * 0.4, h]], [0, 0, 0], 32, k);
  },
};

export const pendant: FurnitureRecipe = {
  kind: 'pendant',
  label: 'Lámpara colgante',
  slots: [SLOTS.shade, SLOTS.base],
  defaultDims: { x: 0.45, y: 0.9, z: 0.45 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const k = d / w;
    const shadeH = Math.min(h * 0.4, w * 0.6);
    const style = ctx.str('shade', 'dome');
    const profile: [number, number][] =
      style === 'drum'
        ? [[w / 2, 0], [w / 2, shadeH], [0.03, shadeH]]
        : [[w / 2, 0], [w * 0.45, shadeH * 0.4], [w * 0.3, shadeH * 0.8], [0.03, shadeH]];
    b.lathe(SLOTS.shade.slot, profile, [0, 0, 0], 36, k);
    b.cylinder(SLOTS.base.slot, 0.004, 0.004, h - shadeH - 0.02, [0, shadeH, 0], 6);
    b.cylinder(SLOTS.base.slot, 0.06, 0.06, 0.02, [0, h - 0.02, 0], 20);
  },
};

export const deskLamp: FurnitureRecipe = {
  kind: 'desk-lamp',
  label: 'Lámpara de escritorio',
  slots: [SLOTS.base, SLOTS.shade],
  defaultDims: { x: 0.18, y: 0.45, z: 0.4 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const baseHalfZ = Math.min(w / 2, d * 0.3);
    const zBase = -d / 2 + baseHalfZ;
    b.cylinder(SLOTS.base.slot, w / 2, w / 2, 0.02, [0, 0, zBase], 24, baseHalfZ / (w / 2));
    b.cylinder(SLOTS.base.slot, 0.008, 0.008, h - 0.04, [0, 0.02, zBase], 8);
    const shadeR = Math.min(w / 2, d * 0.18);
    const armLen = d / 2 - shadeR - zBase;
    b.box(SLOTS.base.slot, 0.016, 0.04, armLen, [0, h - 0.04, zBase + armLen / 2]);
    b.lathe(SLOTS.shade.slot, [[shadeR, h - 0.16], [shadeR * 0.35, h - 0.04]], [0, 0, d / 2 - shadeR], 24);
  },
};

// ----------------------------------------------------------------------------- textiles
export const rug: FurnitureRecipe = {
  kind: 'rug',
  label: 'Alfombra',
  slots: [SLOTS.textile],
  defaultDims: { x: 2.0, y: 0.012, z: 1.4 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    if (ctx.str('shape', 'rect') === 'round') b.cylinder(SLOTS.textile.slot, w / 2, w / 2, h, [0, 0, 0], 48, d / w);
    else b.box(SLOTS.textile.slot, w, h, d, [0, 0, 0], Math.min(h / 2, 0.005));
  },
};

export const cushion: FurnitureRecipe = {
  kind: 'cushion',
  label: 'Cojín',
  slots: [SLOTS.textile],
  defaultDims: { x: 0.45, y: 0.45, z: 0.14 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    b.box(SLOTS.textile.slot, w, h, d, [0, 0, 0], Math.min(w, h, d) * 0.45);
  },
};

// ----------------------------------------------------------------------------- decoración
export const plant: FurnitureRecipe = {
  kind: 'plant',
  label: 'Planta',
  slots: [SLOTS.pot, SLOTS.foliage],
  defaultDims: { x: 0.6, y: 1.2, z: 0.6 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const potR = Math.min(w, d) * 0.3;
    const potH = h * 0.28;
    b.lathe(SLOTS.pot.slot, [[0, 0], [potR * 0.75, 0], [potR, potH], [potR * 0.92, potH], [0, potH * 0.9]], [0, 0, 0], 24);
    const fy = potH * 0.8;
    b.sphere(SLOTS.foliage.slot, w / 2, (h - fy) / 2, d / 2, [0, fy, 0], 14);
    for (const [x, z, s] of [[0.2, 0.15, 0.55], [-0.22, -0.1, 0.5], [0.05, -0.25, 0.45]] as const) {
      b.sphere(SLOTS.foliage.slot, (w / 2) * s, ((h - fy) / 2) * s, (d / 2) * s, [x * w * 0.5, fy + (h - fy) * 0.3, z * d * 0.5], 10);
    }
  },
};

export const vase: FurnitureRecipe = {
  kind: 'vase',
  label: 'Jarrón',
  slots: [SLOTS.ceramic],
  defaultDims: { x: 0.18, y: 0.32, z: 0.18 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const r = w / 2;
    b.lathe(SLOTS.ceramic.slot, [[0, 0], [r * 0.6, 0], [r, h * 0.35], [r * 0.85, h * 0.65], [r * 0.4, h * 0.85], [r * 0.5, h], [r * 0.4, h]], [0, 0, 0], 32, d / w);
  },
};

export const books: FurnitureRecipe = {
  kind: 'books',
  label: 'Pila de libros',
  slots: [SLOTS.canvas, SLOTS.textile],
  defaultDims: { x: 0.28, y: 0.12, z: 0.2 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const n = clamp(Math.round(h / 0.035), 2, 6);
    const t = h / n;
    for (let i = 0; i < n; i++) {
      const s = i === 0 ? 1 : 0.82 + ((i * 37) % 13) / 100;
      b.box(i % 2 === 0 ? SLOTS.canvas.slot : SLOTS.textile.slot, w * s, t * 0.98, d * s, [((i % 3) - 1) * w * 0.03 * (i === 0 ? 0 : 1), i * t, 0], 0.002);
    }
  },
};

export const clock: FurnitureRecipe = {
  kind: 'clock',
  label: 'Reloj de pared',
  slots: [SLOTS.frame, SLOTS.base],
  defaultDims: { x: 0.35, y: 0.35, z: 0.05 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    b.disc(SLOTS.frame.slot, w / 2, d * 0.7, [0, h / 2, -d / 2], 48, h / w);
    const z = -d / 2 + d * 0.7;
    // Agujas sobre la esfera (llegan justo al frente: z = d/2).
    b.box(SLOTS.base.slot, 0.01, h * 0.32, d * 0.3, [0, h / 2, z + d * 0.15]);
    b.box(SLOTS.base.slot, w * 0.22, 0.01, d * 0.3, [w * 0.11, h / 2, z + d * 0.15]);
  },
};

export const WALL_LIGHT_DECOR = [
  mirror,
  wallArt,
  wallShelf,
  tv,
  curtains,
  sconce,
  tableLamp,
  floorLamp,
  pendant,
  deskLamp,
  rug,
  cushion,
  plant,
  vase,
  books,
  clock,
];
