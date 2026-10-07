/**
 * Builder + Composite de muebles.
 *
 * Una receta describe el mueble pieza a pieza (`box`, `cylinder`, `lathe`...) indicando a qué
 * **slot de material** pertenece cada una. Las piezas se pueden agrupar (`group`) con su propia
 * transformación, y los grupos se anidan: un cajón es un grupo, una cómoda es un grupo de
 * cajones (Composite). Al final `build()` fusiona las piezas por slot, así el render dibuja una
 * malla por material y cambiar la tela de un sofá es cambiar UN material.
 */
import {
  MeshAccumulator,
  box,
  composeTransforms,
  cylinder,
  lathe,
  meshBounds,
  roundedBox,
  sphere,
  wavyPanel,
  type Bounds,
  type MeshData,
  type Transform,
  type Vec3,
} from './mesh.js';

export interface SlotMesh {
  slot: string;
  mesh: MeshData;
}

export interface FurnitureModel {
  kind: string;
  slots: SlotMesh[];
  bounds: Bounds;
  triangleCount: number;
}

/** Posición de una pieza: centro en X/Z y BASE en Y (más natural para apilar). */
export type At = [x: number, yBase: number, z: number];

export class FurnitureBuilder {
  private readonly slots = new Map<string, MeshAccumulator>();
  private readonly stack: Transform[] = [{}];

  constructor(readonly kind: string) {}

  private get current(): Transform {
    return this.stack[this.stack.length - 1]!;
  }

  /** Pieza genérica (cualquier MeshData) en un slot. */
  add(slot: string, mesh: MeshData, transform: Transform = {}): this {
    let acc = this.slots.get(slot);
    if (!acc) {
      acc = new MeshAccumulator();
      this.slots.set(slot, acc);
    }
    acc.append(mesh, composeTransforms(this.current, transform));
    return this;
  }

  /** Composite: las piezas añadidas dentro de `fn` heredan la transformación del grupo. */
  group(transform: Transform, fn: (b: this) => void): this {
    this.stack.push(composeTransforms(this.current, transform));
    try {
      fn(this);
    } finally {
      this.stack.pop();
    }
    return this;
  }

  box(slot: string, w: number, h: number, d: number, at: At, radius = 0, rotationY = 0): this {
    if (w <= 0 || h <= 0 || d <= 0) return this;
    return this.add(slot, radius > 0 ? roundedBox(w, h, d, radius) : box(w, h, d), { position: at, rotationY });
  }

  cylinder(slot: string, rBottom: number, rTop: number, h: number, at: At, segments = 20, scaleZ = 1): this {
    if (h <= 0) return this;
    return this.add(slot, cylinder(rBottom, rTop, h, segments, scaleZ), { position: at });
  }

  lathe(slot: string, profile: [number, number][], at: At, segments = 24, scaleZ = 1): this {
    return this.add(slot, lathe(profile, segments, scaleZ), { position: at });
  }

  sphere(slot: string, rx: number, ry: number, rz: number, at: At, segments = 16): this {
    return this.add(slot, sphere(rx, ry, rz, segments), { position: at });
  }

  /** Disco vertical que mira a +Z (espejos, relojes): `at` es su centro y la cara trasera queda en z. */
  disc(slot: string, radius: number, thickness: number, at: Vec3, segments = 32, scaleY = 1): this {
    // Cilindro de eje Y girado −90° en X: su base (y = 0) queda en z = 0 y crece hacia +Z.
    return this.add(slot, cylinder(radius, radius, thickness, segments, scaleY), { position: at, rotationX: Math.PI / 2 });
  }

  wavyPanel(slot: string, w: number, h: number, depth: number, folds: number, at: At): this {
    return this.add(slot, wavyPanel(w, h, depth, folds, 8), { position: at });
  }

  build(): FurnitureModel {
    const slots = [...this.slots.entries()]
      .map(([slot, acc]) => ({ slot, mesh: acc.build() }))
      .filter((s) => s.mesh.indices.length > 0);
    return {
      kind: this.kind,
      slots,
      bounds: meshBounds(slots.map((s) => s.mesh)),
      triangleCount: slots.reduce((acc, s) => acc + s.mesh.indices.length / 3, 0),
    };
  }
}
