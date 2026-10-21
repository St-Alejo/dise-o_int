/**
 * Zonas interiores del cuarto (baño privado, vestidor): tabiques con el hueco de su puerta y los
 * acabados propios de la zona (piso, pintura y revestimiento) sobre la parte de las paredes del
 * cuarto que le toca. Igual que `room-builder`: Three.js puro, sin CSG, se prueba en jsdom.
 */
import {
  PARTITION_THICKNESS_M,
  ZONE_DOOR_HEIGHT_M,
  distanceToBoundary,
  pointInPolygon,
  zoneEdges,
  type Point2,
  type RoomShell,
  type Zone,
} from '@interiores/shared-types';
import * as THREE from 'three';
import { CUT_HEIGHT, metricBoxUVs, wallPieces, type RoomPalette, type WallInfo } from './room-builder';

const FRAME = 0.05;
const BASEBOARD = { height: 0.08, depth: 0.012 };
/** La pintura de la zona va por delante del zócalo y de la penumbra de la pared del cuarto. */
const LINING_GAP_M = 0.0125;
const TILE_DEPTH_M = 0.006;
const CUT_COLOR = '#7d746a';
/** Un lado de zona a menos de esto de una pared del cuarto se apoya en ella. */
const ON_WALL_M = 0.03;

/** Lo que se pinta con los acabados de una zona. */
export interface ZoneSurfaces {
  zoneId: string;
  /** Piso propio, apenas por encima del del cuarto; oculto mientras la zona no tenga acabados. */
  floor: THREE.Mesh;
  /** Caras interiores de los tabiques: con la pintura de la zona o, si no tiene, la del cuarto. */
  innerMaterials: THREE.MeshStandardMaterial[];
  /** Pintura sobre las paredes del cuarto dentro de la zona: solo se ve si la zona la define. */
  linings: { mesh: THREE.Group; material: THREE.MeshStandardMaterial }[];
  /** Revestimiento (baldosa de baño) por cada cara de la zona, con su material. */
  tiles: { group: THREE.Group; material: THREE.MeshStandardMaterial; set(heightM: number | null): void }[];
}

export interface BuiltZones {
  partitions: WallInfo[];
  zones: ZoneSurfaces[];
}

interface Frame {
  group: THREE.Group;
  length: number;
}

/** Grupo con X local de `a` a `b` (como las paredes del cuarto). */
function frameOf(a: Point2, b: Point2): Frame {
  const group = new THREE.Group();
  group.position.set(a.x, 0, a.z);
  group.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
  return { group, length: Math.hypot(b.x - a.x, b.z - a.z) };
}

