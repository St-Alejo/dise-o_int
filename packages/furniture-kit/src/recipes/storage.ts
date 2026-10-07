/** Cama y almacenaje: cama con cabecero, armario, estantería, mueble TV, aparador y cómoda. */
import type { FurnitureRecipe, RecipeContext } from '../registry.js';
import { SLOTS } from './slots.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const bed: FurnitureRecipe = {
  kind: 'bed',
  label: 'Cama',
  slots: [SLOTS.bedFrame, SLOTS.headboard, SLOTS.bedding],
  defaultDims: { x: 1.6, y: 1.05, z: 2.1 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const headT = 0.08;
    const legH = 0.08;
    const frameH = 0.22;
    const mattressH = 0.22;
    const frameTop = legH + frameH;
    b.box(SLOTS.bedFrame.slot, w, frameH, d - headT, [0, legH, headT / 2], 0.01);
    for (const sx of [-1, 1]) {
      for (const z of [-d / 2 + headT + 0.05, d / 2 - 0.05]) b.box(SLOTS.bedFrame.slot, 0.05, legH, 0.05, [sx * (w / 2 - 0.05), 0, z]);
    }
    const style = ctx.str('headboard', 'upholstered');
    b.box(SLOTS.headboard.slot, w, h, headT, [0, 0, -d / 2 + headT / 2], style === 'upholstered' ? 0.03 : 0.004);
    const mw = w - 0.06;
    const md = d - headT - 0.04;
    b.box(SLOTS.bedding.slot, mw, mattressH, md, [0, frameTop, -d / 2 + headT + md / 2 + 0.01], 0.05);
    const pillows = w > 1.2 ? 2 : 1;
    const pw = (mw - 0.1) / pillows;
    for (let i = 0; i < pillows; i++) {
      const x = -mw / 2 + 0.05 + pw / 2 + i * pw;
      b.box(SLOTS.bedding.slot, pw - 0.04, 0.12, 0.38, [x, frameTop + mattressH, -d / 2 + headT + 0.25], 0.05);
    }
    // Manta en los pies.
    b.box(SLOTS.bedding.slot, mw + 0.02, 0.04, md * 0.35, [0, frameTop + mattressH - 0.01, d / 2 - md * 0.35 / 2 - 0.03], 0.02);
  },
};

/** Puertas o cajones repartidos en el frente de un mueble de cuerpo `bodyD`. */
function frontGrid(ctx: RecipeContext, opts: { cols: number; rows: number; y0: number; y1: number; bodyD: number; vertical: boolean }): void {
  const { w, d, b } = ctx;
  const front = 0.018;
  const handle = 0.01;
  const gap = 0.004;
  const cw = (w - 0.02) / opts.cols;
  const rh = (opts.y1 - opts.y0) / opts.rows;
  for (let c = 0; c < opts.cols; c++) {
    for (let r = 0; r < opts.rows; r++) {
      const x = -w / 2 + 0.01 + cw / 2 + c * cw;
      const y = opts.y0 + r * rh;
      b.box(SLOTS.fronts.slot, cw - gap, rh - gap, front, [x, y + gap / 2, -d / 2 + opts.bodyD + front / 2]);
      if (opts.vertical) {
        const hx = x + (c % 2 === 0 ? 1 : -1) * (cw / 2 - 0.05);
        b.box(SLOTS.handles.slot, 0.015, Math.min(0.3, rh * 0.25), handle, [opts.cols === 1 ? x + cw / 2 - 0.05 : hx, y + rh * 0.45, d / 2 - handle / 2]);
      } else {
        b.box(SLOTS.handles.slot, Math.min(0.16, cw * 0.4), 0.014, handle, [x, y + rh * 0.55, d / 2 - handle / 2]);
      }
    }
  }
}

