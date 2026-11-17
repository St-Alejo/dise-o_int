import type { CatalogItem, FurniturePlacement, RoomFinishes, RoomShell } from '@interiores/shared-types';
import * as THREE from 'three';
import { FurnitureFactory } from '../furniture-factory';
import { applyFinishes, buildRoom, DEFAULT_PALETTE, disposeObject, type BuiltRoom, type RoomPalette, type WallInfo } from '../room-builder';
import { hidesRoom } from './cutaway';
import type { SceneContext } from './render-loop';
import type { TextureLibrary } from './texture-library';

/** Un ambiente de la casa para dibujarlo: su geometría, dónde va y lo que tiene dentro. */
export interface HouseRoomData {
  roomId: string;
  name: string;
  /** Su cuarto de Interiores (null: escalera, hall, garaje… se ve pero no se amuebla). */
  projectId: string | null;
  /** Esquina del cuarto en la planta de la casa (m). */
  origin: { x: number; z: number };
  shell: RoomShell;
  finishes?: RoomFinishes | null;
  placements?: readonly FurniturePlacement[];
}

/**
 * Cómo se dibujan las paredes:
 * - `auto`: casa de muñecas, se cortan las que tapan su cuarto desde la cámara;
 * - `cut`: todas en corte (murete con tapa), para que no estorben al cuarto que se edita;
 * - `full`: enteras (recorriendo a pie, lo que se ve por una puerta).
 */
export type HouseWalls = 'auto' | 'cut' | 'full';

/** Escaleras, halls y garajes: piso gris de obra, para distinguirlos de lo que se amuebla. */
const SERVICE_PALETTE: RoomPalette = { ...DEFAULT_PALETTE, floor: '#cfcac2', wall: '#e4e0da' };
const HOVER_COLOR = new THREE.Color('#3b6fd8');

interface BuiltHouseRoom {
  data: HouseRoomData;
  holder: THREE.Group;
  room: BuiltRoom;
  /** Centro del cuarto en el mundo (para el rótulo). */
  center: THREE.Vector3;
}

/** Corta (o vuelve a levantar) una pared: deja de dibujarse, pero sigue dando sombra. */
export function setWallCut(wall: WallInfo, cut: boolean): boolean {
  if (wall.cut === cut) return false;
  wall.cut = cut;
  wall.stub.visible = cut;
  wall.tiles.visible = !cut;
  for (const m of wall.materials) {
    m.colorWrite = !cut;
    m.depthWrite = !cut && m.userData['baseDepthWrite'] !== false;
  }
  // Los pases de posprocesado (oclusión, contorno) ignoran lo que está marcado así.
  for (const g of wall.groups) g.userData['ghost'] = cut;
  return true;
}

/** Posición de un cuarto en la escena: su esquina menos la del cuarto que hace de centro. */
export function houseOffset(origin: { x: number; z: number }, center: { x: number; z: number }): { x: number; z: number } {
  return { x: Math.round((origin.x - center.x) * 1000) / 1000, z: Math.round((origin.z - center.z) * 1000) / 1000 };
}

/**
 * Varios cuartos de una casa en una escena, cada uno en su sitio, sin techo, con sus acabados y
 * sus muebles (solo para ver: no se seleccionan ni se arrastran). Sirve para la casa entera y para
 * los vecinos del cuarto que se está amueblando.
 */
