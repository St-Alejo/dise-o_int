/**
 * Render en Blender (plan v10, ADR-0036): lo que viaja de la web al nodo Blender y cómo se decide
 * el aspecto de la imagen.
 *
 * La web exporta la escena como glTF y marca cada malla con su papel (`SceneExtras`). La API arma
 * aquí un `BlenderPlan` ya resuelto (tamaño, cámara descentrada, muestras, sol, lámparas) y el
 * script de Blender solo lo obedece. Así el aspecto se decide en un único sitio y se prueba con
 * Vitest, sin Blender.
 */
import { z } from 'zod';
import { LIGHT_MOODS, Vector3Schema } from '../domain.js';
import {
  RenderSpecSchema,
  SENSOR_WIDTH_MM,
  aspectRatio,
  renderSize,
  twoPointPerspective,
  type RenderQuality,
  type RenderSpec,
  type RenderTime,
} from './spec.js';

const finite = z.number().finite();

// ---------------------------------------------------------------------------
// Marcas por malla (extras de glTF → propiedades personalizadas en Blender)
// ---------------------------------------------------------------------------

/** Qué es cada malla dentro del cuarto: decide cómo la trata Blender. */
export const SCENE_ROLES = ['wall', 'floor', 'ceiling', 'window-glass', 'window-frame', 'door', 'trim', 'tiles', 'furniture', 'lamp-shade', 'other'] as const;
export const SceneRoleSchema = z.enum(SCENE_ROLES);
export type SceneRole = z.infer<typeof SceneRoleSchema>;

/** De qué está hecha: decide rugosidad, brillo, sheen o transmisión en Blender. */
export const SCENE_MATERIALS = ['paint', 'wood', 'stone', 'tile', 'concrete', 'fabric', 'leather', 'metal', 'glass', 'lacquer', 'ceramic', 'plastic', 'plant', 'other'] as const;
export const SceneMaterialSchema = z.enum(SCENE_MATERIALS);
export type SceneMaterial = z.infer<typeof SceneMaterialSchema>;

/** Claves de `userData` que el exportador escribe en cada malla (llegan a Blender tal cual). */
export const SCENE_EXTRA_KEYS = { role: 'renderRole', material: 'renderMaterial' } as const;

export const SceneExtrasSchema = z.object({ role: SceneRoleSchema, material: SceneMaterialSchema });
export type SceneExtras = z.infer<typeof SceneExtrasSchema>;

/** Material por defecto de cada papel cuando la malla no dice nada más concreto. */
export const ROLE_MATERIAL: Record<SceneRole, SceneMaterial> = {
  wall: 'paint',
  floor: 'wood',
  ceiling: 'paint',
  'window-glass': 'glass',
  'window-frame': 'lacquer',
  door: 'wood',
  trim: 'lacquer',
  tiles: 'tile',
  furniture: 'other',
  'lamp-shade': 'fabric',
  other: 'other',
};

// ---------------------------------------------------------------------------
// Lo que la web cuenta de la luz que estaba viendo
// ---------------------------------------------------------------------------

/**
 * La luz de la escena tal como la tenía el visor: el glTF solo lleva geometría y materiales, y la
 * luz se reconstruye en Blender con unidades físicas.
 */
export const BlenderLightsSchema = z.object({
  /** Hacia dónde viaja la luz del sol (normalizado; y negativo = baja). */
  sunDirection: Vector3Schema,
  /** Dónde están las bombillas de las lámparas del cuarto. */
  lamps: z.array(Vector3Schema).max(24),
  /** Luz general del techo (null si el cuarto no tiene). */
  ceiling: Vector3Schema.nullable(),
  mood: z.enum(LIGHT_MOODS),
  level: z.enum(['tenue', 'media', 'alta']),
});
export type BlenderLights = z.infer<typeof BlenderLightsSchema>;

