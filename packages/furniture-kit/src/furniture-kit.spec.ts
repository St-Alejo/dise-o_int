import { describe, expect, it } from 'vitest';
import { FurnitureBuilder } from './builder.js';
import { FURNITURE, buildFurniture } from './catalog.js';
import { box, cylinder, lathe, meshBounds, roundedBox, sphere, wavyPanel, type MeshData } from './mesh.js';
import { RecipeRegistry, UnknownRecipeError, clearModelCache, modelKey } from './registry.js';

const TOL = 0.01; // 1 cm

/** Proporción de triángulos cuya normal geométrica apunta como las normales de sus vértices. */
function windingAgreement(m: MeshData): number {
  let ok = 0;
  let total = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
    const p = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
    const e2 = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const area = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (area < 1e-10) continue; // triángulos degenerados (polos del torno)
    const vn = [0, 1, 2].map((k) => m.normals[a * 3 + k]! + m.normals[b * 3 + k]! + m.normals[c * 3 + k]!);
    total++;
    if (n[0]! * vn[0]! + n[1]! * vn[1]! + n[2]! * vn[2]! > 0) ok++;
  }
  return total ? ok / total : 1;
}

function expectFinite(m: MeshData) {
  for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
  for (const v of m.normals) expect(Number.isFinite(v)).toBe(true);
  for (const i of m.indices) expect(i).toBeLessThan(m.positions.length / 3);
}

describe('primitivas', () => {
  it('caja y caja redondeada ocupan exactamente sus medidas, con la base en y = 0', () => {
    for (const m of [box(1, 2, 3), roundedBox(1, 2, 3, 0.1)]) {
      const b = meshBounds([m]);
      expect(b.min).toEqual([-0.5, 0, -1.5].map((v) => expect.closeTo(v, 5)));
      expect(b.max).toEqual([0.5, 2, 1.5].map((v) => expect.closeTo(v, 5)));
    }
  });

  it('todas las primitivas tienen las caras hacia afuera (normales coherentes con el giro)', () => {
    const meshes = {
      box: box(1, 1, 1),
      roundedBox: roundedBox(1, 0.5, 0.8, 0.1),
      cylinder: cylinder(0.3, 0.2, 1),
      lathe: lathe([[0.2, 0], [0.4, 0.5], [0.1, 1]]),
      sphere: sphere(0.3, 0.4, 0.2),
      wavyPanel: wavyPanel(1, 2, 0.1, 4),
    };
    for (const [name, m] of Object.entries(meshes)) {
      expectFinite(m);
      expect(windingAgreement(m), name).toBeGreaterThan(0.98);
    }
  });

  it('el panel ondulado alcanza su profundidad completa (las cortinas no quedan cortas)', () => {
    const b = meshBounds([wavyPanel(1, 2, 0.2, 3, 8)]);
    expect(b.max[2]).toBeCloseTo(0.1, 5);
    expect(b.min[2]).toBeCloseTo(-0.1, 5);
  });
});

describe('FurnitureBuilder (Builder + Composite)', () => {
  it('fusiona las piezas por slot y los grupos anidados componen su transformación', () => {
    const b = new FurnitureBuilder('test');
    b.box('a', 1, 1, 1, [0, 0, 0]);
    b.group({ position: [2, 0, 0] }, (g) => {
      g.box('a', 1, 1, 1, [0, 0, 0]);
      g.group({ position: [0, 1, 0], rotationY: Math.PI / 2 }, (h) => h.box('b', 2, 1, 0.5, [0, 0, 0]));
    });
    const model = b.build();
    expect(model.slots.map((s) => s.slot).sort()).toEqual(['a', 'b']);
    const bb = meshBounds([model.slots.find((s) => s.slot === 'b')!.mesh]);
    // Girada 90°: el ancho (2) pasa a Z y queda trasladada a x = 2, y = 1.
    expect(bb.min[0]).toBeCloseTo(1.75);
    expect(bb.max[2]).toBeCloseTo(1);
    expect(bb.min[1]).toBeCloseTo(1);
  });
});

