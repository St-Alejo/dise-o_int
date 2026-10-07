/**
 * Geometría pura (sin three.js): triángulos indexados con normales. Los adaptadores la
 * convierten en BufferGeometry (web) o en primitivas glTF (seed), así que ambos lados
 * dibujan exactamente lo mismo.
 *
 * Convención (igual que glTF): +Y arriba, el frente del mueble mira a +Z, metros.
 */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export type Vec3 = [number, number, number];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Acumula triángulos; se usa para construir primitivas y para fusionar piezas por slot. */
export class MeshAccumulator {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly i: number[] = [];

  get vertexCount(): number {
    return this.p.length / 3;
  }

  vertex(pos: Vec3, normal: Vec3): number {
    this.p.push(pos[0], pos[1], pos[2]);
    this.n.push(normal[0], normal[1], normal[2]);
    return this.vertexCount - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.i.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.i.push(a, b, c, a, c, d);
  }

  /** Copia una malla aplicando la transformación (giro en X, luego en Y, luego traslación). */
  append(mesh: MeshData, transform: Transform = {}): void {
    const base = this.vertexCount;
    const [tx, ty, tz] = transform.position ?? [0, 0, 0];
    const rx = transform.rotationX ?? 0;
    const ry = transform.rotationY ?? 0;
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    // Misma convención que three.js: rotación X (y,z) → (y·c − z·s, y·s + z·c);
    // rotación Y (x,z) → (x·c + z·s, −x·s + z·c).
    const rotate = (x: number, y: number, z: number): Vec3 => {
      const y1 = y * cx - z * sx;
      const z1 = y * sx + z * cx;
      return [x * cy + z1 * sy, y1, -x * sy + z1 * cy];
    };
    for (let k = 0; k < mesh.positions.length; k += 3) {
      const [x, y, z] = rotate(mesh.positions[k]!, mesh.positions[k + 1]!, mesh.positions[k + 2]!);
      this.p.push(x + tx, y + ty, z + tz);
      const [nx, ny, nz] = rotate(mesh.normals[k]!, mesh.normals[k + 1]!, mesh.normals[k + 2]!);
      this.n.push(nx, ny, nz);
    }
    for (const idx of mesh.indices) this.i.push(idx + base);
  }

  build(): MeshData {
    return { positions: new Float32Array(this.p), normals: new Float32Array(this.n), indices: new Uint32Array(this.i) };
  }
}

export interface Transform {
  position?: Vec3;
  rotationX?: number;
  rotationY?: number;
}

/** Compone transformaciones (padre ∘ hijo): así funcionan los grupos anidados del Builder. */
export function composeTransforms(parent: Transform, child: Transform): Transform {
  // Solo se componen giros en Y entre niveles (los giros en X se usan en hojas: discos de pared).
  const ry = parent.rotationY ?? 0;
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const [x, y, z] = child.position ?? [0, 0, 0];
  const [px, py, pz] = parent.position ?? [0, 0, 0];
  return {
    position: [x * c + z * s + px, y + py, -x * s + z * c + pz],
    rotationY: ry + (child.rotationY ?? 0),
    ...(child.rotationX !== undefined ? { rotationX: child.rotationX } : {}),
  };
}

export function meshBounds(meshes: MeshData[]): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    for (let k = 0; k < m.positions.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        const v = m.positions[k + a]!;
        if (v < min[a]!) min[a] = v;
        if (v > max[a]!) max[a] = v;
      }
    }
  }
  return { min, max };
}

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// ---------------------------------------------------------------------------
// Primitivas. Todas centradas en X/Z; las cajas y cilindros tienen la base en y = 0
// para que las recetas las apilen sin cuentas.
// ---------------------------------------------------------------------------

/** Caja con la base en y = 0. 24 vértices: normales planas por cara. */
export function box(w: number, h: number, d: number): MeshData {
  return roundedBox(w, h, d, 0);
}

/**
 * Caja con aristas redondeadas de radio `r` (cojines, tapizados, cubiertas). Cada cara es una
 * rejilla con `seg` subdivisiones en la banda del borde; los vértices se proyectan sobre la
 * esfera del radio desde la caja interior, igual que RoundedBoxGeometry de three.js.
 */
export function roundedBox(w: number, h: number, d: number, r: number, seg = 3): MeshData {
  const half: Vec3 = [w / 2, h / 2, d / 2];
  const radius = Math.max(0, Math.min(r, ...half.map((v) => v * 0.999)));
  const acc = new MeshAccumulator();
  const coords = (hv: number): number[] => {
    if (radius === 0) return [-hv, hv];
    const out: number[] = [];
    for (let k = 0; k <= seg; k++) out.push(-hv + (radius * k) / seg);
    for (let k = 0; k <= seg; k++) out.push(hv - radius + (radius * k) / seg);
    return out.filter((v, idx, arr) => idx === 0 || Math.abs(v - arr[idx - 1]!) > 1e-9);
  };
  // Cada cara: eje normal `a` con signo, ejes del plano (u, v) elegidos para que el giro sea antihorario.
  const faces: { a: 0 | 1 | 2; sign: 1 | -1; u: 0 | 1 | 2; v: 0 | 1 | 2 }[] = [
    { a: 0, sign: 1, u: 2, v: 1 },
    { a: 0, sign: -1, u: 1, v: 2 },
    { a: 1, sign: 1, u: 0, v: 2 },
    { a: 1, sign: -1, u: 2, v: 0 },
    { a: 2, sign: 1, u: 1, v: 0 },
    { a: 2, sign: -1, u: 0, v: 1 },
  ];
  for (const f of faces) {
    const us = coords(half[f.u]);
    const vs = coords(half[f.v]);
    const start = acc.vertexCount;
    for (const vv of vs) {
      for (const uu of us) {
        const p: Vec3 = [0, 0, 0];
        p[f.a] = f.sign * half[f.a];
        p[f.u] = uu;
        p[f.v] = vv;
        // Proyección sobre la caja interior + radio.
        const inner: Vec3 = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const lim = half[k]! - radius;
          inner[k] = Math.max(-lim, Math.min(lim, p[k]!));
        }
        const dir: Vec3 = [p[0] - inner[0], p[1] - inner[1], p[2] - inner[2]];
        const len = Math.hypot(...dir);
        const n: Vec3 = len > 1e-9 ? normalize(dir) : (() => {
          const fn: Vec3 = [0, 0, 0];
          fn[f.a] = f.sign;
          return fn;
        })();
        const pos: Vec3 = radius > 0 && len > 1e-9 ? [inner[0] + n[0] * radius, inner[1] + n[1] * radius, inner[2] + n[2] * radius] : p;
        const flat: Vec3 = [0, 0, 0];
        flat[f.a] = f.sign;
        acc.vertex([pos[0], pos[1] + half[1], pos[2]], radius > 0 ? n : flat);
      }
    }
    const cols = us.length;
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = start + j * cols + i;
        // Antihorario visto desde afuera: la normal geométrica coincide con la de la cara.
        acc.quad(a, a + cols, a + cols + 1, a + 1);
      }
    }
  }
  return acc.build();
}

