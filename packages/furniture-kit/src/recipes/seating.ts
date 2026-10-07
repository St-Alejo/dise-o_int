/** Asientos: sofá, sofá en L, butaca, puf, silla de comedor, taburete y silla de oficina. */
import type { FurnitureRecipe, RecipeContext } from '../registry.js';
import { SLOTS } from './slots.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Cuatro patas cilíndricas en las esquinas (retranqueadas `inset`). */
function cornerLegs(ctx: RecipeContext, slot: string, legH: number, w: number, d: number, inset: number, r: number, z0 = 0): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      ctx.b.cylinder(slot, r, r * 0.8, legH, [sx * (w / 2 - inset), 0, z0 + sz * (d / 2 - inset)], 12);
    }
  }
}

/**
 * Sofá tapizado: base, respaldo, brazos opcionales y cojines cuyo número depende del ancho
 * (≈ 1 por cada 75 cm). Con `seats` fijo se usa para la butaca.
 */
function buildSofa(ctx: RecipeContext, fixedSeats?: number): void {
  const { w, h, d, b } = ctx;
  const legs = ctx.str('legs', 'wood') !== 'none';
  const arms = ctx.bool('arms', true);
  const legH = legs ? clamp(h * 0.12, 0.05, 0.14) : 0;
  const baseH = clamp(h * 0.25, 0.14, 0.24);
  const arm = arms ? clamp(w * 0.08, 0.1, 0.2) : 0;
  const backD = clamp(d * 0.2, 0.12, 0.24);
  const seatTop = legH + baseH;
  const cushionH = clamp(h * 0.16, 0.08, 0.16);
  const armH = Math.min(h - legH, baseH + cushionH + 0.18);

  if (legs) cornerLegs(ctx, SLOTS.legs.slot, legH, w, d, 0.06, 0.022);
  b.box(SLOTS.upholstery.slot, w, baseH, d, [0, legH, 0], 0.02);
  // Respaldo hasta el alto total.
  b.box(SLOTS.upholstery.slot, w - 2 * arm, h - seatTop, backD, [0, seatTop, -d / 2 + backD / 2], 0.04);
  if (arms) {
    for (const sx of [-1, 1]) b.box(SLOTS.upholstery.slot, arm, armH, d, [sx * (w / 2 - arm / 2), legH, 0], 0.04);
  }
  const inner = w - 2 * arm;
  const seats = fixedSeats ?? clamp(Math.round(inner / 0.72), 1, 4);
  const gap = 0.01;
  const cw = (inner - gap * (seats - 1)) / seats;
  const seatD = d - backD - 0.01;
  for (let i = 0; i < seats; i++) {
    const x = -inner / 2 + cw / 2 + i * (cw + gap);
    b.box(SLOTS.upholstery.slot, cw, cushionH, seatD, [x, seatTop, d / 2 - seatD / 2], 0.04);
    // Cojín de respaldo apoyado en el respaldo.
    const backCushionH = Math.max(0.05, Math.min(0.45, h - seatTop - cushionH - 0.04));
    b.box(SLOTS.upholstery.slot, cw, backCushionH, 0.14, [x, seatTop + cushionH, -d / 2 + backD + 0.07], 0.05);
  }
}

export const sofa: FurnitureRecipe = {
  kind: 'sofa',
  label: 'Sofá',
  slots: [SLOTS.upholstery, SLOTS.legs],
  defaultDims: { x: 2.1, y: 0.84, z: 0.92 },
  build: (ctx) => buildSofa(ctx),
};

export const armchair: FurnitureRecipe = {
  kind: 'armchair',
  label: 'Butaca',
  slots: [SLOTS.upholstery, SLOTS.legs],
  defaultDims: { x: 0.82, y: 0.86, z: 0.84 },
  build: (ctx) => buildSofa(ctx, 1),
};

/** Sofá en L: cuerpo principal a lo ancho + chaise longue a la derecha (o izquierda). */
export const sofaL: FurnitureRecipe = {
  kind: 'sofa-l',
  label: 'Sofá en L',
  slots: [SLOTS.upholstery, SLOTS.legs],
  defaultDims: { x: 2.7, y: 0.84, z: 1.65 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const side = ctx.str('chaise', 'right') === 'left' ? -1 : 1;
    const legH = 0.08;
    const baseH = 0.2;
    const mainD = clamp(d * 0.58, 0.8, Math.min(1, d));
    const chaiseW = clamp(w * 0.35, 0.75, 1);
    const backD = 0.2;
    const arm = 0.14;
    const seatTop = legH + baseH;
    const cushionH = 0.14;
    const z0 = -d / 2 + mainD / 2;
    cornerLegs(ctx, SLOTS.legs.slot, legH, w, mainD, 0.06, 0.022, z0);
    b.cylinder(SLOTS.legs.slot, 0.022, 0.018, legH, [side * (w / 2 - 0.06), 0, d / 2 - 0.06], 12);
    b.box(SLOTS.upholstery.slot, w, baseH, mainD, [0, legH, z0], 0.02);
    b.box(SLOTS.upholstery.slot, chaiseW, baseH, d - mainD, [side * (w / 2 - chaiseW / 2), legH, -d / 2 + mainD + (d - mainD) / 2], 0.02);
    b.box(SLOTS.upholstery.slot, w - arm, h - seatTop, backD, [-side * arm / 2, seatTop, -d / 2 + backD / 2], 0.04);
    // Brazo del lado sin chaise.
    b.box(SLOTS.upholstery.slot, arm, Math.min(h - legH, baseH + cushionH + 0.18), mainD, [-side * (w / 2 - arm / 2), legH, z0], 0.04);
    const mainInner = w - arm - chaiseW;
    const n = clamp(Math.round(mainInner / 0.7), 1, 3);
    const cw = mainInner / n;
    for (let i = 0; i < n; i++) {
      const x = -side * (w / 2 - arm) + side * (cw / 2 + i * cw);
      b.box(SLOTS.upholstery.slot, cw - 0.01, cushionH, mainD - backD, [x, seatTop, z0 + backD / 2], 0.04);
    }
    b.box(SLOTS.upholstery.slot, chaiseW - 0.01, cushionH, d - backD - 0.01, [side * (w / 2 - chaiseW / 2), seatTop, backD / 2], 0.04);
  },
};

