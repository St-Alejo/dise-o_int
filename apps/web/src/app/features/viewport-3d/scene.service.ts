import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import {
  clampToRoom,
  footprint,
  mountY,
  snapAngle,
  type CatalogItem,
  type FurniturePlacement,
  type RoomShell,
  type Vector3,
} from '@interiores/shared-types';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DesignProjectStore } from '../project/design-project.store';
import { MoveCommand, RemoveCommand, RotateCommand } from './commands';
import { FurnitureFactory } from './furniture-factory';
import { buildRoom, disposeObject, type BuiltRoom } from './room-builder';

interface FurnitureNode {
  group: THREE.Group;
  catalogItemId: string;
  loading: boolean;
  /** Medidas y materiales con los que se construyó: si cambian, se reconstruye el objeto. */
  shapeKey: string;
}

/** Lo que define la forma visible de una pieza (además de su mueble del catálogo). */
const shapeKeyOf = (p: FurniturePlacement) => JSON.stringify([p.dimensionsM ?? null, p.materials ?? null]);

const WALL_SNAP_M = 0.15;
const COLORS = { select: new THREE.Color('#d49a79'), invalid: new THREE.Color('#e53935') };

/**
 * Facade (§5 y §9): la ÚNICA puerta de entrada al mundo Three.js desde Angular.
 * - Refleja el estado del DesignProjectStore en la escena (reconciliación por id).
 * - Traduce los gestos (clic, arrastre, teclado) a COMANDOS del store (deshacer/rehacer).
 * - Expone su estado solo con signals; el resto de la app nunca toca `THREE.*`.
 * - Render bajo demanda: solo se dibuja un frame cuando algo cambió.
 */