export const wardrobe: FurnitureRecipe = {
  kind: 'wardrobe',
  label: 'Armario',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles],
  defaultDims: { x: 1.5, y: 2.1, z: 0.6 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const plinth = 0.06;
    const bodyD = d - 0.028;
    b.box(SLOTS.body.slot, w, h, bodyD, [0, 0, -d / 2 + bodyD / 2]);
    const doors = clamp(Math.round(w / 0.5), 1, 6);
    const drawers = ctx.bool('drawers', w >= 1.2);
    const y0 = drawers ? plinth + 0.36 : plinth;
    frontGrid(ctx, { cols: doors, rows: 1, y0, y1: h - 0.02, bodyD, vertical: true });
    if (drawers) frontGrid(ctx, { cols: 2, rows: 2, y0: plinth, y1: plinth + 0.36, bodyD, vertical: false });
  },
};

/** Estantería abierta: laterales, fondo y N baldas según la altura. */
export const bookshelf: FurnitureRecipe = {
  kind: 'bookshelf',
  label: 'Estantería',
  slots: [SLOTS.body],
  defaultDims: { x: 0.9, y: 1.8, z: 0.35 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const t = 0.022;
    for (const sx of [-1, 1]) b.box(SLOTS.body.slot, t, h, d, [sx * (w / 2 - t / 2), 0, 0]);
    b.box(SLOTS.body.slot, w - 2 * t, h, 0.008, [0, 0, -d / 2 + 0.004]);
    const shelves = clamp(Math.round(h / 0.36), 2, 8);
    for (let i = 0; i <= shelves; i++) {
      const y = i === shelves ? h - t : (i * (h - t)) / shelves;
      b.box(SLOTS.body.slot, w - 2 * t, t, d - 0.008, [0, y, 0.004]);
    }
  },
};

/** Mueble bajo con puertas o cajones sobre patas (TV, aparador, cómoda). */
function lowCabinet(ctx: RecipeContext, mode: 'doors' | 'drawers' | 'mixed'): void {
  const { w, h, d, b } = ctx;
  const legH = clamp(h * 0.15, 0.06, 0.16);
  const bodyD = d - 0.028;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.cylinder(SLOTS.legs.slot, 0.018, 0.012, legH, [sx * (w / 2 - 0.06), 0, -d / 2 + bodyD / 2 + sz * (bodyD / 2 - 0.05)], 10);
  }
  b.box(SLOTS.body.slot, w, h - legH, bodyD, [0, legH, -d / 2 + bodyD / 2], 0.004);
  const y0 = legH + 0.015;
  const y1 = h - 0.015;
  if (mode === 'drawers') {
    frontGrid(ctx, { cols: w > 1.1 ? 2 : 1, rows: clamp(Math.round((h - legH) / 0.22), 2, 5), y0, y1, bodyD, vertical: false });
  } else if (mode === 'doors') {
    frontGrid(ctx, { cols: clamp(Math.round(w / 0.55), 2, 4), rows: 1, y0, y1, bodyD, vertical: true });
  } else {
    // TV: hueco abierto en el centro y puertas a los lados.
    const side = Math.min(0.45, w * 0.3);
    for (const sx of [-1, 1]) {
      b.box(SLOTS.fronts.slot, side - 0.01, y1 - y0, 0.018, [sx * (w / 2 - side / 2 - 0.005), y0, -d / 2 + bodyD + 0.009]);
      b.box(SLOTS.handles.slot, 0.12, 0.012, 0.01, [sx * (w / 2 - side / 2), y0 + (y1 - y0) * 0.6, d / 2 - 0.005]);
    }
  }
}

export const tvStand: FurnitureRecipe = {
  kind: 'tv-stand',
  label: 'Mueble TV',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.legs],
  defaultDims: { x: 1.6, y: 0.5, z: 0.42 },
  build: (ctx) => lowCabinet(ctx, 'mixed'),
};

export const sideboard: FurnitureRecipe = {
  kind: 'sideboard',
  label: 'Aparador',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.legs],
  defaultDims: { x: 1.6, y: 0.8, z: 0.45 },
  build: (ctx) => lowCabinet(ctx, 'doors'),
};

export const dresser: FurnitureRecipe = {
  kind: 'dresser',
  label: 'Cómoda',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.legs],
  defaultDims: { x: 1.2, y: 0.85, z: 0.48 },
  build: (ctx) => lowCabinet(ctx, 'drawers'),
};

export const STORAGE = [bed, wardrobe, bookshelf, tvStand, sideboard, dresser];
