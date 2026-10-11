import { createRectangularShell } from '@interiores/shared-types';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FILL_HEIGHT, LIGHTING_PRESETS, LightingRig, MAX_LAMPS, MAX_WINDOW_LIGHTS, sunHeading, windowSpots } from './lighting-rig';

const lights = <T extends THREE.Light>(scene: THREE.Scene, type: new (...args: never[]) => T): T[] => {
  const found: T[] = [];
  scene.traverse((o) => {
    if (o instanceof type) found.push(o);
  });
  return found;
};
const spot = (id: string, x = 1) => ({ id, x, y: 1.5, z: 1 });

describe('LightingRig', () => {
  it('de día alumbra el sol y de noche las lámparas', () => {
    const scene = new THREE.Scene();
    const rig = new LightingRig(scene);
    rig.syncLamps([spot('a')]);
    const sun = scene.getObjectByName('sun') as THREE.DirectionalLight;
    const lamp = scene.getObjectByName('lamp-a') as THREE.PointLight;

    expect(rig.timeOfDay).toBe('day');
    expect(sun.intensity).toBe(LIGHTING_PRESETS.day.sun.intensity);
    expect(lamp.intensity).toBe(LIGHTING_PRESETS.day.lamp);
    expect((scene.background as THREE.Color).getHexString()).toBe('e9e3da');

    rig.setTimeOfDay('night');
    expect(sun.intensity).toBeLessThan(0.2);
    expect(lamp.intensity).toBeGreaterThan(LIGHTING_PRESETS.day.lamp * 4);
    expect((scene.background as THREE.Color).getHexString()).toBe('1b1f2a');
    // Una lámpara añadida de noche nace ya encendida a esa intensidad.
    rig.syncLamps([spot('a'), spot('b')]);
    expect((scene.getObjectByName('lamp-b') as THREE.PointLight).intensity).toBe(LIGHTING_PRESETS.night.lamp);
  });

  it('una luz por lámpara, se mueve con ella y se quita cuando desaparece', () => {
    const scene = new THREE.Scene();
    const rig = new LightingRig(scene);
    rig.syncLamps([spot('a', 1), spot('b', 2)]);
    expect(rig.lampCount).toBe(2);
    const a = scene.getObjectByName('lamp-a') as THREE.PointLight;

    rig.syncLamps([spot('a', 3)]);
    expect(rig.lampCount).toBe(1);
    expect(scene.getObjectByName('lamp-a')).toBe(a); // la misma luz, movida
    expect(a.position.x).toBe(3);
    expect(scene.getObjectByName('lamp-b')).toBeUndefined();
    expect(a.castShadow).toBe(false);
  });

  it('no enciende más lámparas que el tope', () => {
    const scene = new THREE.Scene();
    const rig = new LightingRig(scene);
    rig.syncLamps(Array.from({ length: 10 }, (_, i) => spot(`l${i}`, i)));
    expect(rig.lampCount).toBe(MAX_LAMPS);
    // Las lámparas, más la luz general del techo.
    expect(lights(scene, THREE.PointLight)).toHaveLength(MAX_LAMPS + 1);
  });

  it('el sol entra por la ventana más grande, y baja al mirar desde dentro', () => {
    const shell = createRectangularShell(4, 3, 2.6);
    const wall = shell.walls[1]!;
    const room = {
      ...shell,
      openings: [
        { id: 'chica', wallId: shell.walls[0]!.id, type: 'window' as const, offsetM: 1, widthM: 0.6, heightM: 0.6, sillHeightM: 1 },
        { id: 'grande', wallId: wall.id, type: 'window' as const, offsetM: 1.5, widthM: 1.8, heightM: 1.3, sillHeightM: 0.9 },
      ],
    };
    // Hacia dentro del cuarto desde esa pared: el rumbo del sol va con su normal interior.
    const mid = { x: (wall.start.x + wall.end.x) / 2, z: (wall.start.z + wall.end.z) / 2 };
    const inward = { x: 2 - mid.x, z: 1.5 - mid.z };
    const heading = sunHeading(room);
    expect(Math.hypot(heading.x, heading.z)).toBeCloseTo(1, 6);
    expect(heading.x * inward.x + heading.z * inward.z).toBeGreaterThan(0);

    const scene = new THREE.Scene();
    const rig = new LightingRig(scene);
    rig.fitToRoom(room);
    const sun = scene.getObjectByName('sun') as THREE.DirectionalLight;
    // El sol queda fuera, del lado de esa pared.
    expect((sun.position.x - 2) * inward.x + (sun.position.z - 1.5) * inward.z).toBeLessThan(0);
    const outside = sun.position.y;
    rig.setInterior(true);
    expect(sun.position.y).toBeLessThan(outside);
    expect(sun.shadow.camera.far).toBeGreaterThan(sun.position.distanceTo(sun.target.position));
  });

  it('por la tarde el sol baja y se vuelve cálido', () => {
    const scene = new THREE.Scene();
    const rig = new LightingRig(scene);
    rig.fitToRoom(createRectangularShell(4, 3, 2.6));
    const sun = scene.getObjectByName('sun') as THREE.DirectionalLight;
    const noon = sun.position.y;
    rig.setTimeOfDay('evening');
    expect(sun.position.y).toBeLessThan(noon);
    expect(sun.color.r).toBeGreaterThan(sun.color.b * 1.5);
    expect(rig.glow).toBeGreaterThan(LIGHTING_PRESETS.day.glow);
  });

  it('cada ventana da claridad, hasta el tope y de la más grande a la más pequeña', () => {
    const shell = createRectangularShell(4, 3, 2.6);
    const room = {
      ...shell,
      openings: [0, 1, 2].map((i) => ({ id: `v${i}`, wallId: shell.walls[i]!.id, type: 'window' as const, offsetM: 1.2, widthM: 0.6 + i * 0.4, heightM: 1, sillHeightM: 0.9 })),
    };
    expect(windowSpots(room).map((w) => w.area)).toEqual([1.4, 1, 0.6]);
    const scene = new THREE.Scene();
    const rig = new LightingRig(scene);
    rig.fitToRoom(room);
    const spots = lights(scene, THREE.SpotLight);
    expect(spots).toHaveLength(MAX_WINDOW_LIGHTS);
    expect(spots[0]!.intensity).toBe(LIGHTING_PRESETS.day.window.intensity);
    expect(spots[0]!.position.y).toBeCloseTo(1.4);
    rig.setTimeOfDay('night');
    expect(spots[0]!.intensity).toBe(LIGHTING_PRESETS.night.window.intensity);
    // Otro cuarto sin ventanas: no queda ninguna luz de ventana.
    rig.fitToRoom({ ...shell, openings: [] });
    expect(lights(scene, THREE.SpotLight)).toHaveLength(0);
  });

  it('las pantallas brillan de noche', () => {
    const rig = new LightingRig(new THREE.Scene());
    const day = rig.glow;
    rig.setTimeOfDay('night');
    expect(rig.glow).toBeGreaterThan(day * 4);
  });

  it('la luz del techo se centra en el cuarto', () => {
    const scene = new THREE.Scene();
    const rig = new LightingRig(scene);
    rig.fitToRoom(createRectangularShell(4, 3, 2.6));
    const ceiling = scene.getObjectByName('ceiling-light') as THREE.PointLight;
    expect(ceiling.position.toArray()).toEqual([2, 2.6 * FILL_HEIGHT, 1.5]);
    expect(ceiling.intensity).toBe(LIGHTING_PRESETS.day.ceiling);
  });
});
