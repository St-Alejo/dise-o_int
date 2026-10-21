/**
 * Baño ampliado, tocador y luces nuevas (plan v7, fase 2): tocador con espejo de bombillas,
 * espejo con luz, toallero, mueble de lavabo suspendido, bidé, ducha de obra, mampara, tira LED,
 * foco empotrado, plafón y lámpara de arco. El slot `pantalla` es el que se enciende de noche.
 */
import type { FurnitureRecipe } from '../registry.js';
import { cylinder } from '../mesh.js';
import { SLOTS } from './slots.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Bombillas o luz del espejo: el slot que brilla, en blanco por defecto. */
const LIGHT = { ...SLOTS.shade, label: 'Luz', default: 'plastic-white' };

export const dressingTable: FurnitureRecipe = {
  kind: 'dressing-table',
  label: 'Tocador',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.legs, SLOTS.mirror, LIGHT],
  defaultDims: { x: 1.0, y: 1.45, z: 0.45 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const top = Math.min(0.76, h * 0.55);
    const board = 0.025;
    const apron = 0.14;
    b.box(SLOTS.body.slot, w, board, d, [0, top - board, 0], 0.004);
    b.box(SLOTS.body.slot, w - 0.04, apron, d - 0.04, [0, top - board - apron, 0]);
    // Dos cajones al frente (+Z) con su tirador.
    const drawers = w > 0.8 ? 2 : 1;
    const dw = (w - 0.06) / drawers;
    for (let i = 0; i < drawers; i++) {
      const x = -w / 2 + 0.03 + dw / 2 + i * dw;
      b.box(SLOTS.fronts.slot, dw - 0.006, apron - 0.02, 0.016, [x, top - board - apron + 0.01, d / 2 - 0.028]);
      b.box(SLOTS.handles.slot, Math.min(0.1, dw * 0.3), 0.01, 0.012, [x, top - board - apron / 2, d / 2 - 0.014]);
    }
    const legH = top - board - apron;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.cylinder(SLOTS.legs.slot, 0.018, 0.014, legH, [sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)], 12);
    }
    // Espejo apoyado al fondo, con su marco y bombillas por los lados y arriba.
    if (h - top < 0.25) return;
    const mw = Math.min(w * 0.72, 0.85);
    const mh = h - top - 0.02;
    const back = -d / 2 + 0.012;
    b.box(SLOTS.body.slot, mw + 0.08, mh, 0.024, [0, top, back]);
    b.box(SLOTS.mirror.slot, mw - 0.02, mh - 0.1, 0.006, [0, top + 0.05, back + 0.015]);
    const bulbs = clamp(Math.round(mh / 0.16), 2, 6);
    for (let i = 0; i < bulbs; i++) {
      const y = top + 0.06 + ((mh - 0.12) * (i + 0.5)) / bulbs;
      for (const sx of [-1, 1]) b.sphere(LIGHT.slot, 0.022, 0.022, 0.022, [sx * (mw / 2 + 0.02), y, back + 0.03], 12);
    }
    for (let i = 1; i < 4; i++) b.sphere(LIGHT.slot, 0.022, 0.022, 0.022, [-mw / 2 + (mw * i) / 4, top + mh - 0.03, back + 0.03], 12);
  },
};

export const ledMirror: FurnitureRecipe = {
  kind: 'led-mirror',
  label: 'Espejo con luz',
  slots: [SLOTS.mirror, LIGHT],
  defaultDims: { x: 0.8, y: 0.7, z: 0.035 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    // La luz va detrás del espejo y asoma por el borde: un halo en la pared.
    if (ctx.str('shape', 'rect') === 'round') {
      b.disc(LIGHT.slot, w / 2, d * 0.4, [0, h / 2, -d / 2], 48, h / w);
      b.disc(SLOTS.mirror.slot, w / 2 - 0.012, d * 0.6, [0, h / 2, -d / 2 + d * 0.4], 48, (h - 0.024) / (w - 0.024));
      return;
    }
    b.box(LIGHT.slot, w, h, d * 0.4, [0, 0, -d / 2 + d * 0.2]);
    b.box(SLOTS.mirror.slot, w - 0.024, h - 0.024, d * 0.6, [0, 0.012, d / 2 - d * 0.3], 0.004);
  },
};