describe('recetas', () => {
  const kinds = FURNITURE.kinds;

  it(`hay al menos 40 tipos de mueble (${kinds.length})`, () => {
    expect(kinds.length).toBeGreaterThanOrEqual(40);
  });

  /** Variantes por parámetros que cambian la forma y también deben medir lo pedido. */
  const VARIANTS: Record<string, Record<string, string | boolean | number>[]> = {
    sofa: [{ arms: false }, { legs: 'none' }],
    'sofa-l': [{ chaise: 'left' }],
    ottoman: [{ shape: 'square' }],
    table: [{ legs: 'trestle' }],
    'table-round': [{ legs: 'tripod' }],
    desk: [{ legs: 'metal' }],
    wardrobe: [{ drawers: false }],
    mirror: [{ shape: 'round' }],
    rug: [{ shape: 'round' }],
    tv: [{ stand: true }],
    pendant: [{ shade: 'drum' }],
    'table-lamp': [{ base: 'disc' }],
    bed: [{ headboard: 'wood' }],
    curtains: [{ open: 0 }, { open: 0.9 }],
  };

  // Generador determinista (pruebas reproducibles).
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  for (const kind of FURNITURE.kinds) {
    it(`${kind}: mide exactamente lo pedido (±1 cm) con medidas por defecto, variadas ±30 % y sus variantes`, () => {
      const recipe = FURNITURE.get(kind);
      const cases: { dims: { x: number; y: number; z: number }; params: Record<string, string | boolean | number> }[] = [
        { dims: recipe.defaultDims, params: {} },
      ];
      for (let i = 0; i < 6; i++) {
        const f = () => 0.7 + rand() * 0.6;
        const dd = recipe.defaultDims;
        cases.push({ dims: { x: dd.x * f(), y: dd.y * f(), z: dd.z * f() }, params: {} });
      }
      for (const params of VARIANTS[kind] ?? []) cases.push({ dims: recipe.defaultDims, params });

      for (const { dims, params } of cases) {
        const model = FURNITURE.build(kind, dims, params);
        const label = `${kind} ${JSON.stringify(params)} ${dims.x.toFixed(2)}×${dims.y.toFixed(2)}×${dims.z.toFixed(2)}`;
        const { min, max } = model.bounds;
        expect(min[0], `${label} minX`).toBeCloseTo(-dims.x / 2, 1);
        expect(Math.abs(max[0] - dims.x / 2), `${label} maxX`).toBeLessThan(TOL);
        expect(Math.abs(min[0] + dims.x / 2), `${label} minX`).toBeLessThan(TOL);
        expect(Math.abs(min[1]), `${label} minY`).toBeLessThan(TOL);
        expect(Math.abs(max[1] - dims.y), `${label} maxY`).toBeLessThan(TOL);
        expect(Math.abs(min[2] + dims.z / 2), `${label} minZ`).toBeLessThan(TOL);
        expect(Math.abs(max[2] - dims.z / 2), `${label} maxZ`).toBeLessThan(TOL);

        // Solo usa slots declarados por la receta (si no, no se podría re-materializar).
        const declared = new Set(recipe.slots.map((s) => s.slot));
        for (const s of model.slots) {
          expect(declared.has(s.slot), `${label}: slot ${s.slot} no declarado`).toBe(true);
          expectFinite(s.mesh);
          expect(windingAgreement(s.mesh), `${label}: caras invertidas en ${s.slot}`).toBeGreaterThan(0.95);
        }
        expect(model.triangleCount, `${label}: demasiados triángulos`).toBeLessThan(40_000);
      }
    });
  }

  it('cada slot declarado tiene un material por defecto de una familia permitida', async () => {
    const { getMaterial } = await import('@interiores/shared-types');
    for (const kind of FURNITURE.kinds) {
      for (const s of FURNITURE.get(kind).slots) {
        const mat = getMaterial(s.default);
        expect(mat, `${kind}.${s.slot}: material ${s.default}`).toBeDefined();
        expect(s.allowedKinds, `${kind}.${s.slot}`).toContain(mat!.kind);
      }
    }
  });

  it('cambiar el tamaño RECONSTRUYE (más puertas, estantes y cojines), no estira', () => {
    const tris = (kind: string, dims: { x: number; y: number; z: number }, slot: string) =>
      FURNITURE.build(kind, dims).slots.find((s) => s.slot === slot)!.mesh.indices.length;
    expect(tris('wardrobe', { x: 2.0, y: 2.1, z: 0.6 }, 'frentes')).toBeGreaterThan(tris('wardrobe', { x: 1.0, y: 2.1, z: 0.6 }, 'frentes'));
    expect(tris('bookshelf', { x: 0.9, y: 2.2, z: 0.35 }, 'cuerpo')).toBeGreaterThan(tris('bookshelf', { x: 0.9, y: 0.9, z: 0.35 }, 'cuerpo'));
    expect(tris('sofa', { x: 2.6, y: 0.84, z: 0.92 }, 'tapizado')).toBeGreaterThan(tris('sofa', { x: 1.4, y: 0.84, z: 0.92 }, 'tapizado'));
    // Las patas de una mesa conservan su grosor aunque la mesa sea el doble de larga.
    const legs = (x: number) => {
      const m = FURNITURE.build('coffee-table', { x, y: 0.42, z: 0.6 }).slots.find((s) => s.slot === 'patas')!.mesh;
      const b = meshBounds([m]);
      return b.max[0] - b.min[0];
    };
    expect(legs(1.6) - legs(0.8)).toBeCloseTo(0.8, 2);
  });
});

describe('registro y caché (Factory + Flyweight)', () => {
  it('misma receta, medidas y parámetros → el mismo objeto; distinto → otro', () => {
    clearModelCache();
    const a = buildFurniture('sofa', { x: 2, y: 0.8, z: 0.9 }, { arms: true });
    const b = buildFurniture('sofa', { x: 2.0004, y: 0.8, z: 0.9 }, { arms: true }); // mismo mm
    const c = buildFurniture('sofa', { x: 2.1, y: 0.8, z: 0.9 }, { arms: true });
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(modelKey('x', { x: 1, y: 2, z: 3 }, { b: 1, a: 'z' })).toBe('x|1000x2000x3000|a=z&b=1');
  });

  it('errores claros: receta desconocida, duplicada o medidas inválidas', () => {
    expect(() => FURNITURE.get('nave-espacial')).toThrow(UnknownRecipeError);
    expect(() => new RecipeRegistry().register(FURNITURE.get('sofa'), FURNITURE.get('sofa'))).toThrow(/duplicada/);
    expect(() => FURNITURE.build('sofa', { x: 0, y: 1, z: 1 })).toThrow(RangeError);
  });
});
