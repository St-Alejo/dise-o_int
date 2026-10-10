import * as THREE from 'three';
import { disposeObject } from '../room-builder';
import type { SceneContext } from './render-loop';

export type GuideLayer = 'snap' | 'clearance' | 'measure';
export type Segment = readonly [{ x: number; y: number; z: number }, { x: number; y: number; z: number }];

const STYLE: Record<GuideLayer, { color: string; dashed: boolean }> = {
  snap: { color: '#1a73e8', dashed: false },
  clearance: { color: '#3f8f72', dashed: true },
  measure: { color: '#c62828', dashed: false },
};

/**
 * Líneas de ayuda sobre la escena: las guías de alineación mientras se arrastra, las cotas del
 * mueble seleccionado hasta las paredes y la regla. Cada capa se sustituye entera.
 */
export class GuidesView {
  private readonly root = new THREE.Group();
  private readonly layers = new Map<GuideLayer, THREE.LineSegments>();

  constructor(private readonly ctx: SceneContext) {
    this.root.name = 'guides';
    for (const layer of Object.keys(STYLE) as GuideLayer[]) {
      const { color, dashed } = STYLE[layer];
      const material = dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.06, depthTest: false })
        : new THREE.LineBasicMaterial({ color, depthTest: false });
      const lines = new THREE.LineSegments(new THREE.BufferGeometry(), material);
      lines.renderOrder = 998;
      lines.frustumCulled = false;
      lines.visible = false;
      this.layers.set(layer, lines);
      this.root.add(lines);
    }
    ctx.scene.add(this.root);
  }

  set(layer: GuideLayer, segments: readonly Segment[]): void {
    const lines = this.layers.get(layer)!;
    if (!segments.length && !lines.visible) return;
    lines.visible = segments.length > 0;
    const points = segments.flatMap(([a, b]) => [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
    lines.geometry.dispose();
    lines.geometry = new THREE.BufferGeometry().setFromPoints(points);
    if (STYLE[layer].dashed) lines.computeLineDistances();
    this.ctx.invalidate();
  }

  dispose(): void {
    this.ctx.scene.remove(this.root);
    disposeObject(this.root);
  }
}