/** Campos del formulario con el que la web pide un render en Blender (el archivo va aparte). */
export const CreateBlenderRenderFieldsSchema = z.object({
  spec: jsonField(RenderSpecSchema, 'spec no es un RenderSpec válido'),
  lights: jsonField(BlenderLightsSchema, 'lights no describe la luz de la escena'),
});
export type CreateBlenderRenderFields = z.output<typeof CreateBlenderRenderFieldsSchema>;

function jsonField<T extends z.ZodType>(schema: T, message: string) {
  return z
    .string()
    .max(8000)
    .transform((raw, ctx): z.output<T> => {
      try {
        return schema.parse(JSON.parse(raw));
      } catch {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
    });
}

// ---------------------------------------------------------------------------
// El plan que ejecuta Blender
// ---------------------------------------------------------------------------

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const BlenderPlanSchema = z.object({
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  camera: z.object({
    position: Vector3Schema,
    target: Vector3Schema,
    focalMm: finite,
    sensorMm: finite,
    /** El sensor se ajusta al lado largo, como en `verticalFovDeg`. */
    sensorFit: z.enum(['HORIZONTAL', 'VERTICAL']),
    /** Descentramiento vertical en fracción del lado largo (lo que Blender llama shift_y). */
    shiftY: finite,
  }),
  cycles: z.object({
    samples: z.number().int().min(1),
    adaptiveThreshold: finite,
    maxBounces: z.number().int().min(1),
    clampIndirect: finite,
  }),
  world: z.object({
    sunDirection: Vector3Schema,
    /** Elevación del sol en grados para el cielo físico (Nishita). */
    sunElevationDeg: finite,
    sunStrength: finite,
    sunColor: Hex,
    skyStrength: finite,
    /** Exposición en pasos (EV) y aspecto de AgX. */
    exposure: finite,
    look: z.string(),
  }),
  lamps: z.object({ positions: z.array(Vector3Schema), watts: finite, kelvin: finite }),
  ceiling: z.object({ position: Vector3Schema, watts: finite, kelvin: finite }).nullable(),
});
export type BlenderPlan = z.infer<typeof BlenderPlanSchema>;

/** Trabajo de la cola `render-jobs`: dónde está la escena, dónde dejar el resultado y el plan. */
export const BlenderJobSchema = z.object({
  renderId: z.string(),
  projectId: z.string(),
  sceneKey: z.string(),
  /** Prefijo de salida: Blender añade `.png`, `.jpg` y `.blend`. */
  outputPrefix: z.string(),
  plan: BlenderPlanSchema,
});
export type BlenderJob = z.infer<typeof BlenderJobSchema>;

/** Lo que el nodo Blender devuelve al terminar. */
export const BlenderResultSchema = z.object({
  imageKey: z.string(),
  previewKey: z.string(),
  blendKey: z.string().nullable(),
  seconds: finite,
  device: z.string(),
});
export type BlenderResult = z.infer<typeof BlenderResultSchema>;

/** Contrato API ↔ nodo Blender, exportado como JSON Schema para el test de contrato de Python. */
export const BLENDER_CONTRACT_SCHEMAS = {
  BlenderJob: BlenderJobSchema,
  BlenderResult: BlenderResultSchema,
} as const;

/**
 * Muestras de Cycles por calidad. Son más que en el navegador porque el muestreo adaptativo corta
 * en cuanto cada píxel deja de tener ruido, y el denoiser hace el resto.
 */
export const CYCLES_SAMPLES: Record<RenderQuality, number> = { draft: 128, good: 512, final: 2048 };

export function cyclesSettings(quality: RenderQuality): BlenderPlan['cycles'] {
  return {
    samples: CYCLES_SAMPLES[quality],
    // Borrador: corta antes. Final: casi sin ruido antes del denoiser.
    adaptiveThreshold: quality === 'draft' ? 0.03 : quality === 'good' ? 0.01 : 0.005,
    maxBounces: quality === 'draft' ? 8 : 12,
    // Las "luciérnagas" (píxeles blancos sueltos) salen de rebotes muy brillantes: se recortan.
    clampIndirect: 10,
  };
}

/**
 * Sol y cielo por hora. Fuerza en W/m² del Sun de Blender (con AgX, ~3–5 es sol de mediodía
 * entrando por una ventana) y exposición en EV para compensar que de noche casi todo es lámpara.
 */
export const SUN_BY_TIME: Record<RenderTime, Omit<BlenderPlan['world'], 'sunDirection' | 'sunElevationDeg'>> = {
  day: { sunStrength: 4.5, sunColor: '#fff3e0', skyStrength: 0.6, exposure: 0.3, look: 'AgX - Medium High Contrast' },
  evening: { sunStrength: 3.2, sunColor: '#ffbe7d', skyStrength: 0.35, exposure: 0.6, look: 'AgX - Medium High Contrast' },
  night: { sunStrength: 0, sunColor: '#9fb4ff', skyStrength: 0.02, exposure: 1.4, look: 'AgX - Base Contrast' },
};

/** Temperatura de color de las bombillas según el ambiente elegido. */
export const MOOD_KELVIN: Record<BlenderLights['mood'], number> = { calida: 2700, neutra: 3500, fria: 4500 };

/** Potencia (W de Blender) de una lámpara y de la luz de techo según la hora y el nivel. */
const LAMP_WATTS: Record<RenderTime, number> = { day: 15, evening: 40, night: 60 };
const CEILING_WATTS: Record<RenderTime, number> = { day: 0, evening: 60, night: 120 };
const LEVEL: Record<BlenderLights['level'], number> = { tenue: 0.6, media: 1, alta: 1.45 };

export function lampWatts(time: RenderTime, level: BlenderLights['level']): number {
  return round(LAMP_WATTS[time] * LEVEL[level]);
}

/** Elevación (grados) de una dirección de luz: 90 = cenital, 0 = rasante. */
export function sunElevationDeg(direction: { x: number; y: number; z: number }): number {
  const len = Math.hypot(direction.x, direction.y, direction.z) || 1;
  return round((Math.asin(Math.min(1, Math.max(-1, -direction.y / len))) * 180) / Math.PI);
}

/**
 * Todo lo que Blender necesita para pintar el render pedido, ya resuelto. Pura: la API la llama al
 * encolar, y el script de Blender no decide nada por su cuenta.
 */
export function blenderPlan(spec: RenderSpec, lights: BlenderLights): BlenderPlan {
  const { width, height } = renderSize(spec.resolution, spec.aspect);
  const shifted = spec.camera.straightVerticals ? twoPointPerspective(spec.camera, spec.aspect) : null;
  const landscape = aspectRatio(spec.aspect) >= 1;
  // `shiftY` de `twoPointPerspective` va en medio alto de imagen; Blender lo mide en fracción del
  // lado largo del sensor, así que en apaisado hay que pasar por la proporción.
  const shiftY = shifted ? (shifted.shiftY / 2) * (landscape ? height / width : 1) : 0;
  const time = spec.timeOfDay;
  const kelvin = MOOD_KELVIN[lights.mood];
  const ceilingWatts = round(CEILING_WATTS[time] * LEVEL[lights.level]);
  return {
    width,
    height,
    camera: {
      position: shifted?.position ?? spec.camera.position,
      target: shifted?.target ?? spec.camera.target,
      focalMm: spec.camera.focalMm,
      sensorMm: SENSOR_WIDTH_MM,
      sensorFit: landscape ? 'HORIZONTAL' : 'VERTICAL',
      shiftY: round(shiftY, 4),
    },
    cycles: cyclesSettings(spec.quality),
    world: {
      ...SUN_BY_TIME[time],
      sunDirection: normalize(lights.sunDirection),
      sunElevationDeg: sunElevationDeg(lights.sunDirection),
    },
    lamps: { positions: lights.lamps, watts: lampWatts(time, lights.level), kelvin },
    ceiling: lights.ceiling && ceilingWatts > 0 ? { position: lights.ceiling, watts: ceilingWatts, kelvin: kelvin + 300 } : null,
  };
}

function normalize(v: { x: number; y: number; z: number }) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: round(v.x / len, 4), y: round(v.y / len, 4), z: round(v.z / len, 4) };
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
