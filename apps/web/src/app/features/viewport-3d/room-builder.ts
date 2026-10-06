/**
 * Construye la geometría del cuarto (piso + paredes con huecos de puertas y ventanas) a
 * partir del RoomShell. Sin CSG: cada pared se parte en tramos (izquierda, bajo/sobre cada
 * abertura, derecha). Es código puro de Three.js: no necesita WebGL y se prueba en jsdom.
 */
import type { Opening, RoomShell, WallSegment } from '@interiores/shared-types';
import * as THREE from 'three';

export const WALL_THICKNESS = 0.12;

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
}

export interface RoomPalette {
  floor: string;
  wall: string;
  trim: string;
}

export const DEFAULT_PALETTE: RoomPalette = { floor: '#c9a27e', wall: '#efe9e1', trim: '#f7f4ef' };

function inwardNormal(wall: WallSegment, shell: RoomShell): THREE.Vector2 {
  const dx = wall.end.x - wall.start.x;
  const dz = wall.end.z - wall.start.z;
  const len = Math.hypot(dx, dz) || 1;
  const n = new THREE.Vector2(-dz / len, dx / len);
  const mx = (wall.start.x + wall.end.x) / 2;
  const mz = (wall.start.z + wall.end.z) / 2;
  if ((shell.widthM / 2 - mx) * n.x + (shell.depthM / 2 - mz) * n.y < 0) n.multiplyScalar(-1);
  return n;
}

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

export function buildRoom(shell: RoomShell, palette: RoomPalette = DEFAULT_PALETTE): BuiltRoom {
  const group = new THREE.Group();
  group.name = 'room';

  // Piso (un poco más grande que el cuarto para que no se vean rendijas bajo las paredes)
  const floorGeom = new THREE.PlaneGeometry(shell.widthM + WALL_THICKNESS * 2, shell.depthM + WALL_THICKNESS * 2);
  floorGeom.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(
    floorGeom,
    new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 0.75, metalness: 0 }),
  );
  floor.position.set(shell.widthM / 2, 0, shell.depthM / 2);
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  const walls: WallInfo[] = [];

  for (const wall of shell.walls) {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const normal = inwardNormal(wall, shell);
    const openings = shell.openings.filter((o) => o.wallId === wall.id);

    // Grupo con X local a lo largo de la pared (start → end) y +Z local = normal interior.
    const wallGroup = new THREE.Group();
    wallGroup.name = `wall-${wall.id}`;
    wallGroup.position.set(wall.start.x, 0, wall.start.z);
    wallGroup.rotation.y = Math.atan2(-dz, dx);
    const localZ = new THREE.Vector2(Math.sin(wallGroup.rotation.y), Math.cos(wallGroup.rotation.y));
    const inwardSign = localZ.dot(normal) >= 0 ? 1 : -1;

    // Materiales POR PARED: el recorte "casa de muñecas" vuelve translúcida la pared entera
    // (incluidos marcos y vidrios). `baseOpacity` guarda la opacidad normal de cada uno.
    const material = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.92, transparent: true, opacity: 1 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.6, transparent: true, opacity: 1 });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: '#bcd9ea',
      transparent: true,
      opacity: 0.28,
      roughness: 0.05,
      metalness: 0.1,
      depthWrite: false,
    });
    for (const m of [material, trimMaterial, glassMaterial]) m.userData['baseOpacity'] = m.opacity;
    // Las paredes sobresalen media pared en cada extremo para cerrar las esquinas.
    for (const piece of wallPieces(length, shell.heightM, openings)) {
      const extendStart = piece.x0 === 0 ? WALL_THICKNESS : 0;
      const extendEnd = Math.abs(piece.x1 - length) < 1e-6 ? WALL_THICKNESS : 0;
      const w = piece.x1 - piece.x0 + extendStart + extendEnd;
      const h = piece.y1 - piece.y0;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, WALL_THICKNESS), material);
      mesh.position.set(piece.x0 - extendStart + w / 2, piece.y0 + h / 2, (-inwardSign * WALL_THICKNESS) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      wallGroup.add(mesh);
    }

    for (const o of openings) {
      const cx = o.offsetM;
      if (o.type === 'window') {
        const glass = new THREE.Mesh(new THREE.BoxGeometry(o.widthM, o.heightM, 0.02), glassMaterial);
        glass.position.set(cx, o.sillHeightM + o.heightM / 2, (-inwardSign * WALL_THICKNESS) / 2);
        glass.name = 'window-glass';
        wallGroup.add(glass);
        const sill = new THREE.Mesh(new THREE.BoxGeometry(o.widthM + 0.1, 0.04, WALL_THICKNESS + 0.06), trimMaterial);
        sill.position.set(cx, o.sillHeightM - 0.02, (-inwardSign * WALL_THICKNESS) / 2 + inwardSign * 0.03);
        wallGroup.add(sill);
      } else {
        // Marco de puerta (dintel + jambas)
        const frameT = 0.06;
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(o.widthM + frameT * 2, frameT, WALL_THICKNESS + 0.02), trimMaterial);
        lintel.position.set(cx, o.heightM + frameT / 2, (-inwardSign * WALL_THICKNESS) / 2);
        wallGroup.add(lintel);
        for (const side of [-1, 1]) {
          const jamb = new THREE.Mesh(new THREE.BoxGeometry(frameT, o.heightM, WALL_THICKNESS + 0.02), trimMaterial);
          jamb.position.set(cx + side * (o.widthM / 2 + frameT / 2), o.heightM / 2, (-inwardSign * WALL_THICKNESS) / 2);
          wallGroup.add(jamb);
        }
      }
    }

    group.add(wallGroup);
    walls.push({
      wallId: wall.id,
      normal,
      midpoint: new THREE.Vector3((wall.start.x + wall.end.x) / 2, shell.heightM / 2, (wall.start.z + wall.end.z) / 2),
      materials: [material, trimMaterial, glassMaterial],
    });
  }

  return { group, walls, floor };
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