@Injectable()
export class SceneService {
  private readonly store = inject(DesignProjectStore);
  private readonly factory = new FurnitureFactory();

  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 120);
  readonly sceneReady = signal(false);
  readonly dragging = signal(false);
  readonly invalidDrop = signal(false);
  readonly readOnly = signal(false);

  controls: OrbitControls | null = null;
  canvas: HTMLCanvasElement | null = null;

  private room: BuiltRoom | null = null;
  private readonly furnitureRoot = new THREE.Group();
  private readonly nodes = new Map<string, FurnitureNode>();
  private readonly selection: THREE.LineLoop;
  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private needsRender = true;
  private framedShellId: string | null = null;
  private disposed = false;

  private drag: {
    id: string;
    catalogItemId: string;
    start: Vector3;
    offset: THREE.Vector3;
    last: Vector3;
    lastValid: Vector3;
    moved: boolean;
  } | null = null;
  private pointerDownAt: { x: number; y: number } | null = null;

  constructor() {
    this.scene.background = new THREE.Color('#e9e3da');
    this.furnitureRoot.name = 'furniture';
    this.scene.add(this.furnitureRoot);

    const hemi = new THREE.HemisphereLight('#fff7ee', '#8a7560', 0.7);
    const sun = new THREE.DirectionalLight('#fff3e0', 1.6);
    sun.position.set(-3, 6, -2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.name = 'sun';
    this.scene.add(hemi, sun, sun.target);

    const selGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    this.selection = new THREE.LineLoop(selGeom, new THREE.LineBasicMaterial({ color: COLORS.select, depthTest: false }));
    this.selection.renderOrder = 999;
    this.selection.visible = false;
    this.scene.add(this.selection);

    // Estado → escena (signals). Cada efecto solo depende de lo que lee.
    effect(() => {
      const shell = this.store.shell();
      untracked(() => this.syncRoom(shell));
    });
    effect(() => {
      const placements = this.store.placements();
      const catalog = this.store.catalog();
      untracked(() => void this.syncFurniture(placements, catalog));
    });
    effect(() => {
      this.store.selectedId();
      this.store.placements();
      untracked(() => this.updateSelectionOutline());
    });
  }

  // ------------------------------------------------------------------ ciclo de vida
  /** Llamado por el viewport cuando ya existe el renderer (entorno PBR para reflejos realistas). */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(env, 0.04);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.55;
    env.dispose();
    pmrem.dispose();
    this.invalidate();
  }

  invalidate(): void {
    this.needsRender = true;
  }

  /** Avanza el estado por frame; devuelve true si hay que dibujar. */
  tick(): boolean {
    const moved = this.controls?.update() ?? false;
    if (moved) this.updateWallCutaway();
    const render = this.needsRender || moved;
    this.needsRender = false;
    return render;
  }

  setSize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.room) disposeObject(this.room.group);
    this.room = null;
    for (const node of this.nodes.values()) this.furnitureRoot.remove(node.group);
    this.nodes.clear();
    disposeObject(this.selection);
    this.envTarget?.dispose();
    this.scene.environment = null;
    await this.factory.dispose();
  }

  // ------------------------------------------------------------------ sincronización
  private syncRoom(shell: RoomShell | null): void {
    if (this.room) {
      this.scene.remove(this.room.group);
      disposeObject(this.room.group);
      this.room = null;
    }
    if (!shell) {
      this.sceneReady.set(false);
      return;
    }
    this.room = buildRoom(shell);
    this.scene.add(this.room.group);

    const sun = this.scene.getObjectByName('sun') as THREE.DirectionalLight;
    const span = Math.max(shell.widthM, shell.depthM);
    sun.position.set(shell.widthM * 0.2, shell.heightM * 2.6, -span * 0.4);
    sun.target.position.set(shell.widthM / 2, 0, shell.depthM / 2);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, far: span * 5 });
    sun.shadow.camera.updateProjectionMatrix();

    // Reencuadrar solo al abrir un cuarto nuevo (no al calibrar), para no marear al usuario.
    const key = `${shell.id}`;
    if (this.framedShellId !== key) {
      this.frameRoom(shell);
      this.framedShellId = key;
    }
    this.updateWallCutaway();
    this.sceneReady.set(true);
    this.invalidate();
  }

  frameRoom(shell = this.store.shell()): void {
    if (!shell) return;
    const cx = shell.widthM / 2;
    const cz = shell.depthM / 2;
    const span = Math.max(shell.widthM, shell.depthM);
    this.camera.position.set(cx + span * 0.1, shell.heightM * 1.6 + span * 0.2, shell.depthM + span * 0.55);
    this.camera.lookAt(cx, 0.4, cz);
    if (this.controls) {
      this.controls.target.set(cx, 0.4, cz);
      this.controls.maxDistance = span * 3;
      this.controls.update();
    }
    this.updateWallCutaway();
    this.invalidate();
  }

  private async syncFurniture(placements: readonly FurniturePlacement[], catalog: ReadonlyMap<string, CatalogItem>): Promise<void> {
    const wanted = new Set(placements.map((p) => p.id));
    for (const [id, node] of this.nodes) {
      const p = placements.find((x) => x.id === id);
      if (!wanted.has(id) || (p && (p.catalogItemId !== node.catalogItemId || shapeKeyOf(p) !== node.shapeKey))) {
        this.furnitureRoot.remove(node.group);
        this.nodes.delete(id);
      }
    }
    for (const p of placements) {
      const item = catalog.get(p.catalogItemId);
      if (!item) continue;
      let node = this.nodes.get(p.id);
      if (!node) {
        const group = new THREE.Group();
        group.userData['placementId'] = p.id;
        node = { group, catalogItemId: p.catalogItemId, loading: true, shapeKey: shapeKeyOf(p) };
        this.nodes.set(p.id, node);
        this.furnitureRoot.add(group);
        const created = node;
        void this.factory.create(item, p).then((object) => {
          if (this.disposed || this.nodes.get(p.id) !== created) return;
          created.group.add(object);
          created.loading = false;
          this.updateSelectionOutline();
          this.invalidate();
        });
      }
      if (this.drag?.id !== p.id) this.applyTransform(node.group, p.position, p.rotationY);
    }
    this.invalidate();
  }

  private applyTransform(group: THREE.Object3D, position: Vector3, rotationY: number): void {
    group.position.set(position.x, position.y, position.z);
    group.rotation.set(0, rotationY, 0);
  }

  private updateSelectionOutline(invalid = false): void {
    const sel = this.store.selected();
    const item = sel ? this.store.catalog().get(sel.catalogItemId) : null;
    if (!sel || !item) {
      this.selection.visible = false;
      this.invalidate();
      return;
    }
    const pos = this.drag?.id === sel.id ? this.drag.last : sel.position;
    const fp = footprint(pos, item.dimensionsM, sel.rotationY);
    const y = item.mount === 'ceiling' ? 0.02 : 0.015;
    const attr = this.selection.geometry.getAttribute('position') as THREE.BufferAttribute;
    fp.corners.forEach((c, i) => attr.setXYZ(i, c.x, y, c.z));
    attr.needsUpdate = true;
    this.selection.geometry.computeBoundingSphere();
    (this.selection.material as THREE.LineBasicMaterial).color = invalid ? COLORS.invalid : COLORS.select;
    this.selection.visible = true;
    this.invalidate();
  }

  /** Recorte tipo "casa de muñecas": las paredes entre la cámara y el cuarto se vuelven translúcidas. */
  private updateWallCutaway(): void {
    if (!this.room) return;
    const cam = this.camera.position;
    for (const wall of this.room.walls) {
      const toCamX = cam.x - wall.midpoint.x;
      const toCamZ = cam.z - wall.midpoint.z;
      const facingAway = wall.normal.x * toCamX + wall.normal.y * toCamZ < 0;
      for (const m of wall.materials) {
        const base = (m.userData['baseOpacity'] as number | undefined) ?? 1;
        const target = facingAway ? Math.min(base, 0.1) : base;
        if (m.opacity !== target) {
          m.opacity = target;
          m.depthWrite = target === 1;
          m.needsUpdate = true;
        }
      }
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------ interacción
  private ndc(event: PointerEvent): THREE.Vector2 {
    const rect = this.canvas!.getBoundingClientRect();
    return new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private pickFurniture(event: PointerEvent): string | null {
    this.raycaster.setFromCamera(this.ndc(event), this.camera);
    const hits = this.raycaster.intersectObjects(this.furnitureRoot.children, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData['placementId'] === undefined) o = o.parent;
      if (o) return o.userData['placementId'] as string;
    }
    return null;
  }

  private floorPoint(event: PointerEvent): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(event), this.camera);
    return this.raycaster.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
  }

  onPointerDown(event: PointerEvent): void {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
    const id = this.pickFurniture(event);
    if (!id) return;
    this.store.select(id);
    if (this.readOnly()) return;
    const placement = this.store.placements().find((p) => p.id === id);
    const hit = this.floorPoint(event);
    if (!placement || !hit) return;
    this.drag = {
      id,
      catalogItemId: placement.catalogItemId,
      start: { ...placement.position },
      offset: new THREE.Vector3(placement.position.x - hit.x, 0, placement.position.z - hit.z),
      last: { ...placement.position },
      lastValid: { ...placement.position },
      moved: false,
    };
    if (this.controls) this.controls.enabled = false;
    this.canvas?.setPointerCapture(event.pointerId);
    this.dragging.set(true);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.drag) {
      if (this.canvas && event.pointerType === 'mouse') {
        this.canvas.style.cursor = this.pickFurniture(event) ? (this.readOnly() ? 'pointer' : 'grab') : '';
      }
      return;
    }
    // Umbral de 4 px: un clic con un leve temblor del mouse no es un arrastre.
    const down = this.pointerDownAt;
    if (!this.drag.moved && down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4) return;
    const hit = this.floorPoint(event);
    const item = this.store.catalog().get(this.drag.catalogItemId);
    const placement = this.store.placements().find((p) => p.id === this.drag!.id);
    const shell = this.store.shell();
    if (!hit || !item || !placement || !shell) return;

    let pos = clampToRoom(
      { x: hit.x + this.drag.offset.x, y: this.drag.start.y, z: hit.z + this.drag.offset.z },
      item.dimensionsM,
      placement.rotationY,
      shell,
    );
    pos = this.snapToWalls(pos, item, placement.rotationY, shell);
    this.drag.last = pos;
    this.drag.moved = true;
    const valid = this.store.isPoseValid(placement.id, placement.catalogItemId, pos, placement.rotationY);
    if (valid) this.drag.lastValid = pos;
    this.invalidDrop.set(!valid);
    const node = this.nodes.get(placement.id);
    if (node) this.applyTransform(node.group, pos, placement.rotationY);
    if (this.canvas) this.canvas.style.cursor = 'grabbing';
    this.updateSelectionOutline(!valid);
  }

  onPointerUp(event: PointerEvent): void {
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    if (this.drag) {
      const { id, start, lastValid, moved } = this.drag;
      this.drag = null;
      this.dragging.set(false);
      this.invalidDrop.set(false);
      if (this.controls) this.controls.enabled = true;
      if (this.canvas?.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      const changed = moved && (Math.abs(start.x - lastValid.x) > 1e-3 || Math.abs(start.z - lastValid.z) > 1e-3);
      if (changed) {
        this.store.execute(new MoveCommand(id, start, lastValid));
      } else {
        // Si terminó en una pose inválida, vuelve a la última válida (la del store).
        const p = this.store.placements().find((x) => x.id === id);
        const node = this.nodes.get(id);
        if (p && node) this.applyTransform(node.group, p.position, p.rotationY);
      }
      this.updateSelectionOutline();
      return;
    }
    // Clic (sin arrastrar la cámara) sobre el vacío → deseleccionar
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5 && !this.pickFurniture(event)) {
      this.store.select(null);
    }
  }

  /** Pega el mueble a la pared si está a menos de 15 cm (colocar contra la pared es lo habitual). */
  private snapToWalls(pos: Vector3, item: CatalogItem, rotationY: number, shell: RoomShell): Vector3 {
    const fp = footprint(pos, item.dimensionsM, rotationY);
    const xs = fp.corners.map((c) => c.x);
    const zs = fp.corners.map((c) => c.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const out = { ...pos };
    if (minX < WALL_SNAP_M) out.x -= minX;
    else if (shell.widthM - maxX < WALL_SNAP_M) out.x += shell.widthM - maxX;
    if (minZ < WALL_SNAP_M) out.z -= minZ;
    else if (shell.depthM - maxZ < WALL_SNAP_M) out.z += shell.depthM - maxZ;
    return out;
  }

  // ------------------------------------------------------------------ acciones (teclado / toolbar)
  rotateSelected(deltaRad: number): void {
    const p = this.store.selected();
    const item = this.store.selectedItem();
    const shell = this.store.shell();
    if (!p || !item || !shell || this.readOnly()) return;
    const to = snapAngle(p.rotationY + deltaRad);
    // Al girar, un mueble junto a la pared podría salirse: se reajusta la posición.
    const pos = clampToRoom(p.position, item.dimensionsM, to, shell);
    this.store.execute(new RotateCommand(p.id, p.rotationY, to, p.position, pos));
  }

  nudgeSelected(dx: number, dz: number): void {
    const p = this.store.selected();
    const item = this.store.selectedItem();
    const shell = this.store.shell();
    if (!p || !item || !shell || this.readOnly()) return;
    const to = clampToRoom({ x: p.position.x + dx, y: p.position.y, z: p.position.z + dz }, item.dimensionsM, p.rotationY, shell);
    if (!this.store.isPoseValid(p.id, p.catalogItemId, to, p.rotationY)) return;
    this.store.execute(new MoveCommand(p.id, p.position, to));
  }

  removeSelected(): void {
    const p = this.store.selected();
    if (!p || this.readOnly()) return;
    this.store.execute(new RemoveCommand(p));
    this.store.select(null);
  }

  /** Centro del cuarto a la altura correcta para un mueble (para añadir desde el catálogo). */
  roomCenterFor(item: CatalogItem): Vector3 {
    const shell = this.store.shell()!;
    return { x: shell.widthM / 2, y: mountY(item.mount, item.dimensionsM, shell), z: shell.depthM / 2 };
  }
}
