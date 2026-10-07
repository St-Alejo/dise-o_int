/** Mesas: rectangular (comedor/escritorio), redonda, de centro, auxiliar, mesa de noche y escritorio. */
import type { FurnitureRecipe, RecipeContext } from '../registry.js';
import { SLOTS } from './slots.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function rectTable(ctx: RecipeContext, topSlot: string, legSlot: string): void {
  const { w, h, d, b } = ctx;
  const t = clamp(h * 0.05, 0.02, 0.05);
  const style = ctx.str('legs', 'four');
  b.box(topSlot, w, t, d, [0, h - t, 0], 0.006);
  if (style === 'trestle') {
    // Caballetes: dos marcos en "A" unidos por un travesaño.
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - Math.min(0.25, w * 0.15));
      b.box(legSlot, 0.05, h - t, 0.05, [x, 0, 0]);
      b.box(legSlot, 0.06, 0.04, d * 0.8, [x, 0, 0]);
      b.box(legSlot, 0.06, 0.04, d * 0.8, [x, h - t - 0.04, 0]);
    }
    b.box(legSlot, w - 2 * Math.min(0.25, w * 0.15), 0.04, 0.04, [0, (h - t) * 0.35, 0]);
    return;
  }
  const leg = clamp(Math.min(w, d) * 0.06, 0.03, 0.07);
  const inset = clamp(Math.min(w, d) * 0.06, 0.03, 0.08);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box(legSlot, leg, h - t, leg, [sx * (w / 2 - inset), 0, sz * (d / 2 - inset)]);
  }
  // Faldón bajo la cubierta (rigidez visual).
  const apron = 0.06;
  for (const sz of [-1, 1]) b.box(legSlot, w - 2 * inset, apron, 0.02, [0, h - t - apron, sz * (d / 2 - inset)]);
}

export const table: FurnitureRecipe = {
  kind: 'table',
  label: 'Mesa rectangular',
  slots: [SLOTS.top, SLOTS.legs],
  defaultDims: { x: 1.6, y: 0.75, z: 0.9 },
  build: (ctx) => rectTable(ctx, SLOTS.top.slot, SLOTS.legs.slot),
};

/** Mesa redonda u ovalada con pie central torneado (o 3 patas si es pequeña). */
export const roundTable: FurnitureRecipe = {
  kind: 'table-round',
  label: 'Mesa redonda',
  slots: [SLOTS.top, SLOTS.legs],
  defaultDims: { x: 1.1, y: 0.75, z: 1.1 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const k = d / w;
    const t = clamp(h * 0.05, 0.02, 0.045);
    b.cylinder(SLOTS.top.slot, w / 2, w / 2, t, [0, h - t, 0], 40, k);
    if (ctx.str('legs', 'pedestal') === 'tripod') {
      for (const a of [0, 120, 240]) {
        const r = (a * Math.PI) / 180;
        b.cylinder(SLOTS.legs.slot, 0.018, 0.014, h - t, [Math.sin(r) * w * 0.32, 0, Math.cos(r) * w * 0.32 * k], 10);
      }
      return;
    }
    const baseR = Math.min(w, d) * 0.28;
    b.cylinder(SLOTS.legs.slot, baseR, baseR * 0.9, 0.03, [0, 0, 0], 28);
    b.lathe(SLOTS.legs.slot, [[0.05, 0.03], [0.035, (h - t) * 0.3], [0.04, (h - t) * 0.7], [0.06, h - t]], [0, 0, 0], 20);
  },
};

/** Mesa de centro con balda inferior opcional. */
export const coffeeTable: FurnitureRecipe = {
  kind: 'coffee-table',
  label: 'Mesa de centro',
  slots: [SLOTS.top, SLOTS.legs],
  defaultDims: { x: 1.1, y: 0.42, z: 0.6 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const t = 0.03;
    const leg = 0.035;
    b.box(SLOTS.top.slot, w, t, d, [0, h - t, 0], 0.008);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.box(SLOTS.legs.slot, leg, h - t, leg, [sx * (w / 2 - leg / 2 - 0.02), 0, sz * (d / 2 - leg / 2 - 0.02)]);
    }
    if (ctx.bool('shelf', true)) b.box(SLOTS.top.slot, w - 0.08, 0.02, d - 0.08, [0, h * 0.25, 0]);
  },
};

/** Mesa de noche: cuerpo con cajón y patas cortas. */
export const nightstand: FurnitureRecipe = {
  kind: 'nightstand',
  label: 'Mesa de noche',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.legs],
  defaultDims: { x: 0.48, y: 0.55, z: 0.4 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const legH = clamp(h * 0.18, 0.05, 0.14);
    const front = 0.018;
    const handle = 0.012;
    const bodyD = d - front - handle;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.cylinder(SLOTS.legs.slot, 0.016, 0.012, legH, [sx * (w / 2 - 0.04), 0, -d / 2 + bodyD / 2 + sz * (bodyD / 2 - 0.04)], 10);
    }
    b.box(SLOTS.body.slot, w, h - legH, bodyD, [0, legH, -d / 2 + bodyD / 2], 0.004);
    const drawers = h - legH > 0.45 ? 2 : 1;
    const dh = (h - legH - 0.03) / drawers;
    for (let i = 0; i < drawers; i++) {
      const y = legH + 0.015 + i * dh;
      b.box(SLOTS.fronts.slot, w - 0.03, dh - 0.01, front, [0, y, -d / 2 + bodyD + front / 2]);
      b.box(SLOTS.handles.slot, Math.min(0.12, w * 0.3), 0.012, handle, [0, y + dh * 0.6, d / 2 - handle / 2]);
    }
  },
};

/** Escritorio: tablero, pata lateral de panel y cajonera a un lado. */
export const desk: FurnitureRecipe = {
  kind: 'desk',
  label: 'Escritorio',
  slots: [SLOTS.top, SLOTS.legs, SLOTS.fronts],
  defaultDims: { x: 1.3, y: 0.75, z: 0.65 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const t = 0.03;
    b.box(SLOTS.top.slot, w, t, d, [0, h - t, 0], 0.004);
    if (ctx.str('legs', 'panel') === 'metal') {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) b.box(SLOTS.legs.slot, 0.04, h - t, 0.04, [sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)]);
      }
      return;
    }
    b.box(SLOTS.legs.slot, 0.025, h - t, d - 0.02, [-w / 2 + 0.0125, 0, 0]);
    const cw = Math.min(0.42, w * 0.33);
    b.box(SLOTS.legs.slot, cw, h - t, d - 0.04, [w / 2 - cw / 2, 0, -0.02]);
    const n = 3;
    const dh = (h - t - 0.06) / n;
    for (let i = 0; i < n; i++) b.box(SLOTS.fronts.slot, cw - 0.02, dh - 0.01, 0.02, [w / 2 - cw / 2, 0.04 + i * dh, d / 2 - 0.03]);
  },
};

export const TABLES = [table, roundTable, coffeeTable, nightstand, desk];