export class HouseView {
  readonly root = new THREE.Group();
  private rooms: BuiltHouseRoom[] = [];
  private readonly factory: FurnitureFactory;
  /** Cada `sync` invalida los muebles que aún estaban cargando del anterior. */
  private generation = 0;
  private hovered: string | null = null;
  private disposed = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly textures: TextureLibrary | null = null,
    private walls: HouseWalls = 'auto',
  ) {
    this.factory = new FurnitureFactory(textures);
    this.root.name = 'house';
    ctx.scene.add(this.root);
  }

  get count(): number {
    return this.rooms.length;
  }

  /** Dibuja estos cuartos; `center` es el punto de la planta que va en el origen de la escena. */
  sync(rooms: readonly HouseRoomData[], catalog: ReadonlyMap<string, CatalogItem>, center: { x: number; z: number } = { x: 0, z: 0 }): void {
    this.clear();
    const generation = ++this.generation;
    for (const data of rooms) {
      const holder = new THREE.Group();
      holder.name = data.name;
      const at = houseOffset(data.origin, center);
      holder.position.set(at.x, 0, at.z);
      holder.userData['houseRoomId'] = data.roomId;
      const room = buildRoom(data.shell, data.projectId ? DEFAULT_PALETTE : SERVICE_PALETTE);
      room.ceiling.visible = false;
      if (data.finishes) applyFinishes(room, data.finishes, this.textures ?? undefined);
      holder.add(room.group);
      for (const p of data.placements ?? []) {
        const item = catalog.get(p.catalogItemId);
        if (!item) continue;
        void this.factory.create(item, p).then((object) => {
          if (this.disposed || generation !== this.generation) return;
          object.position.set(p.position.x, p.position.y, p.position.z);
          object.rotation.set(0, p.rotationY, 0);
          holder.add(object);
          this.ctx.invalidate();
        });
      }
      this.root.add(holder);
      // setFromObject ya pone el piso en el mundo (con el sitio del cuarto)
      const center3 = new THREE.Box3().setFromObject(room.floor).getCenter(new THREE.Vector3());
      this.rooms.push({ data, holder, room, center: center3 });
    }
    this.updateCutaway();
    this.ctx.invalidate();
  }

  setWalls(walls: HouseWalls): void {
    if (this.walls === walls) return;
    this.walls = walls;
    this.updateCutaway();
  }

  /** Lo que abarcan los cuartos (para encuadrar la cámara). */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const r of this.rooms) box.expandByObject(r.room.floor);
    return box;
  }

  /** Centro y datos de cada cuarto, para poner sus rótulos. */
  labels(): { roomId: string; name: string; projectId: string | null; at: THREE.Vector3 }[] {
    return this.rooms.map((r) => ({ roomId: r.data.roomId, name: r.data.name, projectId: r.data.projectId, at: r.center }));
  }

  /** Recorta las paredes que tapan su cuarto desde la cámara (o todas, en modo `cut`). */
  updateCutaway(): void {
    const cam = this.ctx.camera.position;
    let changed = false;
    for (const r of this.rooms) {
      const local = { x: cam.x - r.holder.position.x, z: cam.z - r.holder.position.z };
      for (const wall of [...r.room.walls, ...r.room.partitions]) {
        const cut = this.walls === 'cut' || (this.walls === 'auto' && hidesRoom(wall, local));
        changed = setWallCut(wall, cut) || changed;
      }
    }
    if (changed) this.ctx.invalidate();
  }

  /** El cuarto cuyo piso queda bajo el rayo, o null. */
  pick(raycaster: THREE.Raycaster): HouseRoomData | null {
    this.root.updateMatrixWorld();
    const hit = raycaster.intersectObjects(
      this.rooms.map((r) => r.room.floor),
      false,
    )[0];
    return hit ? (this.rooms.find((r) => r.room.floor === hit.object)?.data ?? null) : null;
  }

  /** Resalta el piso de un cuarto (al pasar el cursor). */
  setHover(roomId: string | null): void {
    if (this.hovered === roomId) return;
    this.hovered = roomId;
    for (const r of this.rooms) {
      const mat = r.room.floor.material as THREE.MeshStandardMaterial;
      const on = r.data.roomId === roomId;
      mat.emissive.copy(on ? HOVER_COLOR : new THREE.Color(0, 0, 0));
      mat.emissiveIntensity = on ? 0.35 : 1;
    }
    this.ctx.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    this.ctx.scene.remove(this.root);
    void this.factory.dispose();
  }

  private clear(): void {
    this.hovered = null;
    for (const r of this.rooms) {
      this.root.remove(r.holder);
      disposeObject(r.room.group);
    }
    this.rooms = [];
  }
}
