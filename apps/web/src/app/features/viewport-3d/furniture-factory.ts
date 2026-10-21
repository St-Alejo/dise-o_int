/**
 * Factory (§9): crea el objeto 3D de un CatalogItem. Carga el GLB una sola vez por mueble
 * (caché de promesas) y entrega clones que comparten geometría/material en GPU.
 * Si el modelo falla, devuelve una caja a escala real para que la escena nunca se rompa.
 */
import type { CatalogItem } from '@interiores/shared-types';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ParametricRenderer, type FurnitureTextures, type ParametricPlacement } from './parametric-renderer';
import { disposeObject } from './room-builder';

const FALLBACK_COLORS: Record<string, string> = {
  sofa: '#8a8f99',
  table: '#9b7653',
  chair: '#a1887f',
  bed: '#d7ccc8',
  storage: '#8d6e63',
  lighting: '#f5e6c8',
  decor: '#7da37a',
  kitchen: '#d8d6d0',
  bathroom: '#f1f1ef',
  'wall-decor': '#c8a97e',
  textile: '#b9a88f',
  electronics: '#222222',
};

/** Nombres de material que, en una lámpara, son la parte que da luz. */
const GLOW_NAMES = /shade|bulb|glass|lamp|light|emiss|diffus|paper|pantalla|bombilla/i;
const GLOW_COLOR = '#ffd9a8';

export class FurnitureFactory {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<GLTF | null>>();
  /** Una caja de reemplazo por mueble; las instancias son clones que comparten geometría y material. */
  private readonly fallbacks = new Map<string, THREE.Object3D>();

  private readonly parametric: ParametricRenderer;
  /** Pantallas y bombillas de las lámparas GLB: se encienden igual que las paramétricas. */
  private readonly glbGlow = new Set<THREE.MeshStandardMaterial>();
  private glow = 0;

  constructor(textures: FurnitureTextures | null = null) {
    this.parametric = new ParametricRenderer(textures);
  }

  /** Llegaron las texturas PBR: se visten los muebles ya construidos. */
  refreshTextures(): void {
    this.parametric.refreshTextures();
  }

  /**
   * Muebles paramétricos: se construyen en vivo con su receta y las medidas/materiales propios
   * de la pieza (reconstruir, no estirar). Resto: GLB cacheado y clonado.
   */
  async create(item: CatalogItem, placement: ParametricPlacement = {}): Promise<THREE.Object3D> {
    if (ParametricRenderer.supports(item)) {
      try {
        return this.withShadows(item, this.parametric.create(item, placement));
      } catch (err) {
        console.warn(`[3D] Receta inválida para ${item.id}; se usa el GLB`, err);
      }
    }
    const gltf = await this.load(item);
    const object = (gltf ? gltf.scene : this.fallback(item)).clone(true);
    const dims = placement.dimensionsM;
    if (dims) {
      // Un GLB no se puede reconstruir: se escala por eje (el catálogo lo limita a ±15 %).
      const base = item.dimensionsM;
      const wrapper = new THREE.Group();
      wrapper.add(object);
      wrapper.scale.set(dims.x / base.x, dims.y / base.y, dims.z / base.z);
      return this.withShadows(item, wrapper);
    }
    return this.withShadows(item, object);
  }

  /** Brillo de las pantallas de lámpara. */
  setGlow(intensity: number): void {
    this.glow = intensity;
    this.parametric.setGlow(intensity);
    for (const mat of this.glbGlow) mat.emissiveIntensity = intensity;
  }

  /**
   * En una lámpara GLB, lo que da luz: los materiales con nombre de pantalla, bombilla o vidrio
   * (si no se sabe cuál es, nada: encender el cuerpo entero se ve peor que no encender). Se
   * cambian en el modelo cacheado, así que todos sus clones se encienden a la vez.
   */
  private markGlow(scene: THREE.Object3D): void {
    const mats = new Set<THREE.MeshStandardMaterial>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) mats.add(m as THREE.MeshStandardMaterial);
      }
    });
    for (const mat of [...mats].filter((m) => GLOW_NAMES.test(m.name))) {
      mat.emissive = new THREE.Color(GLOW_COLOR).multiply(mat.color.clone().lerp(new THREE.Color('#ffffff'), 0.5));
      mat.emissiveIntensity = this.glow;
      this.glbGlow.add(mat);
    }
  }

  private withShadows(item: CatalogItem, object: THREE.Object3D): THREE.Object3D {
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        // La lámpara no se hace sombra a sí misma: su luz sale de dentro de la pantalla.
        mesh.castShadow = item.subcategory !== 'rug' && item.category !== 'lighting';
        mesh.receiveShadow = true;
      }
    });
    return object;
  }

  private load(item: CatalogItem): Promise<GLTF | null> {
    let promise = this.cache.get(item.id);
    if (!promise) {
      promise = this.loader.loadAsync(item.modelUrl).then((gltf) => {
        if (item.category === 'lighting') this.markGlow(gltf.scene);
        return gltf;
      }).catch((err: unknown) => {
        console.warn(`[3D] No se pudo cargar ${item.id}; se usa una caja`, err);
        return null;
      });
      this.cache.set(item.id, promise);
    }
    return promise;
  }

  private fallback(item: CatalogItem): THREE.Object3D {
    const cached = this.fallbacks.get(item.id);
    if (cached) return cached;
    const { x, y, z } = item.dimensionsM;
    const geom = new THREE.BoxGeometry(x, Math.max(y, 0.01), z);
    geom.translate(0, Math.max(y, 0.01) / 2, 0);
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ color: FALLBACK_COLORS[item.category] ?? '#999', roughness: 0.8 }),
    );
    mesh.userData['fallback'] = true;
    this.fallbacks.set(item.id, mesh);
    return mesh;
  }

  /** Libera todos los recursos GPU de los modelos cargados. */
  async dispose(): Promise<void> {
    const loaded = await Promise.all(this.cache.values());
    for (const gltf of loaded) if (gltf) disposeObject(gltf.scene);
    for (const f of this.fallbacks.values()) disposeObject(f);
    this.cache.clear();
    this.fallbacks.clear();
    this.glbGlow.clear();
    this.parametric.dispose();
  }
}
