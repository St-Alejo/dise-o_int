import { MATERIAL_KINDS, ROLE_MATERIAL, SCENE_EXTRA_KEYS, SCENE_ROLES, type SceneExtras, type SceneMaterial, type SceneRole } from '@interiores/shared-types';
import * as THREE from 'three';

/** Raíces de la escena que forman el cuarto: el resto (luces, cielo, ayudas) se rehace en Blender. */
export const EXPORT_ROOTS = ['room', 'furniture'] as const;

/** Mallas que fingen algo que Cycles calcula de verdad (penumbras pintadas, sombras de contacto). */
export function isFakeShading(mesh: THREE.Mesh): boolean {
  if (mesh.name === 'contact-shadow' || mesh.name === 'corner-shade' || mesh.name === 'edge-shade') return true;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.every((m) => m.userData['shade'] === true);
}

/** Papel de una malla según su nombre y el de sus padres (de la malla hacia la raíz). */
function roleFromNames(names: readonly string[], slot: unknown): SceneRole | null {
  const [own = ''] = names;
  if (own === 'window-glass') return 'window-glass';
  if (own === 'door-leaf') return 'door';
  if (own === 'door-handle' || own === 'baseboard' || own === 'zone-door-frame') return 'trim';
  if (own === 'floor' || own.startsWith('zone-floor')) return 'floor';
  if (own === 'ceiling') return 'ceiling';
  if (own.includes('tiles')) return 'tiles';
  if (names.includes('furniture')) return slot === 'pantalla' ? 'lamp-shade' : 'furniture';
  if (names.some((n) => n.startsWith('wall-') || n.startsWith('partition-') || n === 'zone-lining')) return 'wall';
  if (names.some((n) => n.startsWith('trim-'))) return 'trim';
  return null;
}

const isRole = (v: unknown): v is SceneRole => typeof v === 'string' && (SCENE_ROLES as readonly string[]).includes(v);
const isKind = (v: unknown): v is SceneMaterial => typeof v === 'string' && (MATERIAL_KINDS as readonly string[]).includes(v);

/**
 * Qué es una malla y de qué está hecha, para que Blender afine su material: primero lo que dice el
 * propio material (los de las paredes saben si son marco, vidrio o puerta), luego el nombre.
 */
export function classifyMesh(mesh: THREE.Mesh): SceneExtras {
  const names: string[] = [];
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) names.push(o.name);
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const fromMaterial = material?.userData['renderRole'];
  const named = roleFromNames(names, mesh.userData['slot']);
  // El nombre de la malla manda sobre un material genérico de pared (el zócalo usa el del marco).
  const role: SceneRole = (named !== 'wall' && named) || (isRole(fromMaterial) ? fromMaterial : named) || 'other';
  const kind = material?.userData['renderMaterial'];
  return { role, material: isKind(kind) ? kind : ROLE_MATERIAL[role] };
}

/**
 * Lado máximo de las texturas en el GLB. Casi todas son de repetición (piso, tela, madera), así que
 * 1024 basta, y con 2048 en PNG una sala pesaba ~37 MB.
 */
export const EXPORT_TEXTURE_SIZE = 1024;

/**
 * Las texturas de los materiales, con el formato en que conviene guardarlas: JPEG (diez veces más
 * ligero) salvo el color de un material con transparencia, que necesita su canal alfa.
 */
export function textureFormats(materials: Iterable<THREE.Material>): Map<THREE.Texture, 'image/jpeg' | 'image/png'> {
  const formats = new Map<THREE.Texture, 'image/jpeg' | 'image/png'>();
  for (const material of materials) {
    const needsAlpha = material.transparent || material.alphaTest > 0;
    for (const [key, value] of Object.entries(material)) {
      if (!(value instanceof THREE.Texture)) continue;
      const format = key === 'map' && needsAlpha ? 'image/png' : 'image/jpeg';
      // La misma textura en dos materiales: si uno necesita alfa, gana PNG.
      if (formats.get(value) !== 'image/png') formats.set(value, format);
    }
  }
  return formats;
}

/**
 * Exporta el cuarto visible a GLB con el papel de cada malla en sus extras. No toca lo que se ve:
 * lo fingido se oculta solo durante la exportación y las marcas se quitan al terminar.
 */
export async function exportRoomGlb(scene: THREE.Scene): Promise<ArrayBuffer> {
  const roots = EXPORT_ROOTS.map((name) => scene.getObjectByName(name)).filter((o): o is THREE.Object3D => !!o?.visible);
  if (!roots.length) throw new Error('No hay cuarto que exportar');
  const hidden: THREE.Object3D[] = [];
  const tagged: THREE.Mesh[] = [];
  for (const root of roots) {
    root.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (isFakeShading(o)) {
        o.visible = false;
        hidden.push(o);
        return;
      }
      const extras = classifyMesh(o);
      o.userData[SCENE_EXTRA_KEYS.role] = extras.role;
      o.userData[SCENE_EXTRA_KEYS.material] = extras.material;
      tagged.push(o);
    });
  }
  const materials = new Set(tagged.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])));
  const formats = textureFormats(materials);
  // El exportador lee el formato de `userData.mimeType`; se devuelve el que tuviera.
  const savedFormats = [...formats].map(([texture, format]) => {
    const before: unknown = texture.userData['mimeType'];
    texture.userData['mimeType'] = format;
    return [texture, before] as const;
  });
  try {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const result = await new GLTFExporter().parseAsync(roots, { binary: true, onlyVisible: true, maxTextureSize: EXPORT_TEXTURE_SIZE });
    if (!(result instanceof ArrayBuffer)) throw new Error('El exportador no devolvió un GLB');
    return result;
  } finally {
    for (const [texture, before] of savedFormats) {
      if (before === undefined) delete texture.userData['mimeType'];
      else texture.userData['mimeType'] = before;
    }
    for (const o of hidden) o.visible = true;
    for (const o of tagged) {
      delete o.userData[SCENE_EXTRA_KEYS.role];
      delete o.userData[SCENE_EXTRA_KEYS.material];
    }
  }
}