export const towelRail: FurnitureRecipe = {
  kind: 'towel-rail',
  label: 'Toallero',
  slots: [SLOTS.metal, SLOTS.textile],
  defaultDims: { x: 0.6, y: 0.5, z: 0.1 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const bars = clamp(Math.round(ctx.num('bars', 1)), 1, 3);
    const barZ = d / 2 - 0.012;
    // Pletinas a la pared de arriba abajo, y de ellas salen los brazos de cada barra.
    for (const sx of [-1, 1]) b.box(SLOTS.metal.slot, 0.02, h, 0.012, [sx * (w / 2 - 0.01), 0, -d / 2 + 0.006], 0.003);
    for (let i = 0; i < bars; i++) {
      const y = h - 0.018 - i * Math.min(0.12, (h - 0.02) / bars);
      b.box(SLOTS.metal.slot, w, 0.018, 0.018, [0, y, barZ - 0.009], 0.008);
      for (const sx of [-1, 1]) b.box(SLOTS.metal.slot, 0.014, 0.014, d - 0.01, [sx * (w / 2 - 0.01), y + 0.002, 0]);
    }
    if (!ctx.bool('towel', true)) return;
    // Toalla doblada sobre la barra de arriba: un paño por delante y otro por detrás.
    const tw = w * 0.72;
    b.box(SLOTS.textile.slot, tw, h - 0.02, 0.012, [0, 0, barZ + 0.004], 0.004);
    b.box(SLOTS.textile.slot, tw, (h - 0.02) * 0.7, 0.012, [0, (h - 0.02) * 0.3, barZ - 0.026], 0.004);
  },
};

export const vanityFloating: FurnitureRecipe = {
  kind: 'vanity-floating',
  label: 'Mueble de lavabo suspendido',
  slots: [SLOTS.body, SLOTS.fronts, SLOTS.handles, SLOTS.ceramic, SLOTS.metal],
  defaultDims: { x: 0.8, y: 0.62, z: 0.46 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    // Cuelga de la pared: cajón sin zócalo, lavabo encima y grifo de pared.
    const basinH = 0.13;
    const tap = Math.min(0.14, h * 0.25);
    const bodyH = h - basinH - tap;
    b.box(SLOTS.body.slot, w, bodyH, d - 0.04, [0, 0, -0.02]);
    const drawers = w > 0.9 ? 2 : 1;
    const dw = w / drawers;
    for (let i = 0; i < drawers; i++) {
      const x = -w / 2 + dw / 2 + i * dw;
      b.box(SLOTS.fronts.slot, dw - 0.004, bodyH - 0.004, 0.018, [x, 0.002, d / 2 - 0.031]);
      b.box(SLOTS.handles.slot, Math.min(0.2, dw * 0.5), 0.008, 0.01, [x, bodyH - 0.03, d / 2 - 0.011]);
    }
    b.box(SLOTS.ceramic.slot, w, basinH, d, [0, bodyH, 0], 0.025);
    b.box(SLOTS.metal.slot, 0.05, tap, 0.02, [0, bodyH + basinH, -d / 2 + 0.01], 0.006);
    b.box(SLOTS.metal.slot, 0.022, 0.022, 0.16, [0, bodyH + basinH + tap * 0.5, -d / 2 + 0.1], 0.008);
  },
};

export const bidet: FurnitureRecipe = {
  kind: 'bidet',
  label: 'Bidé',
  slots: [SLOTS.ceramic, SLOTS.metal],
  defaultDims: { x: 0.36, y: 0.4, z: 0.54 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const r = w / 2;
    const bowlH = h - 0.04;
    b.lathe(SLOTS.ceramic.slot, [[r * 0.55, 0], [r * 0.62, bowlH * 0.35], [r * 0.95, bowlH * 0.88], [r, bowlH], [r * 0.72, bowlH]], [0, 0, 0.02], 28, (d - 0.04) / w);
    b.box(SLOTS.ceramic.slot, w * 0.6, bowlH, 0.1, [0, 0, -d / 2 + 0.05], 0.02);
    b.cylinder(SLOTS.metal.slot, 0.016, 0.014, 0.04, [0, bowlH, -d / 2 + 0.06], 12);
    b.box(SLOTS.metal.slot, 0.018, 0.018, 0.08, [0, h - 0.018, -d / 2 + 0.1], 0.006);
  },
};

export const walkInShower: FurnitureRecipe = {
  kind: 'walk-in-shower',
  label: 'Ducha de obra',
  slots: [SLOTS.ceramic, SLOTS.glass, SLOTS.metal],
  defaultDims: { x: 1.2, y: 2.0, z: 0.9 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    // Plato a ras del suelo con rejilla lineal al fondo, un solo panel de vidrio y rociador de techo.
    b.box(SLOTS.ceramic.slot, w, 0.015, d, [0, 0, 0], 0.003);
    b.box(SLOTS.metal.slot, w * 0.6, 0.004, 0.05, [0, 0.015, -d / 2 + 0.08]);
    const panel = clamp(ctx.num('panel', 0.6), 0.3, 1) * w;
    const px = w / 2 - panel / 2;
    b.box(SLOTS.glass.slot, panel, h - 0.015, 0.008, [px, 0.015, d / 2 - 0.006]);
    b.box(SLOTS.metal.slot, 0.014, 0.014, d - 0.01, [w / 2 - 0.007, h - 0.04, 0]);
    b.box(SLOTS.metal.slot, 0.022, 0.022, 0.34, [0, h - 0.18, -d / 2 + 0.17], 0.006);
    b.cylinder(SLOTS.metal.slot, 0.13, 0.13, 0.012, [0, h - 0.2, -d / 2 + 0.3], 28);
    b.disc(SLOTS.metal.slot, 0.035, 0.02, [-w * 0.25, 1.0, -d / 2], 16);
  },
};

