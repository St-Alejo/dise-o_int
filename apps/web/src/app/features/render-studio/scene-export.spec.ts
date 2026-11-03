import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { classifyMesh, exportRoomGlb, isFakeShading, textureFormats } from './scene-export';

const box = (name = '', material: THREE.Material = new THREE.MeshStandardMaterial()) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = name;
  return mesh;
};
const tagged = (role?: string, kind?: string) => {
  const m = new THREE.MeshStandardMaterial();
  if (role) m.userData['renderRole'] = role;
  if (kind) m.userData['renderMaterial'] = kind;
  return m;
};

/** Un cuarto mínimo como el de room-builder: piso, una pared con ventana y zócalo, y un sofá. */
function room() {
  const scene = new THREE.Scene();
  const roomGroup = new THREE.Group();
  roomGroup.name = 'room';
  const floor = box('floor', tagged(undefined, 'wood'));
  const wall = new THREE.Group();
  wall.name = 'wall-w1';
  const piece = box('', tagged('wall', 'paint'));
  const glass = box('window-glass', tagged('window-glass'));
  const frame = box('', tagged('trim'));
  wall.add(piece, glass, frame);
  const trim = new THREE.Group();
  trim.name = 'trim-w1';
  const baseboard = box('baseboard', tagged('trim'));
  const shadeMat = new THREE.MeshBasicMaterial();
  shadeMat.userData['shade'] = true;
  const shade = box('corner-shade', shadeMat);
  trim.add(baseboard, shade);
  roomGroup.add(floor, wall, trim);
  const furniture = new THREE.Group();
  furniture.name = 'furniture';
  const sofa = new THREE.Group();
  sofa.name = 'sofa-1';
  const seat = box('asiento', tagged(undefined, 'fabric'));
  seat.userData['slot'] = 'asiento';
  const lampShade = box('pantalla', tagged(undefined, 'fabric'));
  lampShade.userData['slot'] = 'pantalla';
  sofa.add(seat, lampShade);
  furniture.add(sofa);
  const gizmo = box('gizmo');
  scene.add(roomGroup, furniture, gizmo, new THREE.DirectionalLight());
  return { scene, floor, piece, glass, frame, baseboard, shade, seat, lampShade };
}

/** El JSON de un GLB: cabecera de 12 bytes y luego el primer trozo (JSON). */
function glbJson(buffer: ArrayBuffer): { nodes: { name?: string; extras?: Record<string, unknown> }[] } {
  const view = new DataView(buffer);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
}

describe('papel de cada malla para Blender', () => {
  it('reconoce piso, pared, vidrio, marco, zócalo y muebles', () => {
    const r = room();
    expect(classifyMesh(r.floor)).toEqual({ role: 'floor', material: 'wood' });
    expect(classifyMesh(r.piece)).toEqual({ role: 'wall', material: 'paint' });
    expect(classifyMesh(r.glass)).toEqual({ role: 'window-glass', material: 'glass' });
    expect(classifyMesh(r.frame)).toEqual({ role: 'trim', material: 'lacquer' });
    expect(classifyMesh(r.baseboard).role).toBe('trim');
    expect(classifyMesh(r.seat)).toEqual({ role: 'furniture', material: 'fabric' });
    expect(classifyMesh(r.lampShade).role).toBe('lamp-shade');
  });

  it('sin pistas queda como "otro"', () => {
    expect(classifyMesh(box('cosa'))).toEqual({ role: 'other', material: 'other' });
  });

  it('las penumbras pintadas y las sombras de contacto no viajan', () => {
    const r = room();
    expect(isFakeShading(r.shade)).toBe(true);
    expect(isFakeShading(box('contact-shadow'))).toBe(true);
    expect(isFakeShading(r.seat)).toBe(false);
  });
});

describe('formato de las texturas', () => {
  it('JPEG para todo salvo el color de un material transparente', () => {
    const wood = new THREE.Texture();
    const normal = new THREE.Texture();
    const leaves = new THREE.Texture();
    const opaque = new THREE.MeshStandardMaterial({ map: wood, normalMap: normal });
    const cutout = new THREE.MeshStandardMaterial({ map: leaves, transparent: true });
    const formats = textureFormats([opaque, cutout]);
    expect(formats.get(wood)).toBe('image/jpeg');
    expect(formats.get(normal)).toBe('image/jpeg');
    expect(formats.get(leaves)).toBe('image/png');
  });

  it('si una textura compartida necesita alfa en algún material, queda en PNG', () => {
    const shared = new THREE.Texture();
    const formats = textureFormats([new THREE.MeshStandardMaterial({ map: shared, transparent: true }), new THREE.MeshStandardMaterial({ map: shared })]);
    expect(formats.get(shared)).toBe('image/png');
  });
});

describe('exportar el cuarto a GLB', () => {
  it('saca solo cuarto y muebles, con su papel en los extras, y deja la escena como estaba', async () => {
    const r = room();
    const glb = await exportRoomGlb(r.scene);
    expect(new TextDecoder().decode(new Uint8Array(glb, 0, 4))).toBe('glTF');
    const json = glbJson(glb);
    const names = json.nodes.map((n) => n.name);
    expect(names).toContain('floor');
    expect(names).toContain('window-glass');
    expect(names).not.toContain('gizmo');
    expect(names).not.toContain('corner-shade');
    expect(json.nodes.find((n) => n.name === 'window-glass')?.extras).toMatchObject({ renderRole: 'window-glass', renderMaterial: 'glass' });
    // Las marcas eran solo para el archivo, y lo oculto vuelve a verse.
    expect(r.glass.userData['renderRole']).toBeUndefined();
    expect(r.shade.visible).toBe(true);
  });

  it('falla claro si no hay cuarto', async () => {
    await expect(exportRoomGlb(new THREE.Scene())).rejects.toThrow('No hay cuarto');
  });
});
