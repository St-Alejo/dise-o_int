import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CatalogItem } from '@interiores/shared-types';
import { ParametricRenderer } from './parametric-renderer';

const sofa = {
  id: 'p-sofa',
  name: 'Sofá',
  category: 'sofa',
  styleTags: [],
  roomTypes: [],
  dimensionsM: { x: 2, y: 0.84, z: 0.92 },
  mount: 'floor',
  modelUrl: '/m.glb',
  currency: 'USD',
  license: 'cc0',
  tags: [],
  synonyms: [],
  recipe: { kind: 'sofa', params: {} },
  materialSlots: [
    { slot: 'tapizado', label: 'Tapizado', default: 'fabric-velvet-green', allowedKinds: ['fabric'] },
    { slot: 'patas', label: 'Patas', default: 'metal-brass', allowedKinds: ['metal'] },
  ],
} as CatalogItem;

const size = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());

describe('ParametricRenderer (adapter three.js del kit)', () => {
  it('una malla por slot con el material por defecto del catálogo', () => {
    const r = new ParametricRenderer();
    const g = r.create(sofa);
    expect(g.children.map((c) => c.name).sort()).toEqual(['patas', 'tapizado']);
    const tap = g.children.find((c) => c.name === 'tapizado') as THREE.Mesh;
    expect((tap.material as THREE.Material).name).toBe('fabric-velvet-green');
  });

  it('respeta las medidas y materiales propios de la pieza (reconstruye, no estira)', () => {
    const r = new ParametricRenderer();
    const g = r.create(sofa, { dimensionsM: { x: 2.6, y: 0.84, z: 0.92 }, materials: { tapizado: 'leather-cognac' } });
    expect(size(g).x).toBeCloseTo(2.6, 2);
    const tap = g.children.find((c) => c.name === 'tapizado') as THREE.Mesh;
    expect((tap.material as THREE.Material).name).toBe('leather-cognac');
  });

  it('Flyweight: piezas iguales comparten geometría y material; distintas no', () => {
    const r = new ParametricRenderer();
    const a = r.create(sofa).children[0] as THREE.Mesh;
    const b = r.create(sofa).children[0] as THREE.Mesh;
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    const c = r.create(sofa, { dimensionsM: { x: 1.5, y: 0.84, z: 0.92 } }).children[0] as THREE.Mesh;
    expect(c.geometry).not.toBe(a.geometry);
    expect(r.stats.materials).toBe(2);
    r.dispose();
    expect(r.stats).toEqual({ geometries: 0, materials: 0 });
  });

  it('la pantalla de una lámpara se enciende; la misma tela en una cortina, no', () => {
    const r = new ParametricRenderer();
    const shade = r.material('fabric-linen-white', 'pantalla') as THREE.MeshStandardMaterial;
    const curtain = r.material('fabric-linen-white', 'tejido') as THREE.MeshStandardMaterial;
    expect(shade).not.toBe(curtain);
    r.setGlow(1.5);
    expect(shade.emissiveIntensity).toBe(1.5);
    expect(curtain.emissive.getHex()).toBe(0);
    // Una pantalla creada después nace ya encendida.
    expect((r.material('fabric-velvet-green', 'pantalla') as THREE.MeshStandardMaterial).emissiveIntensity).toBe(1.5);
  });

  it('la tela lleva su brillo de pelusa', () => {
    const r = new ParametricRenderer();
    expect((r.material('fabric-velvet-green', 'tapizado') as THREE.MeshPhysicalMaterial).sheen).toBeGreaterThan(0);
  });

  it('el vidrio es transparente y las pantallas de lámpara se ven por dentro', () => {
    const r = new ParametricRenderer();
    expect(r.material('glass-clear', 'vidrio').transparent).toBe(true);
    expect(r.material('fabric-linen-white', 'pantalla').side).toBe(THREE.DoubleSide);
  });
});