/** Puf: redondo (torneado) o cuadrado. */
export const ottoman: FurnitureRecipe = {
  kind: 'ottoman',
  label: 'Puf',
  slots: [SLOTS.upholstery, SLOTS.legs],
  defaultDims: { x: 0.55, y: 0.42, z: 0.55 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    if (ctx.str('shape', 'round') === 'round') {
      const r = w / 2;
      b.lathe(SLOTS.upholstery.slot, [[0, 0], [r * 0.9, 0], [r, h * 0.15], [r, h * 0.85], [r * 0.9, h], [0, h]], [0, 0, 0], 32, d / w);
      return;
    }
    const legH = clamp(h * 0.18, 0.04, 0.1);
    cornerLegs(ctx, SLOTS.legs.slot, legH, w, d, 0.05, 0.018);
    b.box(SLOTS.upholstery.slot, w, h - legH, d, [0, legH, 0], 0.05);
  },
};

/** Silla de comedor: 4 patas, asiento y respaldo con montantes. Cabe bajo la mesa. */
export const diningChair: FurnitureRecipe = {
  kind: 'dining-chair',
  label: 'Silla de comedor',
  slots: [SLOTS.frame, SLOTS.seat],
  defaultDims: { x: 0.46, y: 0.86, z: 0.52 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const seatH = clamp(h * 0.53, 0.38, 0.48);
    const seatT = 0.045;
    const leg = clamp(w * 0.07, 0.025, 0.04);
    const frame = SLOTS.frame.slot;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.box(frame, leg, seatH - seatT, leg, [sx * (w / 2 - leg / 2 - 0.01), 0, sz * (d / 2 - leg / 2 - 0.01)]);
      // Montantes traseros del respaldo.
      b.box(frame, leg, h - seatH, leg, [sx * (w / 2 - leg / 2 - 0.01), seatH, -d / 2 + leg / 2]);
    }
    b.box(SLOTS.seat.slot, w, seatT, d, [0, seatH - seatT, 0], 0.012);
    const backH = Math.min(0.28, (h - seatH) * 0.6);
    b.box(SLOTS.seat.slot, w - 2 * leg, backH, 0.025, [0, h - backH, -d / 2 + 0.0125], 0.008);
  },
};

/** Taburete alto o bajo: asiento redondo, 4 patas y reposapiés. */
export const stool: FurnitureRecipe = {
  kind: 'stool',
  label: 'Taburete',
  slots: [SLOTS.frame, SLOTS.seat],
  defaultDims: { x: 0.4, y: 0.75, z: 0.4 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const r = w / 2;
    const seatT = 0.04;
    const legR = 0.016;
    const k = d / w;
    for (const a of [45, 135, 225, 315]) {
      const t = (a * Math.PI) / 180;
      b.cylinder(SLOTS.frame.slot, legR, legR, h - seatT, [Math.sin(t) * r * 0.7, 0, Math.cos(t) * r * 0.7 * k], 10);
    }
    if (h > 0.55) {
      for (const [x, z, ww, dd] of [[0, r * 0.7 * k * 0.7, r * 1.0, 0.02], [0, -r * 0.7 * k * 0.7, r * 1.0, 0.02]] as const) {
        b.box(SLOTS.frame.slot, ww, 0.02, dd, [x, h * 0.3, z]);
      }
    }
    b.cylinder(SLOTS.seat.slot, r, r, seatT, [0, h - seatT, 0], 28, k);
  },
};

/** Silla de oficina: base de 4 radios, pistón, asiento y respaldo tapizados. */
export const officeChair: FurnitureRecipe = {
  kind: 'office-chair',
  label: 'Silla de oficina',
  slots: [SLOTS.upholstery, SLOTS.base],
  defaultDims: { x: 0.62, y: 1.05, z: 0.62 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const base = SLOTS.base.slot;
    b.box(base, w, 0.04, 0.05, [0, 0.03, 0]);
    b.box(base, 0.05, 0.04, d, [0, 0.03, 0]);
    for (const [x, z] of [[w / 2 - 0.03, 0], [-w / 2 + 0.03, 0], [0, d / 2 - 0.03], [0, -d / 2 + 0.03]] as const) {
      b.sphere(base, 0.03, 0.015, 0.03, [x, 0, z], 10);
    }
    const seatY = clamp(h * 0.45, 0.4, 0.52);
    b.cylinder(base, 0.025, 0.025, seatY - 0.07, [0, 0.07, 0], 12);
    const seatW = w * 0.82;
    b.box(SLOTS.upholstery.slot, seatW, 0.08, d * 0.8, [0, seatY, d * 0.1], 0.03);
    b.box(base, 0.04, 0.2, 0.04, [0, seatY, -d * 0.32]);
    b.box(SLOTS.upholstery.slot, seatW * 0.92, h - seatY - 0.15, 0.06, [0, seatY + 0.15, -d * 0.36], 0.03);
  },
};

export const SEATING = [sofa, armchair, sofaL, ottoman, diningChair, stool, officeChair];