function addBox(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
  metricBoxUVs(geometry, new THREE.Vector3(x, y, z));
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Revestimiento de `top` metros sobre una cara: tramos con los mismos huecos que la pared. */
function tilesSetter(
  group: THREE.Group,
  material: THREE.Material,
  span: { x0: number; length: number; top: number },
  holes: Parameters<typeof wallPieces>[2],
  z: number,
) {
  return (wanted: number | null) => {
    for (const child of [...group.children]) {
      group.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    if (wanted === null) return;
    for (const piece of wallPieces(span.length, Math.min(wanted, span.top), holes)) {
      const w = piece.x1 - piece.x0;
      const h = piece.y1 - piece.y0;
      const mesh = addBox(group, w, h, TILE_DEPTH_M, material, span.x0 + piece.x0 + w / 2, piece.y0 + h / 2, z);
      mesh.name = 'zone-tiles';
      mesh.receiveShadow = true;
    }
  };
}

function zoneFloor(zone: Zone): THREE.Mesh {
  const shape = new THREE.Shape(zone.outline.map((p) => new THREE.Vector2(p.x, -p.z)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `zone-floor-${zone.id}`;
  mesh.position.y = 0.002;
  mesh.receiveShadow = true;
  mesh.visible = false;
  return mesh;
}

/** El tabique de un lado de zona: macizo centrado en la línea, puerta abierta y zócalo a cada lado. */
function buildPartition(shell: RoomShell, zone: Zone, a: Point2, b: Point2, edge: number, palette: RoomPalette, surfaces: ZoneSurfaces): WallInfo {
  const t = PARTITION_THICKNESS_M;
  const { group, length } = frameOf(a, b);
  group.name = `partition-${zone.id}-${edge}`;
  // ¿Hacia qué lado local (±Z) queda el interior de la zona?
  const localZ = { x: Math.sin(group.rotation.y), z: Math.cos(group.rotation.y) };
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const innerSign = pointInPolygon({ x: mid.x + localZ.x * 0.1, z: mid.z + localZ.z * 0.1 }, zone.outline) ? 1 : -1;

  const outer = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.92 });
  const inner = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.92 });
  const trim = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.6 });
  const tileMat = new THREE.MeshStandardMaterial();
  surfaces.innerMaterials.push(inner);
  // Caras de una caja: +x, −x, +y, −y, +z, −z.
  const faces = innerSign > 0 ? [outer, outer, outer, outer, inner, outer] : [outer, outer, outer, outer, outer, inner];

  const door = zone.door?.edge === edge ? zone.door : null;
  const holes = door ? [{ offsetM: door.offsetM, widthM: door.widthM, heightM: ZONE_DOOR_HEIGHT_M, sillHeightM: 0 }] : [];
  const stub = new THREE.Group();
  stub.name = `stub-${group.name}`;
  stub.position.copy(group.position);
  stub.rotation.copy(group.rotation);
  stub.visible = false;
  const stubMaterial = new THREE.MeshStandardMaterial({ color: palette.wall, roughness: 0.92 });
  const cap = new THREE.MeshStandardMaterial({ color: CUT_COLOR, roughness: 0.9 });

  for (const piece of wallPieces(length, shell.heightM, holes)) {
    // Medio espesor de más en los extremos: cierra la esquina con el otro tabique (o se mete en la pared).
    const x0 = piece.x0 === 0 ? -t / 2 : piece.x0;
    const x1 = Math.abs(piece.x1 - length) < 1e-6 ? length + t / 2 : piece.x1;
    const w = x1 - x0;
    const h = piece.y1 - piece.y0;
    const mesh = addBox(group, w, h, t, faces, (x0 + x1) / 2, piece.y0 + h / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (piece.y0 === 0) {
      const low = addBox(stub, w, CUT_HEIGHT, t, [stubMaterial, stubMaterial, cap, stubMaterial, stubMaterial, stubMaterial], (x0 + x1) / 2, CUT_HEIGHT / 2, 0);
      low.raycast = () => undefined;
      for (const side of [-1, 1]) {
        const z = side * (t / 2 + BASEBOARD.depth / 2);
        addBox(group, piece.x1 - piece.x0, BASEBOARD.height, BASEBOARD.depth, trim, (piece.x0 + piece.x1) / 2, BASEBOARD.height / 2, z).name = 'baseboard';
      }
    }
  }
  if (door) {
    // Marco a ambos lados del vano; la puerta queda abierta: se entra caminando.
    const deep = t + 0.03;
    addBox(group, door.widthM + FRAME * 2, FRAME, deep, trim, door.offsetM, ZONE_DOOR_HEIGHT_M + FRAME / 2, 0).name = 'zone-door-frame';
    for (const side of [-1, 1]) {
      addBox(group, FRAME, ZONE_DOOR_HEIGHT_M, deep, trim, door.offsetM + side * (door.widthM / 2 + FRAME / 2), ZONE_DOOR_HEIGHT_M / 2, 0).name = 'zone-door-frame';
    }
  }

  const tiles = new THREE.Group();
  tiles.name = `zone-tiles-${group.name}`;
  group.add(tiles);
  surfaces.tiles.push({ group: tiles, material: tileMat, set: tilesSetter(tiles, tileMat, { x0: 0, length, top: shell.heightM }, holes, innerSign * (t / 2 + TILE_DEPTH_M / 2 + 0.001)) });

  const materials: THREE.Material[] = [outer, inner, trim, tileMat];
  for (const m of materials) m.userData['baseDepthWrite'] = m.depthWrite;
  return {
    wallId: group.name,
    // Normal hacia dentro de la zona: desde el resto del cuarto, el tabique se recorta.
    normal: new THREE.Vector2(localZ.x * innerSign, localZ.z * innerSign),
    midpoint: new THREE.Vector3(mid.x, shell.heightM / 2, mid.z),
    materials,
    groups: [group],
    stub,
    stubMaterial,
    cut: false,
    tiles,
    setTiles: () => undefined,
  };
}

