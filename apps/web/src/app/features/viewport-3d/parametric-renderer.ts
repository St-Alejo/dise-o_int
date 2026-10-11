/**
 * Adapter three.js de `@interiores/furniture-kit`: convierte la geometría pura de una receta en
 * mallas, una por slot de material. Geometrías y materiales se comparten (Flyweight): diez sillas
 * iguales usan UNA geometría en la GPU y todas las piezas de roble, UN material.
 */
import { buildFurniture, modelKey, type MeshData } from '@interiores/furniture-kit';
import { getMaterial, type CatalogItem, type FurniturePlacement, type Vector3 } from '@interiores/shared-types';
import * as THREE from 'three';

/** Slots que se ven por dentro (pantallas de lámpara, cortinas): doble cara. */
const DOUBLE_SIDED = new Set(['pantalla', 'tejido']);
/** Slot que deja pasar la luz de la bombilla: la pantalla de una lámpara. */
const GLOW_SLOT = 'pantalla';

export function toBufferGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geom.computeBoundingSphere();
  return geom;
}

export type ParametricPlacement = Pick<FurniturePlacement, 'dimensionsM' | 'materials'>;

export class ParametricRenderer {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.Material>();
  /** Pantallas de lámpara: brillan más o menos según la hora. */
  private readonly glowing = new Set<THREE.MeshStandardMaterial>();
  private glow = 0;

  /** ¿Este ítem se dibuja con una receta (y no con un GLB)? */
  static supports(item: CatalogItem): boolean {
    return !!item.recipe;
  }

  create(item: CatalogItem, placement: ParametricPlacement = {}): THREE.Group {
    const recipe = item.recipe;
    if (!recipe) throw new Error(`${item.id} no es paramétrico`);
    const dims: Vector3 = placement.dimensionsM ?? item.dimensionsM;
    const model = buildFurniture(recipe.kind, dims, recipe.params);
    const key = modelKey(recipe.kind, dims, recipe.params);
    const group = new THREE.Group();
    group.name = item.id;
    for (const part of model.slots) {
      const geomKey = `${key}#${part.slot}`;
      let geom = this.geometries.get(geomKey);
      if (!geom) {
        geom = toBufferGeometry(part.mesh);
        this.geometries.set(geomKey, geom);
      }
      const materialId = placement.materials?.[part.slot] ?? item.materialSlots?.find((s) => s.slot === part.slot)?.default ?? 'wood-oak';
      const mesh = new THREE.Mesh(geom, this.material(materialId, part.slot));
      mesh.name = part.slot;
      mesh.userData['slot'] = part.slot;
      group.add(mesh);
    }
    return group;
  }

  material(id: string, slot: string): THREE.Material {
    const glows = slot === GLOW_SLOT;
    const key = `${id}|${DOUBLE_SIDED.has(slot) ? 2 : 1}${glows ? '|luz' : ''}`;
    let mat = this.materials.get(key);
    if (mat) return mat;
    const def = getMaterial(id);
    const color = new THREE.Color(def?.color ?? '#999999');
    const roughness = def?.roughness ?? 0.8;
    const metalness = def?.metalness ?? 0;
    if (def?.kind === 'glass') {
      mat = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false });
    } else if (def?.kind === 'fabric' && !glows) {
      // La tela devuelve una luz suave en los bordes (la pelusa): sin eso parece plástico mate.
      mat = new THREE.MeshPhysicalMaterial({ color, roughness, metalness, sheen: 0.7, sheenRoughness: 0.7, sheenColor: color.clone().lerp(new THREE.Color('#ffffff'), 0.55) });
    } else if (def?.kind === 'leather' || def?.kind === 'ceramic') {
      // Cuero y cerámica llevan una capa lisa encima: brillo fino sobre un fondo mate.
      mat = new THREE.MeshPhysicalMaterial({ color, roughness, metalness, clearcoat: def.kind === 'ceramic' ? 0.6 : 0.25, clearcoatRoughness: 0.35 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    }
    if (DOUBLE_SIDED.has(slot)) mat.side = THREE.DoubleSide;
    if (glows) {
      const shade = mat as THREE.MeshStandardMaterial;
      shade.emissive = new THREE.Color('#ffd9a8').multiply(color);
      shade.emissiveIntensity = this.glow;
      this.glowing.add(shade);
    }
    mat.name = id;
    this.materials.set(key, mat);
    return mat;
  }

  /** Enciende o atenúa las pantallas de lámpara (de noche son lo que más se ve). */
  setGlow(intensity: number): void {
    this.glow = intensity;
    for (const shade of this.glowing) shade.emissiveIntensity = intensity;
  }

  /** Libera geometrías y materiales compartidos (al cerrar el editor). */
  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.glowing.clear();
  }

  get stats(): { geometries: number; materials: number } {
    return { geometries: this.geometries.size, materials: this.materials.size };
  }
}
