/**
 * Estudio de render (plan v9): cómo se describe una imagen o un vídeo del cuarto.
 *
 * La web dibuja (trazado de rayos o raster de alta calidad), la API guarda y la IA puede convertir
 * un render en una foto realista. Aquí vive todo lo que no depende de three.js: la cámara física,
 * los tamaños por formato, la calidad y la corrección de verticales de la fotografía de
 * arquitectura. Unidades: metros; Y hacia arriba.
 */
import { z } from 'zod';
import { Vector3Schema, type Vector3 } from '../domain.js';

const finite = z.number().finite();

/** Momento del día con el que se ilumina el render (los mismos tres del visor). */
export const RENDER_TIMES = ['day', 'evening', 'night'] as const;
export const RenderTimeSchema = z.enum(RENDER_TIMES);
export type RenderTime = z.infer<typeof RenderTimeSchema>;

/** Formatos de salida: apaisado, clásico, cuadrado y vertical para redes. */
export const RENDER_ASPECTS = ['16:9', '4:3', '1:1', '9:16'] as const;
export const RenderAspectSchema = z.enum(RENDER_ASPECTS);
export type RenderAspect = z.infer<typeof RenderAspectSchema>;

/** Resoluciones por su lado largo. */
export const RENDER_RESOLUTIONS = { '1080p': 1920, '2k': 2560, '4k': 3840 } as const;
export const RenderResolutionSchema = z.enum(['1080p', '2k', '4k']);
export type RenderResolution = z.infer<typeof RenderResolutionSchema>;

/** Calidad = muestras por píxel del trazado de rayos (en raster, fotogramas acumulados). */
export const RENDER_QUALITIES = { draft: 64, good: 256, final: 1024 } as const;
export const RenderQualitySchema = z.enum(['draft', 'good', 'final']);
export type RenderQuality = z.infer<typeof RenderQualitySchema>;

/**
 * Motor: trazado de rayos en el navegador (luz rebotada, reflejos), raster de alta calidad (respaldo
 * y vídeo) o Cycles en el nodo Blender (ADR-0036).
 */
export const RenderEngineSchema = z.enum(['pathtracer', 'raster', 'cycles']);
export type RenderEngine = z.infer<typeof RenderEngineSchema>;

/** Objetivos habituales en fotografía de interiores (equivalente a full frame). */
export const FOCAL_PRESETS_MM = [16, 24, 35, 50] as const;

/** Cámara física: dónde está, a qué mira, con qué objetivo y si endereza las verticales. */
export const RenderCameraSchema = z.object({
  position: Vector3Schema,
  target: Vector3Schema,
  focalMm: finite.min(12).max(135),
  straightVerticals: z.boolean(),
});
export type RenderCamera = z.infer<typeof RenderCameraSchema>;

export const RenderSpecSchema = z.object({
  camera: RenderCameraSchema,
  timeOfDay: RenderTimeSchema,
  resolution: RenderResolutionSchema,
  aspect: RenderAspectSchema,
  quality: RenderQualitySchema,
  engine: RenderEngineSchema,
  /**
   * Solo Cycles. `export`: lo que se quiere es el `.blend` para abrirlo en Blender, no la imagen
   * (se renderiza una miniatura para la galería). Sin valor = `render`.
   */
  purpose: z.enum(['render', 'export']).optional(),
});
export type RenderSpec = z.infer<typeof RenderSpecSchema>;

/** Ancho de un sensor full frame: la focal se traduce a ángulo de visión con él. */
export const SENSOR_WIDTH_MM = 36;

/** Proporción ancho / alto de un formato. */
export function aspectRatio(aspect: RenderAspect): number {
  const [w, h] = aspect.split(':').map(Number) as [number, number];
  return w / h;
}

/** Tamaño en píxeles (pares, como piden los códecs de vídeo) de una resolución en un formato. */
export function renderSize(resolution: RenderResolution, aspect: RenderAspect): { width: number; height: number } {
  const long = RENDER_RESOLUTIONS[resolution];
  const ratio = aspectRatio(aspect);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return ratio >= 1 ? { width: even(long), height: even(long / ratio) } : { width: even(long * ratio), height: even(long) };
}

/**
 * Ángulo de visión vertical (grados) de una focal en un formato. El sensor se ajusta al lado
 * horizontal en los apaisados y al vertical en los verticales, como una cámara girada.
 */
export function verticalFovDeg(focalMm: number, aspect: RenderAspect): number {
  const ratio = aspectRatio(aspect);
  const sensorHeight = ratio >= 1 ? SENSOR_WIDTH_MM / ratio : SENSOR_WIDTH_MM;
  return (2 * Math.atan(sensorHeight / (2 * focalMm)) * 180) / Math.PI;
}

/** Inclinación de la cámara en radianes (positiva si mira hacia abajo). */
export function cameraPitch(camera: Pick<RenderCamera, 'position' | 'target'>): number {
  const dx = camera.target.x - camera.position.x;
  const dz = camera.target.z - camera.position.z;
  const dy = camera.position.y - camera.target.y;
  return Math.atan2(dy, Math.hypot(dx, dz));
}

/**
 * Inclinación máxima que se corrige descentrando el objetivo. Un objetivo basculable real llega a
 * poco más de eso; con la cámara más inclinada, el descentramiento estira la imagen.
 */
export const MAX_SHIFT_PITCH_RAD = (30 * Math.PI) / 180;

