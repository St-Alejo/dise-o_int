import * as THREE from 'three';
import type { GizmoHandleKind, GizmoLayout } from '../mounts/gizmo-math';
import { disposeObject } from '../room-builder';
import type { SceneContext } from './render-loop';

const COLOR = { rotate: '#d49a79', size: '#3f8f72', hover: '#1a73e8' };
/** Tamaño de un tirador a un metro de la cámara: se escala con la distancia para verse siempre igual. */
const HANDLE_PER_METRE = 0.016;

/**
 * El gizmo de la pieza seleccionada: un aro en el piso para girarla y tiradores para cambiar su
 * ancho, fondo y alto (o su altura si está colgada). Solo dibuja y dice qué tirador hay bajo el
 * cursor; la matemática está en `mounts/gizmo-math.ts` y el gesto en `GizmoController`.
 */
export class GizmoView {
  private readonly root = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly handles = new Map<GizmoHandleKind, THREE.Mesh>();
  private layout: GizmoLayout | null = null;
  private highlighted: GizmoHandleKind | null = null;

  constructor(private readonly ctx: SceneContext) {
    this.root.name = 'gizmo';
    this.root.visible = false;
    this.root.renderOrder = 1000;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 72), this.material(COLOR.rotate, 0.75));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.renderOrder = 1000;
    this.root.add(this.ring);
    const sphere = new THREE.SphereGeometry(1, 20, 14);
    const box = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    for (const kind of ['rotate', 'width', 'depth', 'height', 'elevation'] as const) {
      const mesh = new THREE.Mesh(kind === 'rotate' ? sphere : box, this.material(kind === 'rotate' ? COLOR.rotate : COLOR.size, 1));
      mesh.userData['handle'] = kind;
      mesh.renderOrder = 1001;
      this.handles.set(kind, mesh);
      this.root.add(mesh);
    }
    ctx.scene.add(this.root);
  }

  /** Coloca el gizmo (o lo oculta con `null`). */
  update(layout: GizmoLayout | null): void {
    this.layout = layout;
    this.root.visible = !!layout;
    if (layout) {
      this.ring.visible = layout.ringRadius > 0;
      this.ring.position.set(layout.centre.x, layout.centre.y + 0.02, layout.centre.z);
      this.ring.scale.set(layout.ringRadius, layout.ringRadius, 1);
      for (const [kind, mesh] of this.handles) {
        const handle = layout.handles.find((h) => h.kind === kind);
        mesh.visible = !!handle;
        if (handle) mesh.position.set(handle.position.x, handle.position.y, handle.position.z);
      }
      this.rescale();
    }
    this.ctx.invalidate();
  }

  /** Los tiradores mantienen su tamaño en pantalla al acercar o alejar la cámara. */
  rescale(): void {
    if (!this.layout) return;
    for (const mesh of this.handles.values()) {
      if (!mesh.visible) continue;
      const size = Math.max(0.03, mesh.position.distanceTo(this.ctx.camera.position) * HANDLE_PER_METRE);
      mesh.scale.setScalar(size);
    }
  }

  /** Tirador bajo el rayo (el más cercano), o null. */
  pick(raycaster: THREE.Raycaster): GizmoHandleKind | null {
    if (!this.root.visible) return null;
    const meshes = [...this.handles.values()].filter((m) => m.visible);
    // Zona de agarre más generosa que lo que se ve: un tirador pequeño no debe ser difícil de atinar.
    for (const m of meshes) m.scale.multiplyScalar(1.8);
    for (const m of meshes) m.updateMatrixWorld(true);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    for (const m of meshes) m.scale.multiplyScalar(1 / 1.8);
    for (const m of meshes) m.updateMatrixWorld(true);
    return hit ? (hit.object.userData['handle'] as GizmoHandleKind) : null;
  }

  /** Resalta el tirador que se está usando o que tiene el cursor encima. */
  highlight(kind: GizmoHandleKind | null): void {
    if (kind === this.highlighted) return;
    this.highlighted = kind;
    for (const [k, mesh] of this.handles) {
      (mesh.material as THREE.MeshBasicMaterial).color.set(k === kind ? COLOR.hover : k === 'rotate' ? COLOR.rotate : COLOR.size);
    }
    this.ctx.invalidate();
  }

  /** Posición de cada tirador visible (para proyectarla a pantalla en las pruebas). */
  handlePositions(): { kind: GizmoHandleKind; position: THREE.Vector3 }[] {
    if (!this.root.visible) return [];
    return [...this.handles].filter(([, m]) => m.visible).map(([kind, m]) => ({ kind, position: m.position.clone() }));
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    disposeObject(this.root);
  }

  private material(color: string, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity });
  }
}
