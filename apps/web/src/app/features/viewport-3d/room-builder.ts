/**
 * Construye la geometría del cuarto a partir del RoomShell: piso y techo con la forma de la
 * planta, paredes con huecos de puertas y ventanas, zócalos, hojas de puerta y marcos. Sirve para
 * cualquier forma (rectángulo, L, T, U o paredes libres).
 * Sin CSG: cada pared se parte en tramos (izquierda, bajo/sobre cada abertura, derecha). Es
 * código puro de Three.js: no necesita WebGL y se prueba en jsdom.
 */
import {
  getMaterial,
  isConvexVertex,
  roomPolygon,
  wallFrames,
  wallMaterialId,
  type MaterialDefinition,
  type Opening,
  type Point2,
  type RoomFinishes,
  type RoomShell,
} from '@interiores/shared-types';
import * as THREE from 'three';

export const WALL_THICKNESS = 0.12;
const BASEBOARD = { height: 0.08, depth: 0.012 };
const FRAME = 0.06;

export interface WallInfo {
  wallId: string;
  /** Normal hacia el interior del cuarto (XZ). */
  normal: THREE.Vector2;
  /** Punto medio de la cara interior. */
  midpoint: THREE.Vector3;
  materials: THREE.MeshStandardMaterial[];
}

export interface BuiltRoom {
  group: THREE.Group;
  walls: WallInfo[];
  floor: THREE.Mesh;
  /** Mira hacia abajo: desde fuera (vista de órbita) no se ve; desde dentro, sí. */
  ceiling: THREE.Mesh;
}

export interface RoomPalette {
  floor: string;
  wall: string;
  trim: string;
  ceiling: string;
  door: string;
}

export const DEFAULT_PALETTE: RoomPalette = { floor: '#c9a27e', wall: '#efe9e1', trim: '#f7f4ef', ceiling: '#f7f4ef', door: '#b08a63' };

/** Tramos macizos de una pared de longitud `length` con sus aberturas (coordenadas locales). */
export function wallPieces(
  length: number,
  height: number,
  openings: Pick<Opening, 'offsetM' | 'widthM' | 'heightM' | 'sillHeightM'>[],
): { x0: number; x1: number; y0: number; y1: number }[] {
  const pieces: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const sorted = [...openings]
    .map((o) => ({
      x0: Math.max(0, o.offsetM - o.widthM / 2),
      x1: Math.min(length, o.offsetM + o.widthM / 2),
      y0: Math.max(0, o.sillHeightM),
      y1: Math.min(height, o.sillHeightM + o.heightM),
    }))
    .filter((o) => o.x1 > o.x0)
    .sort((a, b) => a.x0 - b.x0);

  let cursor = 0;
  for (const o of sorted) {
    if (o.x0 > cursor) pieces.push({ x0: cursor, x1: o.x0, y0: 0, y1: height });
    if (o.y0 > 0.001) pieces.push({ x0: o.x0, x1: o.x1, y0: 0, y1: o.y0 });
    if (o.y1 < height - 0.001) pieces.push({ x0: o.x0, x1: o.x1, y0: o.y1, y1: height });
    cursor = Math.max(cursor, o.x1);
  }
  if (cursor < length) pieces.push({ x0: cursor, x1: length, y0: 0, y1: height });
  return pieces.filter((p) => p.x1 - p.x0 > 0.001 && p.y1 - p.y0 > 0.001);
}

/** Plano horizontal con la forma de la planta, a la altura `y`, mirando hacia arriba o hacia abajo. */
function slab(poly: Point2[], y: number, facing: 'up' | 'down', material: THREE.Material): THREE.Mesh {
  // ShapeGeometry vive en XY mirando a +Z: se tumba para que su normal quede vertical.
  const flip = facing === 'up' ? -1 : 1;
  const geometry = new THREE.ShapeGeometry(new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.z * flip))));
  geometry.rotateX((Math.PI / 2) * flip);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  return mesh;
}

