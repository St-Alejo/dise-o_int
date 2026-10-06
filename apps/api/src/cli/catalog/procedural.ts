/**
 * Generador procedural de muebles (Factory): produce GLB válidos a escala real a partir
 * de cajas. Convención igual que glTF/Poly Haven: +Y arriba, el frente mira a +Z,
 * base en y = 0 y centrado en X/Z.
 */
import { Document, NodeIO, type Material, type Mesh, type Node } from '@gltf-transform/core';
import type { ProceduralKind } from './manifest.js';

type Vec3 = [number, number, number];

/** Cubo unitario centrado en el origen (24 vértices para normales planas). */
function unitBoxData() {
  const faces: { n: Vec3; v: Vec3[] }[] = [
    { n: [1, 0, 0], v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, 1, 0], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
    { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach((f, i) => {
    for (const v of f.v) {
      positions.push(...v);
      normals.push(...f.n);
    }
    const o = i * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

function hexToLinear(hex: string): [number, number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const lin = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [lin[0]!, lin[1]!, lin[2]!, 1];
}

class BoxBuilder {
  readonly doc = new Document();
  private readonly root: Node;
  private readonly meshes = new Map<string, Mesh>();
  private readonly buffer = this.doc.createBuffer();
  private readonly box = unitBoxData();

  constructor(name: string) {
    this.root = this.doc.createNode(name);
    this.doc.createScene(name).addChild(this.root);
  }

  private meshFor(color: string, roughness: number): Mesh {
    const key = `${color}-${roughness}`;
    let mesh = this.meshes.get(key);
    if (mesh) return mesh;
    const material: Material = this.doc
      .createMaterial(`m-${color}`)
      .setBaseColorFactor(hexToLinear(color))
      .setRoughnessFactor(roughness)
      .setMetallicFactor(0);
    const prim = this.doc
      .createPrimitive()
      .setAttribute('POSITION', this.doc.createAccessor().setType('VEC3').setArray(this.box.positions).setBuffer(this.buffer))
      .setAttribute('NORMAL', this.doc.createAccessor().setType('VEC3').setArray(this.box.normals).setBuffer(this.buffer))
      .setIndices(this.doc.createAccessor().setType('SCALAR').setArray(this.box.indices).setBuffer(this.buffer))
      .setMaterial(material);
    mesh = this.doc.createMesh(`box-${color}`).addPrimitive(prim);
    this.meshes.set(key, mesh);
    return mesh;
  }

  /** Añade una caja por su tamaño y el centro de su base (x, yBase, z). */
  add(size: Vec3, base: Vec3, color: string, roughness = 0.8): this {
    const node = this.doc
      .createNode()
      .setMesh(this.meshFor(color, roughness))
      .setScale(size)
      .setTranslation([base[0], base[1] + size[1] / 2, base[2]]);
    this.root.addChild(node);
    return this;
  }
}

export async function buildProceduralGlb(
  name: string,
  kind: ProceduralKind,
  [w, h, d]: Vec3,
  colors: string[],
): Promise<Uint8Array> {
  const c = (i: number) => colors[Math.min(i, colors.length - 1)] ?? '#999999';
  const b = new BoxBuilder(name);
  const leg = 0.05;
  const legs = (height: number, color: string, inset = 0.04) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.add([leg, height, leg], [sx * (w / 2 - inset - leg / 2), 0, sz * (d / 2 - inset - leg / 2)], color);
    }
  };

  switch (kind) {
    case 'sofa-block': {
      const seatH = h * 0.45;
      b.add([w, seatH, d], [0, 0.08, 0], c(0));
      b.add([w, h - 0.08, d * 0.22], [0, 0.08, -d / 2 + d * 0.11], c(0));
      b.add([0.16, h * 0.62, d], [-w / 2 + 0.08, 0.08, 0], c(0));
      b.add([0.16, h * 0.62, d], [w / 2 - 0.08, 0.08, 0], c(0));
      legs(0.08, c(1), 0.05);
      break;
    }
    case 'coffee-table-block':
    case 'dining-table-block':
    case 'desk': {
      const top = 0.035;
      b.add([w, top, d], [0, h - top, 0], c(0), 0.6);
      legs(h - top, c(1));
      if (kind === 'desk') b.add([w * 0.35, h * 0.35, d * 0.9], [w / 2 - w * 0.2, h - top - h * 0.35, 0], c(1));
      break;
    }
    case 'chair-block': {
      const seat = 0.46;
      b.add([w, 0.05, d], [0, seat - 0.05, 0], c(0));
      b.add([w, h - seat, 0.04], [0, seat, -d / 2 + 0.02], c(0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add([0.035, seat - 0.05, 0.035], [sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03)], c(1));
      break;
    }
    case 'bed-platform':
    case 'bed-upholstered': {
      const frameH = 0.3;
      b.add([w, frameH, d], [0, 0.05, 0], c(0));
      b.add([w - 0.06, 0.22, d - 0.1], [0, 0.05 + frameH, 0.03], c(1), 0.95);
      b.add([w * 0.38, 0.12, 0.35], [-w * 0.22, 0.05 + frameH + 0.22, -d / 2 + 0.3], c(1), 0.95);
      b.add([w * 0.38, 0.12, 0.35], [w * 0.22, 0.05 + frameH + 0.22, -d / 2 + 0.3], c(1), 0.95);
      b.add([w - 0.02, 0.05, d * 0.45], [0, 0.05 + frameH + 0.22, d * 0.2], c(2), 0.95);
      b.add([w, h, kind === 'bed-upholstered' ? 0.12 : 0.05], [0, 0, -d / 2 + 0.04], c(0));
      legs(0.05, c(0), 0.08);
      break;
    }
    case 'rug':
      b.add([w, Math.max(h, 0.01), d], [0, 0, 0], c(0), 1);
      break;
    case 'floor-lamp':
      b.add([0.3, 0.03, 0.3], [0, 0, 0], c(0), 0.4);
      b.add([0.03, h - 0.35, 0.03], [0, 0.03, 0], c(0), 0.4);
      b.add([w, 0.32, d], [0, h - 0.32, 0], c(1), 0.9);
      break;
    case 'bookshelf': {
      const t = 0.025;
      b.add([t, h, d], [-w / 2 + t / 2, 0, 0], c(0));
      b.add([t, h, d], [w / 2 - t / 2, 0, 0], c(0));
      b.add([w, h, t], [0, 0, -d / 2 + t / 2], c(0));
      const shelves = Math.max(3, Math.round(h / 0.38));
      for (let i = 0; i <= shelves; i++) b.add([w, t, d], [0, (i * (h - t)) / shelves, 0], c(0));
      if (colors[1]) for (let i = 1; i < shelves; i += 2) b.add([w * 0.5, 0.22, d * 0.7], [-w * 0.15, (i * (h - t)) / shelves + t, 0], c(1));
      break;
    }
    case 'plant':
      b.add([w * 0.6, h * 0.3, d * 0.6], [0, 0, 0], c(0), 0.7);
      b.add([w, h * 0.45, d], [0, h * 0.3, 0], c(1), 1);
      b.add([w * 0.6, h * 0.25, d * 0.6], [0, h * 0.75, 0], c(1), 1);
      break;
  }
  return new NodeIO().writeBinary(b.doc);
}