export const bathScreen: FurnitureRecipe = {
  kind: 'bath-screen',
  label: 'Mampara de bañera',
  slots: [SLOTS.glass, SLOTS.metal],
  defaultDims: { x: 0.8, y: 1.4, z: 0.03 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    b.box(SLOTS.metal.slot, 0.02, h, d, [-w / 2 + 0.01, 0, 0]);
    b.box(SLOTS.glass.slot, w - 0.02, h - 0.01, 0.008, [0.01, 0.005, 0]);
    b.box(SLOTS.metal.slot, w - 0.02, 0.012, d * 0.6, [0.01, 0, 0]);
  },
};

export const ledStrip: FurnitureRecipe = {
  kind: 'led-strip',
  label: 'Tira LED',
  slots: [SLOTS.metal, LIGHT],
  defaultDims: { x: 1.2, y: 0.015, z: 0.02 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    // Perfil de aluminio con la tira encendida asomando por delante.
    b.box(SLOTS.metal.slot, w, h, d * 0.7, [0, 0, -d / 2 + d * 0.35]);
    b.box(LIGHT.slot, w - 0.01, h * 0.7, d * 0.3, [0, h * 0.15, d / 2 - d * 0.15]);
  },
};

export const recessedSpot: FurnitureRecipe = {
  kind: 'recessed-spot',
  label: 'Foco empotrado',
  slots: [SLOTS.metal, LIGHT],
  defaultDims: { x: 0.09, y: 0.02, z: 0.09 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const k = d / w;
    b.cylinder(SLOTS.metal.slot, w / 2, w / 2, h * 0.6, [0, h * 0.4, 0], 24, k);
    b.cylinder(LIGHT.slot, w * 0.32, w * 0.36, h * 0.4, [0, 0, 0], 24, k);
  },
};

export const flushLight: FurnitureRecipe = {
  kind: 'flush-light',
  label: 'Plafón',
  slots: [SLOTS.base, LIGHT],
  defaultDims: { x: 0.4, y: 0.1, z: 0.4 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const r = w / 2;
    const k = d / w;
    b.cylinder(SLOTS.base.slot, r, r, 0.02, [0, h - 0.02, 0], 36, k);
    b.lathe(LIGHT.slot, [[0.001, 0], [r * 0.6, 0.006], [r * 0.92, (h - 0.02) * 0.55], [r * 0.97, h - 0.02]], [0, 0, 0], 36, k);
  },
};

export const arcLamp: FurnitureRecipe = {
  kind: 'arc-lamp',
  label: 'Lámpara de arco',
  slots: [SLOTS.base, SLOTS.metal, SLOTS.shade],
  defaultDims: { x: 1.5, y: 2.0, z: 0.4 },
  build: (ctx) => {
    const { w, h, d, b } = ctx;
    const baseR = d / 2;
    const x0 = -w / 2 + baseR;
    const shadeR = Math.min(0.2, d / 2);
    const x1 = w / 2 - shadeR;
    const shadeH = shadeR * 0.9;
    const yTop = h - 0.02;
    b.cylinder(SLOTS.base.slot, baseR, baseR * 0.95, 0.05, [x0, 0, 0], 32);
    // Arco de un cuarto de elipse: sube vertical desde la base y llega horizontal sobre la pantalla.
    const n = 14;
    const at = (t: number) => ({ x: x0 + (x1 - x0) * (1 - Math.cos((t * Math.PI) / 2)), y: 0.05 + (yTop - 0.05) * Math.sin((t * Math.PI) / 2) });
    for (let i = 0; i < n; i++) {
      const a = at(i / n);
      const c = at((i + 1) / n);
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      const tilt = Math.atan2(c.x - a.x, c.y - a.y);
      b.add(SLOTS.metal.slot, cylinder(0.011, 0.011, len + 0.004, 8), { position: [a.x, a.y, 0], rotationX: tilt, rotationY: Math.PI / 2 });
    }
    b.cylinder(SLOTS.metal.slot, 0.006, 0.006, yTop - (yTop - 0.12) + 0.02, [x1, yTop - 0.12, 0], 6);
    b.lathe(SLOTS.shade.slot, [[shadeR, yTop - 0.12 - shadeH], [shadeR * 0.75, yTop - 0.12 - shadeH * 0.35], [0.02, yTop - 0.12]], [x1, 0, 0], 32);
  },
};

export const BATH_VANITY_LIGHT = [dressingTable, ledMirror, towelRail, vanityFloating, bidet, walkInShower, bathScreen, ledStrip, recessedSpot, flushLight, arcLamp];
