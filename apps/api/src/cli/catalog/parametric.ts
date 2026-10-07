/**
 * Adapter: convierte un mueble paramétrico de `@interiores/furniture-kit` (geometría pura por
 * slot) en un GLB con materiales PBR de la biblioteca compartida. La web dibuja la misma receta
 * en vivo; este GLB sirve para AR (model-viewer), miniaturas y como respaldo.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { buildFurniture, recipeFor } from '@interiores/furniture-kit';
import {
  defaultResizeRanges,
  getMaterial,
  type CatalogSpec,
  type MaterialSlot,
  type Vector3,
} from '@interiores/shared-types';

export interface ParametricSource {
  type: 'parametric';
  kind: string;
  size: [number, number, number];
  params?: Record<string, string | number | boolean>;
  /** Material por slot (si falta, el de la receta). */
  materials?: Record<string, string>;
}

export class InvalidParametricEntryError extends Error {}

function srgbToLinear(hex: string): [number, number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [lin[0]!, lin[1]!, lin[2]!, 1];
}

/** Slots de la receta con los materiales elegidos en el manifiesto, validados. */
export function resolveSlots(source: ParametricSource): MaterialSlot[] {
  const recipe = recipeFor(source.kind);
  if (!recipe) throw new InvalidParametricEntryError(`Receta desconocida: ${source.kind}`);
  const chosen = source.materials ?? {};
  for (const slot of Object.keys(chosen)) {
    if (!recipe.slots.some((s) => s.slot === slot)) {
      throw new InvalidParametricEntryError(`${source.kind} no tiene el slot "${slot}" (tiene: ${recipe.slots.map((s) => s.slot).join(', ')})`);
    }
  }
  return recipe.slots.map((s) => {
    const id = chosen[s.slot] ?? s.default;
    const mat = getMaterial(id);
    if (!mat) throw new InvalidParametricEntryError(`Material desconocido en ${source.kind}.${s.slot}: ${id}`);
    if (!s.allowedKinds.includes(mat.kind)) {
      throw new InvalidParametricEntryError(`${source.kind}.${s.slot} no admite ${mat.kind} (${id})`);
    }
    return { ...s, default: id };
  });
}

const TUCKS_UNDER = new Set(['dining-chair', 'stool', 'office-chair']);
const ALLOWS_UNDER = new Set(['table', 'table-round', 'desk', 'kitchen-island']);
/** Ejes que no tiene sentido cambiar (el grosor de una alfombra o de un cuadro). */
const FIXED_Y = new Set(['rug']);
const FIXED_Z = new Set(['mirror', 'wall-art', 'clock', 'tv']);

/** Spec de personalización de un ítem paramétrico: receta, slots, rangos de tamaño, montaje. */
export function parametricSpec(source: ParametricSource, base: CatalogSpec = {}): CatalogSpec {
  const [x, y, z] = source.size;
  const ranges = defaultResizeRanges({ x, y, z });
  if (FIXED_Y.has(source.kind)) delete ranges.y;
  if (FIXED_Z.has(source.kind)) delete ranges.z;
  return {
    ...base,
    recipe: { kind: source.kind, params: source.params ?? {} },
    materialSlots: resolveSlots(source),
    resize: ranges,
    ...(TUCKS_UNDER.has(source.kind) ? { tucksUnder: true } : {}),
    ...(ALLOWS_UNDER.has(source.kind) ? { allowsUnder: true } : {}),
  };
}

/** Construye el GLB y devuelve sus medidas reales (deben coincidir con `size`). */
export async function buildParametricGlb(id: string, source: ParametricSource): Promise<{ glb: Uint8Array; dimensions: Vector3 }> {
  const [x, y, z] = source.size;
  const model = buildFurniture(source.kind, { x, y, z }, source.params ?? {});
  const slots = new Map(resolveSlots(source).map((s) => [s.slot, s.default]));

  const doc = new Document();
  const buffer = doc.createBuffer();
  const root = doc.createNode(id);
  doc.createScene(id).addChild(root);
  const mesh = doc.createMesh(id);
  for (const part of model.slots) {
    const mat = getMaterial(slots.get(part.slot)!)!;
    const material = doc
      .createMaterial(`${part.slot}:${mat.id}`)
      .setBaseColorFactor(srgbToLinear(mat.color))
      .setRoughnessFactor(mat.roughness)
      .setMetallicFactor(mat.metalness);
    if (mat.kind === 'glass') material.setAlphaMode('BLEND').setBaseColorFactor([...srgbToLinear(mat.color).slice(0, 3), 0.35] as [number, number, number, number]);
    // Pantallas y cortinas se ven por dentro: doble cara.
    if (part.slot === 'pantalla' || part.slot === 'tejido') material.setDoubleSided(true);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.mesh.positions)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.mesh.normals)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(part.mesh.indices)).setBuffer(buffer))
      .setMaterial(material);
    mesh.addPrimitive(prim);
  }
  root.setMesh(mesh);
  const glb = await new NodeIO().writeBinary(doc);
  const { min, max } = model.bounds;
  return { glb, dimensions: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] } };
}
