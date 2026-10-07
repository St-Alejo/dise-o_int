/** Cocina y baño: módulos bajo y alto, isla, nevera, estufa, fregadero, inodoro, lavamanos, bañera y ducha. */
import type { FurnitureRecipe, RecipeContext } from '../registry.js';
import { SLOTS } from './slots.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Carcasa con zócalo retranqueado y puertas; devuelve la y donde termina el mueble. */
function cabinet(ctx: RecipeContext, top: number, opts: { plinth: number; doors?: number; countertop: boolean }): void {
  const { w, d, b } = ctx;
  const counterT = opts.countertop ? 0.035 : 0;
  const bodyTop = top - counterT;
  const front = 0.018;
  const handle = 0.012;
  const bodyD = d - (opts.countertop ? 0.03 : front + handle);
  const z0 = -d / 2 + bodyD / 2;
  if (opts.plinth > 0) b.box(SLOTS.body.slot, w - 0.04, opts.plinth, bodyD - 0.06, [0, 0, z0 - 0.03]);
  b.box(SLOTS.body.slot, w, bodyTop - opts.plinth, bodyD, [0, opts.plinth, z0]);
  const doors = opts.doors ?? clamp(Math.round(w / 0.5), 1, 4);
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + dw / 2 + i * dw;
    b.box(SLOTS.fronts.slot, dw - 0.004, bodyTop - opts.plinth - 0.006, front, [x, opts.plinth + 0.003, -d / 2 + bodyD + front / 2]);
    b.box(SLOTS.handles.slot, Math.min(0.14, dw * 0.4), 0.012, handle, [x, bodyTop - 0.08, -d / 2 + bodyD + front + handle / 2]);
  }
  if (opts.countertop) b.box(SLOTS.countertop.slot, w, counterT, d, [0, bodyTop, 0], 0.003);
}

export const kitchenBase: FurnitureRecipe = {
  kind: 'kitchen-base',
  label: 'Mueble bajo de cocina',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.countertop],
  defaultDims: { x: 1.2, y: 0.9, z: 0.6 },
  build: (ctx) => cabinet(ctx, ctx.h, { plinth: 0.1, countertop: true }),
};

export const kitchenWall: FurnitureRecipe = {
  kind: 'kitchen-wall',
  label: 'Alacena de pared',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles],
  defaultDims: { x: 1.2, y: 0.7, z: 0.35 },
  build: (ctx) => cabinet(ctx, ctx.h, { plinth: 0, countertop: false }),
};

export const kitchenIsland: FurnitureRecipe = {
  kind: 'kitchen-island',
  label: 'Isla de cocina',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.countertop],
  defaultDims: { x: 1.8, y: 0.92, z: 0.95 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const t = 0.04;
    const over = Math.min(0.3, d * 0.3); // voladizo para taburetes
    const front = 0.018;
    const bodyD = d - over - front;
    // Cuerpo detrás de las puertas (que dan al lado de la cocina, −Z); el voladizo queda en +Z.
    b.box(SLOTS.body.slot, w - 0.04, h - t, bodyD, [0, 0, -d / 2 + front + bodyD / 2]);
    const doors = clamp(Math.round(w / 0.55), 2, 4);
    const dw = (w - 0.04) / doors;
    for (let i = 0; i < doors; i++) {
      b.box(SLOTS.fronts.slot, dw - 0.004, h - t - 0.12, front, [-w / 2 + 0.02 + dw / 2 + i * dw, 0.1, -d / 2 + front / 2]);
    }
    b.box(SLOTS.countertop.slot, w, t, d, [0, h - t, 0], 0.004);
  },
};

export const fridge: FurnitureRecipe = {
  kind: 'fridge',
  label: 'Nevera',
  slots: [SLOTS.appliance, SLOTS.handles],
  defaultDims: { x: 0.7, y: 1.85, z: 0.68 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const handle = 0.035;
    const bodyD = d - handle;
    b.box(SLOTS.appliance.slot, w, h, bodyD, [0, 0, -d / 2 + bodyD / 2], 0.02);
    const split = h * 0.62;
    b.box(SLOTS.handles.slot, w - 0.02, 0.006, 0.004, [0, split, -d / 2 + bodyD]);
    for (const [y, len] of [[split + 0.1, Math.min(0.4, (h - split) * 0.6)], [split - 0.1 - Math.min(0.6, split * 0.5), Math.min(0.6, split * 0.5)]] as const) {
      b.box(SLOTS.handles.slot, 0.02, len, handle, [w / 2 - 0.06, y, d / 2 - handle / 2], 0.006);
    }
  },
};

export const stove: FurnitureRecipe = {
  kind: 'stove',
  label: 'Estufa con horno',
  slots: [SLOTS.appliance, SLOTS.glass, SLOTS.handles],
  defaultDims: { x: 0.6, y: 0.9, z: 0.6 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const handle = 0.03;
    const bodyD = d - handle;
    b.box(SLOTS.appliance.slot, w, h - 0.02, bodyD, [0, 0, -d / 2 + bodyD / 2], 0.006);
    b.box(SLOTS.glass.slot, w, 0.02, bodyD, [0, h - 0.02, -d / 2 + bodyD / 2]);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.cylinder(SLOTS.handles.slot, Math.min(w, d) * 0.1, Math.min(w, d) * 0.1, 0.004, [sx * w * 0.22, h - 0.004, -d / 2 + bodyD / 2 + sz * bodyD * 0.22], 20);
    }
    b.box(SLOTS.glass.slot, w - 0.08, (h - 0.02) * 0.5, 0.006, [0, 0.12, -d / 2 + bodyD]);
    b.box(SLOTS.handles.slot, w - 0.14, 0.02, handle, [0, 0.12 + (h - 0.02) * 0.5 + 0.03, d / 2 - handle / 2], 0.008);
  },
};