/**
 * Lo que una zona pinta sobre una pared del cuarto en la que se apoya: una lámina por delante de
 * la pintura del cuarto, con los huecos de las ventanas y puertas de ese tramo. Va dentro del
 * grupo de la pared, así se recorta con ella.
 */
function liningOn(shell: RoomShell, wall: WallInfo, a: Point2, b: Point2, surfaces: ZoneSurfaces): void {
  const segment = shell.walls.find((w) => w.id === wall.wallId);
  const trimGroup = wall.groups[1];
  if (!segment || !trimGroup) return;
  const len = Math.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z);
  const ux = (segment.end.x - segment.start.x) / len;
  const uz = (segment.end.z - segment.start.z) / len;
  const along = (p: Point2) => (p.x - segment.start.x) * ux + (p.z - segment.start.z) * uz;
  const x0 = Math.max(0, Math.min(along(a), along(b)));
  const x1 = Math.min(len, Math.max(along(a), along(b)));
  if (x1 - x0 < 0.05) return;
  const span = { x0, length: x1 - x0 };
  const holes = shell.openings
    .filter((o) => o.wallId === segment.id && o.offsetM + o.widthM / 2 > x0 && o.offsetM - o.widthM / 2 < x1)
    .map((o) => ({ ...o, offsetM: o.offsetM - x0 }));
  const localZ = new THREE.Vector2(Math.sin(trimGroup.rotation.y), Math.cos(trimGroup.rotation.y));
  const inward = localZ.dot(wall.normal) >= 0 ? 1 : -1;

  const material = new THREE.MeshStandardMaterial({ roughness: 0.92 });
  const lining = new THREE.Group();
  lining.name = 'zone-lining';
  lining.visible = false;
  for (const piece of wallPieces(span.length, shell.heightM, holes)) {
    const w = piece.x1 - piece.x0;
    const h = piece.y1 - piece.y0;
    addBox(lining, w, h, 0.004, material, x0 + piece.x0 + w / 2, piece.y0 + h / 2, inward * (LINING_GAP_M + 0.002)).receiveShadow = true;
  }
  trimGroup.add(lining);
  const tileMat = new THREE.MeshStandardMaterial();
  const tiles = new THREE.Group();
  tiles.name = 'zone-tiles';
  trimGroup.add(tiles);
  for (const m of [material, tileMat]) {
    m.userData['baseDepthWrite'] = m.depthWrite;
    wall.materials.push(m);
  }
  surfaces.linings.push({ mesh: lining, material });
  surfaces.tiles.push({ group: tiles, material: tileMat, set: tilesSetter(tiles, tileMat, { ...span, top: shell.heightM }, holes, inward * (LINING_GAP_M + 0.004 + TILE_DEPTH_M / 2)) });
}

/** Tabiques y superficies de todas las zonas; los tabiques se añaden a `group`. */
export function buildZones(shell: RoomShell, group: THREE.Group, walls: readonly WallInfo[], palette: RoomPalette): BuiltZones {
  const partitions: WallInfo[] = [];
  const zones: ZoneSurfaces[] = [];
  for (const zone of shell.zones ?? []) {
    const surfaces: ZoneSurfaces = { zoneId: zone.id, floor: zoneFloor(zone), innerMaterials: [], linings: [], tiles: [] };
    group.add(surfaces.floor);
    for (const edge of zoneEdges(shell, zone)) {
      if (edge.partition) {
        const info = buildPartition(shell, zone, edge.a, edge.b, edge.index, palette, surfaces);
        group.add(...info.groups, info.stub);
        partitions.push(info);
        continue;
      }
      if (zone.open) continue;
      const segment = shell.walls.find((w) => {
        const seg = [w.start, w.end];
        return distanceToBoundary(edge.a, seg) < ON_WALL_M && distanceToBoundary(edge.b, seg) < ON_WALL_M;
      });
      const wall = segment && walls.find((w) => w.wallId === segment.id);
      if (wall) liningOn(shell, wall, edge.a, edge.b, surfaces);
    }
    zones.push(surfaces);
  }
  return { partitions, zones };
}
