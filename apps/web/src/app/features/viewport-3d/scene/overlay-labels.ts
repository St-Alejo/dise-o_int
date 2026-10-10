import * as THREE from 'three';

export interface SceneLabel {
  /** Punto del mundo al que se pega el texto. */
  position: { x: number; y: number; z: number };
  text: string;
  /** Clase de estilo (`scene-label-<kind>` en los estilos globales). */
  kind: 'clearance' | 'measure';
}

/**
 * Textos y controles HTML pegados a puntos de la escena (una cota, la barra del mueble
 * seleccionado). Se recolocan al dibujar cada frame, tocando el DOM directamente: Angular no se
 * entera de los frames.
 */
export class OverlayLabels {
  private container: HTMLElement | null = null;
  private readonly groups = new Map<string, { labels: readonly SceneLabel[]; nodes: HTMLElement[] }>();
  private readonly anchors = new Map<HTMLElement, () => { x: number; y: number; z: number } | null>();
  private readonly projected = new THREE.Vector3();

  attach(container: HTMLElement | null): void {
    for (const group of this.groups.values()) for (const node of group.nodes) node.remove();
    for (const group of this.groups.values()) group.nodes = [];
    this.container = container;
  }

  /** Sustituye los textos de un grupo (las cotas, la regla). */
  set(key: string, labels: readonly SceneLabel[]): void {
    const group = this.groups.get(key) ?? { labels: [], nodes: [] };
    group.labels = labels;
    while (group.nodes.length > labels.length) group.nodes.pop()!.remove();
    this.groups.set(key, group);
  }

  /** Pega un elemento ya existente (creado por Angular) a un punto de la escena. */
  anchor(element: HTMLElement, position: (() => { x: number; y: number; z: number } | null) | null): void {
    if (position) this.anchors.set(element, position);
    else this.anchors.delete(element);
  }

  /** Recoloca todo según la cámara. `width` y `height` son el tamaño del visor en píxeles CSS. */
  update(camera: THREE.Camera, width: number, height: number): void {
    const place = (node: HTMLElement, p: { x: number; y: number; z: number } | null): void => {
      if (!p) {
        node.style.display = 'none';
        return;
      }
      this.projected.set(p.x, p.y, p.z).project(camera);
      const behind = this.projected.z > 1 || this.projected.z < -1;
      node.style.display = behind ? 'none' : '';
      node.style.left = `${((this.projected.x + 1) / 2) * width}px`;
      node.style.top = `${((1 - this.projected.y) / 2) * height}px`;
    };
    if (this.container) {
      for (const group of this.groups.values()) {
        group.labels.forEach((label, i) => {
          let node = group.nodes[i];
          if (!node) {
            node = document.createElement('span');
            this.container!.appendChild(node);
            group.nodes[i] = node;
          }
          node.className = `scene-label scene-label-${label.kind}`;
          if (node.textContent !== label.text) node.textContent = label.text;
          place(node, label.position);
        });
      }
    }
    for (const [element, position] of this.anchors) place(element, position());
  }
}
