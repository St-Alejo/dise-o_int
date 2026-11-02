import { describe, expect, it } from 'vitest';
import {
  CreateRenderFieldsSchema,
  aspectRatio,
  cameraPitch,
  defaultRenderSpec,
  renderSize,
  topDownCamera,
  twoPointPerspective,
  verticalFovDeg,
  type RenderCamera,
} from './spec.js';

const eye: RenderCamera = { position: { x: 0, y: 1.6, z: 4 }, target: { x: 0, y: 0.8, z: 0 }, focalMm: 24, straightVerticals: true };

describe('tamaños por formato', () => {
  it('el lado largo es el de la resolución y ambos lados son pares', () => {
    expect(renderSize('1080p', '16:9')).toEqual({ width: 1920, height: 1080 });
    expect(renderSize('4k', '4:3')).toEqual({ width: 3840, height: 2880 });
    expect(renderSize('2k', '1:1')).toEqual({ width: 2560, height: 2560 });
    expect(renderSize('1080p', '9:16')).toEqual({ width: 1080, height: 1920 });
    for (const s of [renderSize('2k', '16:9'), renderSize('2k', '9:16')]) {
      expect(s.width % 2).toBe(0);
      expect(s.height % 2).toBe(0);
    }
  });

  it('la proporción sale del texto del formato', () => {
    expect(aspectRatio('16:9')).toBeCloseTo(16 / 9);
    expect(aspectRatio('9:16')).toBeCloseTo(9 / 16);
  });
});

describe('cámara física', () => {
  it('un 24 mm abre más que un 50 mm', () => {
    expect(verticalFovDeg(24, '16:9')).toBeGreaterThan(verticalFovDeg(50, '16:9'));
  });

  it('un 50 mm en 3:2 da los 27° verticales de un full frame', () => {
    // 3:2 no es un formato de la app; se comprueba con 4:3, cuyo alto de sensor es 27 mm.
    expect(verticalFovDeg(50, '4:3')).toBeCloseTo((2 * Math.atan(27 / 100) * 180) / Math.PI, 5);
  });

  it('la inclinación es positiva si la cámara mira hacia abajo', () => {
    expect(cameraPitch(eye)).toBeGreaterThan(0);
    expect(cameraPitch({ position: { x: 0, y: 1, z: 0 }, target: { x: 0, y: 1, z: -2 } })).toBeCloseTo(0);
  });
});

describe('perspectiva de dos puntos', () => {
  it('nivela la cámara y desplaza el objetivo hacia abajo', () => {
    const shifted = twoPointPerspective(eye, '16:9')!;
    expect(shifted.target.y).toBe(eye.position.y);
    expect(shifted.position).toEqual(eye.position);
    expect(shifted.shiftY).toBeLessThan(0);
  });

  it('el objetivo original sigue en el centro de la foto', () => {
    const shifted = twoPointPerspective(eye, '16:9')!;
    const halfFov = (verticalFovDeg(eye.focalMm, '16:9') * Math.PI) / 360;
    // Altura en NDC del objetivo original visto con la cámara nivelada, menos el desplazamiento.
    const ndc = -Math.tan(cameraPitch(eye)) / Math.tan(halfFov);
    expect(ndc - shifted.shiftY).toBeCloseTo(0);
  });

  it('sin inclinación no hay desplazamiento', () => {
    const level: RenderCamera = { ...eye, target: { x: 0, y: 1.6, z: 0 } };
    expect(twoPointPerspective(level, '4:3')!.shiftY).toBeCloseTo(0);
  });

  it('en una vista cenital no se aplica', () => {
    expect(twoPointPerspective(topDownCamera(4, 3, '4:3'), '4:3')).toBeNull();
  });
});

describe('vista cenital', () => {
  it('mira hacia abajo desde el centro del cuarto y lo encuadra entero', () => {
    const cam = topDownCamera(5, 4, '16:9');
    expect(cam.target).toEqual({ x: 2.5, y: 0, z: 2 });
    expect(cam.position.x).toBe(2.5);
    const vFov = (verticalFovDeg(cam.focalMm, '16:9') * Math.PI) / 180;
    const visibleDepth = 2 * cam.position.y * Math.tan(vFov / 2);
    const visibleWidth = visibleDepth * aspectRatio('16:9');
    expect(visibleDepth).toBeGreaterThanOrEqual(4);
    expect(visibleWidth).toBeGreaterThanOrEqual(5);
  });
});

describe('formulario de subida', () => {
  it('lee el spec como JSON y rechaza basura', () => {
    const spec = defaultRenderSpec(eye);
    expect(CreateRenderFieldsSchema.parse({ kind: 'path', spec: JSON.stringify(spec) }).spec).toEqual(spec);
    expect(CreateRenderFieldsSchema.safeParse({ kind: 'path', spec: '{malo' }).success).toBe(false);
    expect(CreateRenderFieldsSchema.safeParse({ kind: 'photoreal', spec: JSON.stringify(spec) }).success).toBe(false);
  });
});
