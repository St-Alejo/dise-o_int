import { describe, expect, it } from 'vitest';
import {
  BlenderJobSchema,
  BlenderPlanSchema,
  CreateBlenderRenderFieldsSchema,
  EXPORT_PREVIEW_SAMPLES,
  EXPORT_PREVIEW_WIDTH,
  ROLE_MATERIAL,
  SCENE_ROLES,
  blenderPlan,
  cyclesSettings,
  lampWatts,
  sunElevationDeg,
  type BlenderLights,
} from './blender.js';
import { defaultRenderSpec, twoPointPerspective, type RenderSpec } from './spec.js';

const lights: BlenderLights = {
  sunDirection: { x: 0.5, y: -0.6, z: 0.3 },
  lamps: [{ x: 1, y: 1.4, z: 2 }],
  ceiling: { x: 2, y: 2.5, z: 2 },
  mood: 'calida',
  level: 'media',
};
const spec: RenderSpec = {
  ...defaultRenderSpec({ position: { x: 0.4, y: 1.5, z: 4 }, target: { x: 2, y: 0.9, z: 1 }, focalMm: 24, straightVerticals: true }),
  engine: 'cycles',
};

describe('plan de Blender', () => {
  it('es válido para su esquema y para el trabajo de la cola', () => {
    const plan = blenderPlan(spec, lights);
    expect(BlenderPlanSchema.parse(plan)).toEqual(plan);
    expect(BlenderJobSchema.safeParse({ renderId: 'r', projectId: 'p', userId: 'u', sceneKey: 'k.glb', outputPrefix: 'k', plan }).success).toBe(true);
  });

  it('usa el tamaño del formato pedido y ajusta el sensor al lado largo', () => {
    expect(blenderPlan(spec, lights)).toMatchObject({ width: 2560, height: 1440, camera: { sensorMm: 36, sensorFit: 'HORIZONTAL' } });
    const portrait = blenderPlan({ ...spec, aspect: '9:16' }, lights);
    expect(portrait.camera.sensorFit).toBe('VERTICAL');
    expect(portrait.height).toBeGreaterThan(portrait.width);
  });

  it('endereza las verticales: cámara nivelada y objetivo descentrado hacia abajo', () => {
    const plan = blenderPlan(spec, lights);
    expect(plan.camera.target.y).toBe(spec.camera.position.y);
    expect(plan.camera.shiftY).toBeLessThan(0);
    // shift_y de Blender va en fracción del lado largo: medio alto de imagen × alto / ancho.
    const half = twoPointPerspective(spec.camera, spec.aspect)!.shiftY / 2;
    expect(plan.camera.shiftY).toBeCloseTo((half * 1440) / 2560, 3);
  });

  it('sin verticales rectas deja la cámara como estaba', () => {
    const plan = blenderPlan({ ...spec, camera: { ...spec.camera, straightVerticals: false } }, lights);
    expect(plan.camera).toMatchObject({ position: spec.camera.position, target: spec.camera.target, shiftY: 0 });
  });

  it('de noche no hay sol y las lámparas y el techo alumbran más que de día', () => {
    const day = blenderPlan({ ...spec, timeOfDay: 'day' }, lights);
    const night = blenderPlan({ ...spec, timeOfDay: 'night' }, lights);
    expect(night.world.sunStrength).toBe(0);
    expect(night.world.skyStrength).toBeLessThan(day.world.skyStrength);
    expect(night.lamps.watts).toBeGreaterThan(day.lamps.watts);
    expect(day.ceiling).toBeNull();
    expect(night.ceiling?.watts).toBeGreaterThan(0);
  });

  it('cada hora pide una luminancia media: la noche más baja que la tarde y la tarde que el día', () => {
    const key = (timeOfDay: 'day' | 'evening' | 'night') => blenderPlan({ ...spec, timeOfDay }, lights).world.exposureKey!;
    expect(key('night')).toBeLessThan(key('evening'));
    expect(key('evening')).toBeLessThan(key('day'));
  });

  it('el ambiente cambia la temperatura de las bombillas y el nivel su potencia', () => {
    const warm = blenderPlan(spec, lights);
    const cold = blenderPlan(spec, { ...lights, mood: 'fria' });
    expect(warm.lamps.kelvin).toBeLessThan(cold.lamps.kelvin);
    expect(lampWatts('night', 'alta')).toBeGreaterThan(lampWatts('night', 'tenue'));
  });

  it('normaliza la dirección del sol y calcula su elevación', () => {
    const plan = blenderPlan(spec, { ...lights, sunDirection: { x: 0, y: -2, z: 2 } });
    expect(Math.hypot(plan.world.sunDirection.x, plan.world.sunDirection.y, plan.world.sunDirection.z)).toBeCloseTo(1, 3);
    expect(plan.world.sunElevationDeg).toBeCloseTo(45, 1);
    expect(sunElevationDeg({ x: 0, y: -1, z: 0 })).toBe(90);
  });

  it('más calidad = más muestras y umbral adaptativo más fino', () => {
    const [draft, good, final] = (['draft', 'good', 'final'] as const).map(cyclesSettings);
    expect(draft!.samples).toBeLessThan(good!.samples);
    expect(good!.samples).toBeLessThan(final!.samples);
    expect(final!.adaptiveThreshold).toBeLessThan(draft!.adaptiveThreshold);
  });

  it('un render normal no lleva miniatura: renderiza lo pedido', () => {
    expect(blenderPlan(spec, lights).preview).toBeUndefined();
  });

  it('exportar deja el .blend en calidad final y solo renderiza una miniatura rápida', () => {
    const plan = blenderPlan({ ...spec, quality: 'draft', purpose: 'export' }, lights);
    expect(BlenderPlanSchema.parse(plan)).toEqual(plan);
    expect(plan.cycles).toEqual(cyclesSettings('final'));
    expect(plan).toMatchObject({ width: 2560, height: 1440 });
    expect(plan.preview).toEqual({ width: EXPORT_PREVIEW_WIDTH, height: Math.round((EXPORT_PREVIEW_WIDTH * 1440) / 2560), samples: EXPORT_PREVIEW_SAMPLES });
  });

  it('la miniatura de un formato vertical respeta su proporción', () => {
    const plan = blenderPlan({ ...spec, aspect: '9:16', purpose: 'export' }, lights);
    expect(plan.preview!.height).toBe(EXPORT_PREVIEW_WIDTH);
    expect(plan.preview!.width).toBeLessThan(plan.preview!.height);
  });
});

describe('formulario del render en Blender', () => {
  it('acepta spec y luces como JSON y rechaza lo que no lo es', () => {
    const ok = CreateBlenderRenderFieldsSchema.safeParse({ spec: JSON.stringify(spec), lights: JSON.stringify(lights) });
    expect(ok.success && ok.data.lights.mood).toBe('calida');
    expect(CreateBlenderRenderFieldsSchema.safeParse({ spec: JSON.stringify(spec), lights: '{' }).success).toBe(false);
    expect(CreateBlenderRenderFieldsSchema.safeParse({ spec: '{}', lights: JSON.stringify(lights) }).success).toBe(false);
  });

  it('todo papel tiene un material por defecto', () => {
    for (const role of SCENE_ROLES) expect(ROLE_MATERIAL[role]).toBeTruthy();
  });
});