export function buildRoom(shell: RoomShell, palette: RoomPalette = DEFAULT_PALETTE): BuiltRoom {
  const group = new THREE.Group();
  group.name = 'room';
  const poly = roomPolygon(shell);

  const floor = slab(poly, 0, 'up', new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 0.75, metalness: 0 }));
  floor.receiveShadow = true;
  floor.name = 'floor';
  const ceiling = slab(poly, shell.heightM, 'down', new THREE.MeshStandardMaterial({ color: palette.ceiling, roughness: 0.95, metalness: 0 }));
  ceiling.name = 'ceiling';
  group.add(floor, ceiling);

  const walls: WallInfo[] = [];
  const frames = wallFrames(shell);

  shell.walls.forEach((wall, index) => {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return;
    const frame = frames[index]!;
    const normal = new THREE.Vector2(frame.normal.x, frame.normal.z);
    const openings = shell.openings.filter((o) => o.wallId === wall.id);

    // Grupo con X local a lo largo de la pared (start → end) y +Z local = normal interior.
    const wallGroup = new THREE.Group();
    wallGroup.name = `wall-${wall.id}`;
    wallGroup.position.set(wall.start.x, 0, wall.start.z);
    wallGroup.rotation.y = Math.atan2(-dz, dx);
    const localZ = new THREE.Vector2(Math.sin(wallGroup.rotation.y), Math.cos(wallGroup.rotation.y));
    const inwardSign = localZ.dot(normal) >= 0 ? 1 : -1;
    /** z local de algo centrado en el espesor de la pared (que queda por fuera del cuarto). */
    const inWall = (-inwardSign * WALL_THICKNESS) / 2;
    // Lo decorativo (zócalos) va en un grupo aparte: la pared en sí no invade el cuarto.
    const trimGroup = new THREE.Group();
    trimGroup.name = `trim-${wall.id}`;
    trimGroup.position.copy(wallGroup.position);
    trimGroup.rotation.copy(wallGroup.rotation);

    // Materiales POR PARED: el recorte "casa de muñecas" vuelve translúcida la pared entera
    // (incluidos marcos, vidrios y puertas). `baseOpacity` guarda la opacidad normal de cada uno.
    const material = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.92, transparent: true, opacity: 1 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.6, transparent: true, opacity: 1 });
    const doorMaterial = new THREE.MeshStandardMaterial({ color: palette.door, roughness: 0.55, transparent: true, opacity: 1 });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: '#bcd9ea',
      transparent: true,
      opacity: 0.28,
      roughness: 0.05,
      metalness: 0.1,
      depthWrite: false,
    });
    const materials = [material, trimMaterial, glassMaterial, doorMaterial];
    for (const m of materials) m.userData['baseOpacity'] = m.opacity;
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Group = wallGroup) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    // En las esquinas salientes la pared se alarga su espesor para cerrar el hueco exterior. En
    // las entrantes (la muesca de una L) no: ese alargue se metería dentro del cuarto.
    const convexStart = isConvexVertex(poly, index);
    const convexEnd = isConvexVertex(poly, (index + 1) % poly.length);
    for (const piece of wallPieces(length, shell.heightM, openings)) {
      const extendStart = piece.x0 === 0 && convexStart ? WALL_THICKNESS : 0;
      const extendEnd = Math.abs(piece.x1 - length) < 1e-6 && convexEnd ? WALL_THICKNESS : 0;
      const w = piece.x1 - piece.x0 + extendStart + extendEnd;
      const h = piece.y1 - piece.y0;
      const mesh = box(w, h, WALL_THICKNESS, material, piece.x0 - extendStart + w / 2, piece.y0 + h / 2, inWall);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (piece.y0 === 0) {
        const z = (inwardSign * BASEBOARD.depth) / 2;
        box(piece.x1 - piece.x0, BASEBOARD.height, BASEBOARD.depth, trimMaterial, (piece.x0 + piece.x1) / 2, BASEBOARD.height / 2, z, trimGroup).name = 'baseboard';
      }
    }

    for (const o of openings) {
      const cx = o.offsetM;
      const deep = WALL_THICKNESS + 0.02;
      if (o.type === 'window') {
        box(o.widthM, o.heightM, 0.02, glassMaterial, cx, o.sillHeightM + o.heightM / 2, inWall).name = 'window-glass';
        box(o.widthM + 0.1, 0.04, WALL_THICKNESS + 0.06, trimMaterial, cx, o.sillHeightM - 0.02, inWall + inwardSign * 0.03);
        // Marco: dintel, jambas y, si la ventana es ancha, un parteluz al centro.
        const mid = o.sillHeightM + o.heightM / 2;
        box(o.widthM, FRAME / 2, deep, trimMaterial, cx, o.sillHeightM + o.heightM - FRAME / 4, inWall);
        for (const side of [-1, 1]) box(FRAME / 2, o.heightM, deep, trimMaterial, cx + side * (o.widthM / 2 - FRAME / 4), mid, inWall);
        if (o.widthM > 0.9) box(FRAME / 2, o.heightM, 0.04, trimMaterial, cx, mid, inWall);
      } else {
        // Marco de puerta (dintel + jambas) y la hoja, cerrada, con su manija.
        box(o.widthM + FRAME * 2, FRAME, deep, trimMaterial, cx, o.heightM + FRAME / 2, inWall);
        for (const side of [-1, 1]) box(FRAME, o.heightM, deep, trimMaterial, cx + side * (o.widthM / 2 + FRAME / 2), o.heightM / 2, inWall);
        const leaf = box(o.widthM, o.heightM, 0.04, doorMaterial, cx, o.heightM / 2, inWall);
        leaf.name = 'door-leaf';
        leaf.castShadow = true;
        box(0.03, 0.12, 0.05, trimMaterial, cx + o.widthM / 2 - 0.09, Math.min(1.05, o.heightM * 0.5), inWall + inwardSign * 0.045).name = 'door-handle';
      }
    }

    group.add(wallGroup, trimGroup);
    walls.push({
      wallId: wall.id,
      normal,
      midpoint: new THREE.Vector3((wall.start.x + wall.end.x) / 2, shell.heightM / 2, (wall.start.z + wall.end.z) / 2),
      materials,
    });
  });

  return { group, walls, floor, ceiling };
}

