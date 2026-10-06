/**
 * Factory (§9): crea el objeto 3D de un CatalogItem. Carga el GLB una sola vez por mueble
 * (caché de promesas) y entrega clones que comparten geometría/material en GPU.
 * Si el modelo falla, devuelve una caja a escala real para que la escena nunca se rompa.
 */
import type { CatalogItem } from '@interiores/shared-types';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { disposeObject } from './room-builder';

const FALLBACK_COLORS: Record<string, string> = {
  sofa: '#8a8f99',
  table: '#9b7653',
  chair: '#a1887f',
  bed: '#d7ccc8',
  storage: '#8d6e63',
  lighting: '#f5e6c8',
  decor: '#7da37a',
};

export class FurnitureFactory {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<GLTF | null>>();
  private readonly fallbacks: THREE.Object3D[] = [];

  async create(item: CatalogItem): Promise<THREE.Object3D> {
    const gltf = await this.load(item);
    const object = gltf ? gltf.scene.clone(true) : this.fallback(item);
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = item.subcategory !== 'rug';
        mesh.receiveShadow = true;
      }
    });
    return object;
  }

  private load(item: CatalogItem): Promise<GLTF | null> {
    let promise = this.cache.get(item.id);
    if (!promise) {
      promise = this.loader.loadAsync(item.modelUrl).catch((err: unknown) => {
        console.warn(`[3D] No se pudo cargar ${item.id}; se usa una caja`, err);
        return null;
      });
      this.cache.set(item.id, promise);
    }
    return promise;
  }

  private fallback(item: CatalogItem): THREE.Object3D {
    const { x, y, z } = item.dimensionsM;
    const geom = new THREE.BoxGeometry(x, Math.max(y, 0.01), z);
    geom.translate(0, Math.max(y, 0.01) / 2, 0);
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ color: FALLBACK_COLORS[item.category] ?? '#999', roughness: 0.8 }),
    );
    mesh.userData['fallback'] = true;
    this.fallbacks.push(mesh);
    return mesh;
  }

  /** Libera todos los recursos GPU de los modelos cargados. */
  async dispose(): Promise<void> {
    const loaded = await Promise.all(this.cache.values());
    for (const gltf of loaded) if (gltf) disposeObject(gltf.scene);
    for (const f of this.fallbacks) disposeObject(f);
    this.cache.clear();
    this.fallbacks.length = 0;
  }
}
