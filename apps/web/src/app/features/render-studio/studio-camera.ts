import {
  SENSOR_WIDTH_MM,
  aspectRatio,
  renderSize,
  twoPointPerspective,
  verticalFovDeg,
  type RenderCamera,
  type RenderSpec,
  type Vector3,
} from '@interiores/shared-types';

/**
 * Lo que el visor necesita para colocar su cámara como la del estudio: posición, objetivo, ángulo de
 * visión, proporción y el descentramiento que endereza las verticales. Sin three.js: se prueba solo.
 */
export interface StudioView {
  position: Vector3;
  target: Vector3;
  fovDeg: number;
  aspect: number;
  /** Desplazamiento vertical del objetivo en medios altos de imagen (0 = sin descentrar). */
  shiftY: number;
  width: number;
  height: number;
  timeOfDay: RenderSpec['timeOfDay'];
}

/** Focal equivalente (mm) de un ángulo de visión vertical en un formato. */
export function focalFromFov(fovDeg: number, aspect: number): number {
  const sensorHeight = aspect >= 1 ? SENSOR_WIDTH_MM / aspect : SENSOR_WIDTH_MM;
  return sensorHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

/** La cámara del visor (en perspectiva) como cámara física del estudio. */
export function cameraFromViewer(position: Vector3, target: Vector3, fovDeg: number, aspect: number): RenderCamera {
  const focal = Math.min(135, Math.max(12, focalFromFov(fovDeg, aspect)));
  return { position: { ...position }, target: { ...target }, focalMm: Math.round(focal), straightVerticals: true };
}

/** Del RenderSpec a la vista que se aplica en el visor. */
export function studioViewOf(spec: RenderSpec): StudioView {
  const { width, height } = renderSize(spec.resolution, spec.aspect);
  const shifted = spec.camera.straightVerticals ? twoPointPerspective(spec.camera, spec.aspect) : null;
  return {
    position: shifted?.position ?? spec.camera.position,
    target: shifted?.target ?? spec.camera.target,
    fovDeg: verticalFovDeg(spec.camera.focalMm, spec.aspect),
    aspect: aspectRatio(spec.aspect),
    shiftY: shifted?.shiftY ?? 0,
    width,
    height,
    timeOfDay: spec.timeOfDay,
  };
}

/** Tamaño de la vista previa: la imagen final reducida para caber en `maxW` × `maxH`. */
export function previewSize(width: number, height: number, maxW: number, maxH: number): { width: number; height: number } {
  const k = Math.min(1, maxW / width, maxH / height);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Lo que falta, en texto: "unos 40 s", "1 min 20 s". */
export function remainingLabel(samples: number, target: number, elapsedMs: number): string | null {
  if (samples < 2 || samples >= target) return null;
  const left = ((target - samples) * elapsedMs) / samples / 1000;
  if (left < 60) return `unos ${Math.max(1, Math.round(left))} s`;
  const min = Math.floor(left / 60);
  const s = Math.round(left - min * 60);
  return s ? `${min} min ${s} s` : `${min} min`;
}
