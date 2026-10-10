import type { CatalogItem, FurniturePlacement, Vector3 } from '@interiores/shared-types';
import * as THREE from 'three';
import { FurnitureFactory } from '../furniture-factory';
import type { SceneContext } from './render-loop';

interface FurnitureNode {
  group: THREE.Group;
  catalogItemId: string;
  /** Medidas y materiales con los que se construyó: si cambian, se reconstruye el objeto. */
  shapeKey: string;
}

/** Lo que define la forma visible de una pieza (además de su mueble del catálogo). */
const shapeKeyOf = (p: FurniturePlacement) => JSON.stringify([p.dimensionsM ?? null, p.materials ?? null]);

/** Los muebles en la escena: reconcilia los nodos con la lista de piezas, por id. */
export class FurnitureView {
  private readonly root = new THREE.Group();
  private readonly nodes = new Map<string, FurnitureNode>();
  private readonly factory = new FurnitureFactory();
  private disposed = false;

  /** `onLoaded` avisa cuando termina de construirse el modelo de una pieza. */
  constructor(
    private readonly ctx: SceneContext,
    private readonly onLoaded: () => void,
  ) {
    this.root.name = 'furniture';
    ctx.scene.add(this.root);
  }

  get count(): number {
    return this.nodes.size;
  }

  /** `isHeld` marca las piezas que se están arrastrando: su posición la lleva el arrastre. */
  sync(placements: readonly FurniturePlacement[], catalog: ReadonlyMap<string, CatalogItem>, isHeld: (id: string) => boolean): void {
    const byId = new Map(placements.map((p) => [p.id, p]));
    for (const [id, node] of this.nodes) {
      const p = byId.get(id);
      if (!p || p.catalogItemId !== node.catalogItemId || shapeKeyOf(p) !== node.shapeKey) {
        this.root.remove(node.group);
        this.nodes.delete(id);
      }
    }
    for (const p of placements) {
      const item = catalog.get(p.catalogItemId);
      if (!item) continue;
      const node = this.nodes.get(p.id) ?? this.createNode(p, item);
      if (!isHeld(p.id)) this.applyTransform(node.group, p.position, p.rotationY);
    }
    this.ctx.invalidate();
  }

  /** Mueve una pieza en la escena sin tocar el estado (vista previa mientras se arrastra). */
  place(id: string, position: Vector3, rotationY: number): void {
    const node = this.nodes.get(id);
    if (node) this.applyTransform(node.group, position, rotationY);
  }

  /** Id de la pieza más cercana bajo el rayo, o null. */
  pick(raycaster: THREE.Raycaster): string | null {
    for (const hit of raycaster.intersectObjects(this.root.children, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData['placementId'] === undefined) o = o.parent;
      if (o) return o.userData['placementId'] as string;
    }
    return null;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const node of this.nodes.values()) this.root.remove(node.group);
    this.nodes.clear();
    await this.factory.dispose();
  }

  private createNode(p: FurniturePlacement, item: CatalogItem): FurnitureNode {
    const group = new THREE.Group();
    group.userData['placementId'] = p.id;
    const node: FurnitureNode = { group, catalogItemId: p.catalogItemId, shapeKey: shapeKeyOf(p) };
    this.nodes.set(p.id, node);
    this.root.add(group);
    void this.factory.create(item, p).then((object) => {
      if (this.disposed || this.nodes.get(p.id) !== node) return;
      group.add(object);
      this.onLoaded();
      this.ctx.invalidate();
    });
    return node;
  }

  private applyTransform(group: THREE.Object3D, position: Vector3, rotationY: number): void {
    group.position.set(position.x, position.y, position.z);
    group.rotation.set(0, rotationY, 0);
  }
}