export interface ShiftedCamera {
  position: Vector3;
  /** Objetivo a la altura de la cámara: el plano de imagen queda vertical. */
  target: Vector3;
  /**
   * Descentramiento vertical del objetivo, en unidades de medio alto de imagen (NDC): con él el
   * objetivo original sigue en el mismo punto de la foto aunque la cámara ya no se incline.
   */
  shiftY: number;
}

/**
 * Perspectiva de dos puntos (objetivo descentrable): en vez de inclinar la cámara, que hace que las
 * paredes "caigan", se nivela y se desplaza el objetivo. Devuelve null si la vista es casi cenital.
 */
export function twoPointPerspective(camera: RenderCamera, aspect: RenderAspect): ShiftedCamera | null {
  const pitch = cameraPitch(camera);
  if (Math.abs(pitch) > MAX_SHIFT_PITCH_RAD) return null;
  const halfFov = (verticalFovDeg(camera.focalMm, aspect) * Math.PI) / 360;
  return {
    position: { ...camera.position },
    target: { x: camera.target.x, y: camera.position.y, z: camera.target.z },
    shiftY: -Math.tan(pitch) / Math.tan(halfFov),
  };
}

/** Vista cenital del cuarto completo, como las del video de referencia. */
export function topDownCamera(widthM: number, depthM: number, aspect: RenderAspect, focalMm = 24): RenderCamera {
  const ratio = aspectRatio(aspect);
  const vFov = (verticalFovDeg(focalMm, aspect) * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * ratio);
  const margin = 1.08;
  const height = Math.max((depthM * margin) / 2 / Math.tan(vFov / 2), (widthM * margin) / 2 / Math.tan(hFov / 2));
  const cx = widthM / 2;
  const cz = depthM / 2;
  // Un pelo desplazada en z para que "arriba" de la imagen sea siempre el fondo del cuarto.
  return { position: { x: cx, y: height, z: cz + 1e-3 }, target: { x: cx, y: 0, z: cz }, focalMm, straightVerticals: false };
}

/** Lo que se pide al abrir el estudio: la cámara actual, de día, 2K apaisado y calidad buena. */
export function defaultRenderSpec(camera: RenderCamera): RenderSpec {
  return { camera, timeOfDay: 'day', resolution: '2k', aspect: '16:9', quality: 'good', engine: 'pathtracer' };
}

// ---------------------------------------------------------------------------
// Renders guardados en el proyecto (galería)
// ---------------------------------------------------------------------------

/** path = render del estudio; photoreal = foto hecha por la IA a partir de un render; video = recorrido. */
export const RENDER_KINDS = ['path', 'photoreal', 'video'] as const;
export const RenderKindSchema = z.enum(RENDER_KINDS);
export type RenderKind = z.infer<typeof RenderKindSchema>;

export const RenderStatusSchema = z.enum(['pending', 'ready', 'failed']);
export type RenderStatus = z.infer<typeof RenderStatusSchema>;

/** Tipos de archivo que acepta la galería. */
export const RENDER_MEDIA_TYPES = ['image/png', 'image/jpeg', 'video/mp4', 'video/webm'] as const;
export const RenderMediaTypeSchema = z.enum(RENDER_MEDIA_TYPES);
export type RenderMediaType = z.infer<typeof RenderMediaTypeSchema>;

/** Cuánto puede cambiar la IA: fiel a la geometría, equilibrado o creativo. */
export const PHOTOREAL_FIDELITIES = ['faithful', 'balanced', 'creative'] as const;
export const PhotorealFidelitySchema = z.enum(PHOTOREAL_FIDELITIES);
export type PhotorealFidelity = z.infer<typeof PhotorealFidelitySchema>;

export const RenderSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: RenderKindSchema,
  status: RenderStatusSchema,
  mediaType: RenderMediaTypeSchema.nullable(),
  /** URL firmada; null mientras no esté lista. */
  url: z.string().nullable(),
  spec: RenderSpecSchema.nullable(),
  /** Render del que sale (la foto IA apunta a su render 3D). */
  sourceRenderId: z.string().nullable(),
  fidelity: PhotorealFidelitySchema.nullable(),
  provider: z.string().nullable(),
  /** Sale en el enlace público del proyecto. */
  shared: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
  /** Solo en los renders de Blender ya listos: el PNG sin comprimir y la escena `.blend` para retocarla. */
  downloads: z.object({ png: z.string(), blend: z.string() }).optional(),
});
export type Render = z.infer<typeof RenderSchema>;

/** Campos del formulario multipart con el que la web sube un render hecho en el navegador. */
export const CreateRenderFieldsSchema = z.object({
  kind: z.enum(['path', 'video']),
  /** RenderSpec como JSON (los formularios multipart solo llevan texto). */
  spec: z
    .string()
    .max(4000)
    .transform((raw, ctx) => {
      try {
        return RenderSpecSchema.parse(JSON.parse(raw));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'spec no es un RenderSpec válido' });
        return z.NEVER;
      }
    }),
});
export type CreateRenderFields = z.output<typeof CreateRenderFieldsSchema>;

/** `PATCH /projects/:id/renders/:rid`. */
export const UpdateRenderRequestSchema = z.object({ shared: z.boolean() });
export type UpdateRenderRequest = z.infer<typeof UpdateRenderRequestSchema>;

/** `POST /projects/:id/renders/:rid/photoreal`. */
export const PhotorealRequestSchema = z.object({ fidelity: PhotorealFidelitySchema.default('balanced') });
export type PhotorealRequest = z.input<typeof PhotorealRequestSchema>;
