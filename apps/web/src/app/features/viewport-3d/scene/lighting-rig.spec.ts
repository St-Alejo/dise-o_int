import { createRectangularShell } from '@interiores/shared-types';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LIGHTING_PRESETS, LightingRig, MAX_LAMPS } from './lighting-rig';

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

  it('la luz del techo se centra en el cuarto', () => {
    const scene = new THREE.Scene();
    const rig = new LightingRig(scene);
    rig.fitToRoom(createRectangularShell(4, 3, 2.6));
    const ceiling = scene.getObjectByName('ceiling-light') as THREE.PointLight;
    expect(ceiling.position.toArray()).toEqual([2, 2.35, 1.5]);
    expect(ceiling.intensity).toBe(LIGHTING_PRESETS.day.ceiling);
  });
});
