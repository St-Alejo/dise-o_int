import { effectiveDimensions, footprint, type CatalogItem, type FurniturePlacement, type Vector3 } from '@interiores/shared-types';
import * as THREE from 'three';
import { disposeObject } from '../room-builder';
import type { SceneContext } from './render-loop';

const COLORS = { select: new THREE.Color('#d49a79'), invalid: new THREE.Color('#e53935') };

export interface SelectionTarget {
  placement: FurniturePlacement;
  item: CatalogItem;
  /** Pose provisional mientras se arrastra (si no, la de la pieza). */
  pose?: { position: Vector3; rotationY: number } | null;
  invalid?: boolean;
}

/** Contorno de la pieza seleccionada: su huella en planta, roja si la pose no es válida. */
export class SelectionView {
  private readonly outline: THREE.LineLoop;

  constructor(private readonly ctx: SceneContext) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    this.outline = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: COLORS.select, depthTest: false }));
    this.outline.renderOrder = 999;
    this.outline.visible = false;
    ctx.scene.add(this.outline);
  }

  update(target: SelectionTarget | null): void {
    this.outline.visible = !!target;
    if (target) {
      const { placement, item, pose, invalid } = target;
      const pos = pose?.position ?? placement.position;
      const fp = footprint(pos, effectiveDimensions(item.dimensionsM, placement), pose?.rotationY ?? placement.rotationY);
      // El contorno va a la base de la pieza: en el piso, en la pared o sobre su soporte.
      const y = item.mount === 'ceiling' ? 0.02 : item.mount === 'floor' ? 0.015 : pos.y + 0.005;
      const attr = this.outline.geometry.getAttribute('position') as THREE.BufferAttribute;
      fp.corners.forEach((c, i) => attr.setXYZ(i, c.x, y, c.z));
      attr.needsUpdate = true;
      this.outline.geometry.computeBoundingSphere();
      (this.outline.material as THREE.LineBasicMaterial).color = invalid ? COLORS.invalid : COLORS.select;
    }
    this.ctx.invalidate();
  }

  dispose(): void {
    disposeObject(this.outline);
  }
}