export const sinkCabinet: FurnitureRecipe = {
  kind: 'sink-cabinet',
  label: 'Fregadero con mueble',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.countertop, SLOTS.metal],
  defaultDims: { x: 1.0, y: 1.15, z: 0.6 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const counterTop = Math.min(0.9, h - 0.2);
    cabinet(ctx, counterTop, { plinth: 0.1, doors: 2, countertop: true });
    b.box(SLOTS.metal.slot, Math.min(0.6, w * 0.6), 0.004, d * 0.6, [0, counterTop, 0.02]);
    // Grifo: columna y caño hasta el alto total.
    b.cylinder(SLOTS.metal.slot, 0.02, 0.016, h - counterTop, [0, counterTop, -d / 2 + 0.08], 14);
    b.box(SLOTS.metal.slot, 0.025, 0.025, 0.18, [0, h - 0.025, -d / 2 + 0.17]);
  },
};

export const toilet: FurnitureRecipe = {
  kind: 'toilet',
  label: 'Inodoro',
  slots: [SLOTS.ceramic],
  defaultDims: { x: 0.38, y: 0.78, z: 0.66 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const tankD = Math.min(0.2, d * 0.3);
    const tankH = Math.min(0.38, h * 0.48);
    b.box(SLOTS.ceramic.slot, w, tankH, tankD, [0, h - tankH, -d / 2 + tankD / 2], 0.02);
    const bowlD = d - tankD + 0.02;
    const bowlH = Math.min(0.42, h - tankH + 0.05);
    const r = w / 2;
    b.lathe(
      SLOTS.ceramic.slot,
      [[r * 0.55, 0], [r * 0.6, bowlH * 0.3], [r * 0.95, bowlH * 0.85], [r, bowlH], [r * 0.7, bowlH]],
      [0, 0, -d / 2 + tankD - 0.02 + bowlD / 2],
      28,
      bowlD / w,
    );
    // Columna que une tanque y taza.
    b.box(SLOTS.ceramic.slot, w * 0.5, h - tankH, tankD, [0, 0, -d / 2 + tankD / 2], 0.02);
  },
};

export const vanity: FurnitureRecipe = {
  kind: 'vanity',
  label: 'Lavamanos con mueble',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.ceramic, SLOTS.metal],
  defaultDims: { x: 0.8, y: 1.05, z: 0.48 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const basinTop = Math.min(0.88, h - 0.15);
    const basinH = 0.14;
    cabinet(ctx, basinTop - basinH, { plinth: 0.05, doors: w > 0.7 ? 2 : 1, countertop: false });
    b.box(SLOTS.ceramic.slot, w, basinH, d, [0, basinTop - basinH, 0], 0.03);
    b.cylinder(SLOTS.metal.slot, 0.018, 0.015, h - basinTop, [0, basinTop, -d / 2 + 0.06], 14);
    b.box(SLOTS.metal.slot, 0.02, 0.02, 0.12, [0, h - 0.02, -d / 2 + 0.12]);
  },
};

export const bathtub: FurnitureRecipe = {
  kind: 'bathtub',
  label: 'Bañera',
  slots: [SLOTS.ceramic, SLOTS.metal],
  defaultDims: { x: 1.7, y: 0.58, z: 0.75 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    b.box(SLOTS.ceramic.slot, w, h, d, [0, 0, 0], 0.06);
    // "Agua"/fondo interior sugerido con un rebaje oscuro.
    b.box(SLOTS.metal.slot, w - 0.16, 0.005, d - 0.16, [0, h - 0.004, 0]);
  },
};

export const shower: FurnitureRecipe = {
  kind: 'shower',
  label: 'Ducha',
  slots: [SLOTS.ceramic, SLOTS.glass, SLOTS.metal],
  defaultDims: { x: 0.9, y: 2.0, z: 0.9 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    b.box(SLOTS.ceramic.slot, w, 0.05, d, [0, 0, 0], 0.01);
    b.box(SLOTS.glass.slot, w, h - 0.05, 0.01, [0, 0.05, d / 2 - 0.005]);
    b.box(SLOTS.glass.slot, 0.01, h - 0.05, d - 0.01, [w / 2 - 0.005, 0.05, -0.005]);
    b.cylinder(SLOTS.metal.slot, 0.012, 0.012, h - 0.3, [-w / 2 + 0.05, 0.25, -d / 2 + 0.05], 10);
    b.cylinder(SLOTS.metal.slot, 0.1, 0.1, 0.015, [-w / 2 + 0.2, h - 0.3, -d / 2 + 0.2], 20);
  },
};

export const KITCHEN_BATH = [kitchenBase, kitchenWall, kitchenIsland, fridge, stove, sinkCabinet, toilet, vanity, bathtub, shower];
