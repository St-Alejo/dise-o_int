import { defaultRenderSpec, verticalFovDeg, type RenderCamera } from '@interiores/shared-types';
import { describe, expect, it } from 'vitest';
import { halton, hasSignal } from './engines';
import { cameraFromViewer, focalFromFov, previewSize, remainingLabel, studioViewOf } from './studio-camera';

const eye: RenderCamera = { position: { x: 0.5, y: 1.6, z: 3.5 }, target: { x: 2, y: 0.9, z: 0.5 }, focalMm: 24, straightVerticals: true };

describe('cámara del estudio', () => {
  it('la focal y el ángulo de visión son ida y vuelta', () => {
    for (const mm of [16, 24, 35, 50]) expect(focalFromFov(verticalFovDeg(mm, '16:9'), 16 / 9)).toBeCloseTo(mm, 6);
  });

  it('toma la cámara del visor con una focal redonda y dentro de lo razonable', () => {
    const cam = cameraFromViewer({ x: 1, y: 1.5, z: 4 }, { x: 2, y: 1, z: 0 }, 50, 1.6);
    expect(Number.isInteger(cam.focalMm)).toBe(true);
    expect(cam.focalMm).toBeGreaterThanOrEqual(12);
    expect(cameraFromViewer({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -1 }, 170, 1).focalMm).toBe(12);
  });

  it('con verticales rectas nivela la cámara y descentra el objetivo', () => {
    const view = studioViewOf(defaultRenderSpec(eye));
    expect(view.target.y).toBe(eye.position.y);
    expect(view.shiftY).toBeLessThan(0);
    expect(view).toMatchObject({ width: 2560, height: 1440, timeOfDay: 'day' });
    expect(view.aspect).toBeCloseTo(16 / 9);
  });

  it('sin verticales rectas mira tal cual', () => {
    const view = studioViewOf(defaultRenderSpec({ ...eye, straightVerticals: false }));
    expect(view.target).toEqual(eye.target);
    expect(view.shiftY).toBe(0);
  });

  it('la vista previa cabe sin deformarse y nunca agranda', () => {
    expect(previewSize(3840, 2160, 960, 640)).toEqual({ width: 960, height: 540 });
    expect(previewSize(1080, 1920, 960, 640)).toEqual({ width: 360, height: 640 });
    expect(previewSize(400, 300, 960, 640)).toEqual({ width: 400, height: 300 });
  });

  it('el tiempo que falta sale de lo que llevan las primeras pasadas', () => {
    expect(remainingLabel(1, 100, 1000)).toBeNull();
    expect(remainingLabel(100, 100, 1000)).toBeNull();
    expect(remainingLabel(10, 100, 2000)).toBe('unos 18 s');
    expect(remainingLabel(10, 1000, 10_000)).toBe('16 min 30 s');
  });
});

describe('secuencia de Halton', () => {
  it('reparte los desplazamientos en [0, 1) sin repetirse', () => {
    const xs = Array.from({ length: 16 }, (_, i) => halton(i + 1, 2));
    expect(xs.slice(0, 4)).toEqual([0.5, 0.25, 0.75, 0.125]);
    expect(new Set(xs).size).toBe(16);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0);
    expect(halton(1, 3)).toBeCloseTo(1 / 3);
  });
});

describe('comprobación del trazado de rayos', () => {
  it('da por buena una muestra con algo de luz y rechaza el negro absoluto o los NaN', () => {
    expect(hasSignal([0, 0, 0, 1, 0.02, 0.01, 0, 1])).toBe(true);
    expect(hasSignal([0, 0, 0, 1, 0, 0, 0, 1])).toBe(false);
    expect(hasSignal([0.5, NaN, 0.5, 1])).toBe(false);
  });
});