/**
 * Sólido de revolución alrededor de Y a partir de un perfil [radio, y] (de abajo hacia arriba).
 * Sirve para patas torneadas, macetas, jarrones, pantallas de lámpara, inodoros...
 * Las normales se calculan con la tangente del perfil (sombreado suave).
 */
export function lathe(profile: [number, number][], segments = 24, scaleZ = 1): MeshData {
  // Múltiplo de 4: así hay vértices exactamente en ±X y ±Z y el mueble mide lo que dice.
  segments = Math.max(4, Math.ceil(segments / 4) * 4);
  const acc = new MeshAccumulator();
  const rows = profile.length;
  for (let j = 0; j < rows; j++) {
    const prev = profile[Math.max(0, j - 1)]!;
    const next = profile[Math.min(rows - 1, j + 1)]!;
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    // Normal del perfil (perpendicular a la tangente, hacia afuera).
    const nl = Math.hypot(dy, dr) || 1;
    const nr = dy / nl;
    const ny = -dr / nl;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const [r, y] = profile[j]!;
      acc.vertex([r * s, y, r * c * scaleZ], normalize([nr * s, ny, (nr * c) / (scaleZ || 1)]));
    }
  }
  const cols = segments + 1;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * cols + i;
      acc.quad(a, a + 1, a + cols + 1, a + cols);
    }
  }
  return acc.build();
}

/** Cilindro (o cono truncado) con tapas, base en y = 0. `scaleZ` lo vuelve elíptico. */
export function cylinder(radiusBottom: number, radiusTop: number, h: number, segments = 24, scaleZ = 1): MeshData {
  segments = Math.max(4, Math.ceil(segments / 4) * 4);
  const acc = new MeshAccumulator();
  acc.append(lathe([[radiusBottom, 0], [radiusTop, h]], segments, scaleZ));
  // Tapas planas (abanico).
  for (const [r, y, ny] of [[radiusBottom, 0, -1], [radiusTop, h, 1]] as const) {
    if (r <= 0) continue;
    const center = acc.vertex([0, y, 0], [0, ny, 0]);
    const ring: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      ring.push(acc.vertex([r * Math.sin(t), y, r * Math.cos(t) * scaleZ], [0, ny, 0]));
    }
    for (let i = 0; i < segments; i++) {
      if (ny > 0) acc.triangle(center, ring[i]!, ring[i + 1]!);
      else acc.triangle(center, ring[i + 1]!, ring[i]!);
    }
  }
  return acc.build();
}

/** Esfera (o elipsoide) apoyada en y = 0. */
export function sphere(rx: number, ry: number, rz: number, segments = 16): MeshData {
  const profile: [number, number][] = [];
  const rings = Math.max(6, Math.ceil(segments / 4) * 2); // par: hay un anillo en el ecuador
  for (let k = 0; k <= rings; k++) {
    const phi = (k / rings) * Math.PI; // 0 = abajo
    profile.push([Math.sin(phi) * rx, ry - Math.cos(phi) * ry]);
  }
  return lathe(profile, segments, rz / (rx || 1));
}

/**
 * Panel vertical ondulado (cortinas): ancho `w` en X, alto `h`, `folds` pliegues de amplitud
 * `depth`. Doble cara para que se vea desde ambos lados. La base está en y = 0.
 */
export function wavyPanel(w: number, h: number, depth: number, folds: number, segmentsPerFold = 6): MeshData {
  const acc = new MeshAccumulator();
  const cols = Math.max(2, folds * segmentsPerFold);
  const amp = depth / 2;
  for (const side of [1, -1]) {
    const start = acc.vertexCount;
    for (const y of [0, h]) {
      for (let i = 0; i <= cols; i++) {
        const t = i / cols;
        const x = -w / 2 + w * t;
        const phase = t * folds * Math.PI * 2;
        const z = Math.sin(phase) * amp;
        const dz = Math.cos(phase) * amp * folds * Math.PI * 2 / w;
        const n = normalize([-dz * side, 0, side]);
        acc.vertex([x, y, z], n);
      }
    }
    const row = cols + 1;
    for (let i = 0; i < cols; i++) {
      const a = start + i;
      if (side > 0) acc.quad(a, a + 1, a + row + 1, a + row);
      else acc.quad(a, a + row, a + row + 1, a + 1);
    }
  }
  return acc.build();
}