/**
 * Pinta el cuarto con sus acabados: material del piso, del techo y de cada pared (o el de 'all').
 * Cambia color y rugosidad de los materiales existentes: no reconstruye geometría.
 */
/** Quien da la textura de un material de piso (la biblioteca de texturas; en las pruebas, nadie). */
export interface FloorTextures {
  floor(material: MaterialDefinition): THREE.Texture | null;
}

export function applyFinishes(room: BuiltRoom, finishes: RoomFinishes, textures?: FloorTextures): void {
  const paint = (mat: THREE.MeshStandardMaterial, id: string, floor = false) => {
    const def = getMaterial(id);
    if (!def) return;
    mat.color.set(def.color);
    mat.roughness = def.roughness;
    mat.metalness = def.metalness;
    // La textura multiplica el color: da el relieve (vetas, juntas) sin cambiar el tono.
    if (floor) mat.map = textures?.floor(def) ?? null;
    mat.needsUpdate = true;
  };
  paint(room.floor.material as THREE.MeshStandardMaterial, finishes.floor, true);
  paint(room.ceiling.material as THREE.MeshStandardMaterial, finishes.ceiling);
  for (const wall of room.walls) {
    const wallMat = wall.materials[0];
    if (wallMat) paint(wallMat, wallMaterialId(finishes, { id: wall.wallId }));
  }
}

/** Libera TODA la memoria GPU de un subárbol (Three.js no tiene GC de recursos GPU). */
export function disposeObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
    else if (mat) materials.add(mat);
  });
  for (const m of materials) {
    for (const value of Object.values(m)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    m.dispose();
  }
}
