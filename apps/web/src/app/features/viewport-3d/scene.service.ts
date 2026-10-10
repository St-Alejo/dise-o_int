import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import {
  buildWalkWorld,
  effectiveDimensions,
  finishesForStyle,
  footprint,
  mountY,
  roomCenter,
  walkStart,
  type CatalogItem,
  type RoomShell,
  type Vector3,
  type WalkWorld,
} from '@interiores/shared-types';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DesignProjectStore } from '../project/design-project.store';
import { CameraDirector } from './camera/camera-director';
import type { CameraModeId, CameraPose } from './camera/camera-mode';
import { ORBIT_FOV, OrbitMode } from './camera/orbit-mode';
import { WalkMode } from './camera/walk-mode';
import { DragController } from './scene/drag-controller';
import { FurnitureView } from './scene/furniture-view';
import { LightingRig } from './scene/lighting-rig';
import type { FrameSystem, SceneContext } from './scene/render-loop';
import { RoomView } from './scene/room-view';
import { SelectionActions } from './scene/selection-actions';
import { SelectionView } from './scene/selection-view';

/** Lo que las pruebas e2e pueden leer de la escena sin comparar píxeles. */
export interface SceneSnapshot {
  walls: number;
  hasCeiling: boolean;
  cameraMode: CameraModeId;
  /** Posición de la cámara, redondeada al centímetro. */
  camera: { x: number; y: number; z: number };
  placements: number;
}

/**
 * Facade (§5 y §9): la ÚNICA puerta de entrada al mundo Three.js desde Angular.
 * - Refleja el estado del DesignProjectStore en la escena (signals → vistas de `scene/`).
 * - Traduce los gestos (clic, arrastre, teclado) a COMANDOS del store (deshacer/rehacer).
 * - Expone su estado solo con signals; el resto de la app nunca toca `THREE.*`.
 * - Render bajo demanda: solo se dibuja un frame cuando algo cambió.
 *
 * El trabajo lo hacen sus colaboradores: `RoomView`, `FurnitureView`, `SelectionView`,
 * `LightingRig`, `DragController`, `SelectionActions` y, para la cámara, `CameraDirector` con sus
 * modos (`OrbitMode`, `WalkMode`).
 */
@Injectable()
export class SceneService implements SceneContext {
  private readonly store = inject(DesignProjectStore);

  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.05, 120);
  readonly sceneReady = signal(false);
  readonly readOnly = signal(false);

  controls: OrbitControls | null = null;
  canvas: HTMLCanvasElement | null = null;

  private readonly lighting = new LightingRig(this.scene);
  private readonly room = new RoomView(this);
  private readonly furniture = new FurnitureView(this, () => this.refreshSelection());
  private readonly selection = new SelectionView(this);
  private readonly actions = new SelectionActions(this.store, () => this.readOnly());
  private readonly dragController = new DragController(this, this.store, this.furniture, {
    canvas: () => this.canvas,
    readOnly: () => this.readOnly(),
    setCameraEnabled: (enabled) => {
      if (this.controls) this.controls.enabled = enabled;
    },
    refreshSelection: (invalid) => this.refreshSelection(invalid),
  });
  private readonly systems: FrameSystem[] = [];

  private readonly orbit = new OrbitMode(
    this.camera,
    () => this.controls,
    () => this.homePose(),
  );
  private readonly walk = new WalkMode(
    this.camera,
    () => this.world(),
    () => walkStart(this.store.shell()!, this.world()),
  );
  private readonly director = new CameraDirector(this.camera, { orbit: this.orbit, walk: this.walk }, (id) => this.onCameraArrived(id));

  readonly dragging = this.dragController.dragging.asReadonly();
  readonly invalidDrop = this.dragController.invalidDrop.asReadonly();
  /** Modo de cámara en el que se está o hacia el que se va: órbita o recorrido a pie. */
  readonly cameraMode = this.director.mode.asReadonly();

  private needsRender = true;
  private framedShellId: string | null = null;
  /** Mundo del recorrido (paredes y muebles que estorban); se recalcula si cambia la escena. */
  private walkWorld: WalkWorld | null = null;
  private lookFrom: { x: number; y: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor() {
    this.scene.background = new THREE.Color('#e9e3da');

    // Estado → escena (signals). Cada efecto solo depende de lo que lee.
    effect(() => {
      const shell = this.store.shell();
      untracked(() => this.syncRoom(shell));
    });
    effect(() => {
      const placements = this.store.placements();
      const catalog = this.store.catalog();
      untracked(() => {
        this.walkWorld = null;
        this.furniture.sync(placements, catalog, (id) => this.dragController.holds(id));
      });
    });
    effect(() => {
      this.store.selectedId();
      this.store.placements();
      untracked(() => this.refreshSelection());
    });
    // Acabados propios o, si no hay, la paleta del estilo elegido.
    effect(() => {
      const finishes = this.store.finishes() ?? finishesForStyle(this.store.project()?.selectedStyleId ?? null);
      this.store.shell(); // reaplicar al reconstruir el cuarto
      untracked(() => this.room.applyFinishes(finishes));
    });
  }

  // ------------------------------------------------------------------ ciclo de vida
  /** Llamado por el viewport cuando ya existe el renderer. */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    this.lighting.attachRenderer(renderer);
    this.invalidate();
  }

  invalidate(): void {
    this.needsRender = true;
  }

  /** Registra algo que avanza en cada frame. */
  addFrameSystem(system: FrameSystem): void {
    this.systems.push(system);
  }

  /** Avanza el estado por frame (`dt` en segundos); devuelve true si hay que dibujar. */
  tick(dt = 0): boolean {
    let moved = this.director.update(dt);
    for (const system of this.systems) moved = system.update(dt) || moved;
    if (moved) this.room.updateCutaway();
    const render = this.needsRender || moved;
    this.needsRender = false;
    return render;
  }

  setSize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  snapshot(): SceneSnapshot {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const { x, y, z } = this.camera.position;
    return {
      walls: this.room.wallCount,
      hasCeiling: this.room.hasCeiling,
      cameraMode: this.cameraMode(),
      camera: { x: r2(x), y: r2(y), z: r2(z) },
      placements: this.furniture.count,
    };
  }

  async dispose(): Promise<void> {
    this.room.dispose();
    this.selection.dispose();
    this.lighting.dispose();
    await this.furniture.dispose();
  }

  // ------------------------------------------------------------------ sincronización
  private syncRoom(shell: RoomShell | null): void {
    this.walkWorld = null;
    this.room.sync(shell);
    if (!shell) {
      if (this.cameraMode() === 'walk') this.director.switchTo('orbit', { instant: true });
      this.sceneReady.set(false);
      return;
    }
    this.lighting.fitToRoom(shell);
    // Reencuadrar solo al abrir un cuarto nuevo (no al calibrar), para no marear al usuario.
    if (this.framedShellId !== shell.id) {
      this.frameRoom(shell);
      this.framedShellId = shell.id;
    }
    this.sceneReady.set(true);
    this.invalidate();
  }

  /** Vista de órbita por defecto: el cuarto entero, desde el frente y algo por encima. */
  private homePose(shell = this.store.shell()): CameraPose {
    if (!shell) return { position: this.camera.position.clone(), target: new THREE.Vector3(), fov: ORBIT_FOV };
    const cx = shell.widthM / 2;
    const cz = shell.depthM / 2;
    const span = Math.max(shell.widthM, shell.depthM);
    return {
      position: new THREE.Vector3(cx + span * 0.1, shell.heightM * 1.6 + span * 0.2, shell.depthM + span * 0.55),
      target: new THREE.Vector3(cx, 0.4, cz),
      fov: ORBIT_FOV,
    };
  }

  frameRoom(shell = this.store.shell()): void {
    if (!shell || this.cameraMode() === 'walk') return;
    this.orbit.reset();
    const home = this.homePose(shell);
    this.camera.position.copy(home.position);
    this.camera.lookAt(home.target);
    if (this.controls) {
      this.controls.target.copy(home.target);
      this.controls.maxDistance = Math.max(shell.widthM, shell.depthM) * 3;
      this.controls.update();
    }
    this.room.updateCutaway();
    this.invalidate();
  }

  private refreshSelection(invalid = false): void {
    const placement = this.store.selected();
    const item = placement ? this.store.catalog().get(placement.catalogItemId) : null;
    this.selection.update(placement && item ? { placement, item, pose: this.dragController.poseOf(placement.id), invalid } : null);
  }

  // ------------------------------------------------------------------ cámara
  /** Cambia entre la vista de órbita y el recorrido a pie (con un vuelo de cámara entre ambas). */
  setCameraMode(mode: CameraModeId): void {
    if (mode === this.cameraMode() || !this.store.shell()) return;
    if (mode === 'walk') {
      // Recorrer es solo mirar: nada seleccionado y el mundo de colisión al día.
      this.store.select(null);
      this.walkWorld = null;
    } else {
      this.room.setCutaway(true);
    }
    this.director.switchTo(mode);
    this.invalidate();
  }

  private onCameraArrived(mode: CameraModeId): void {
    // Dentro del cuarto las paredes se ven enteras; desde fuera se recortan las que estorban.
    this.room.setCutaway(mode === 'orbit');
    this.invalidate();
  }

  /** Tecla durante el recorrido; devuelve true si era de movimiento. */
  walkKey(code: string, down: boolean): boolean {
    if (this.cameraMode() !== 'walk') return false;
    const handled = this.walk.key(code, down);
    if (handled) this.invalidate();
    return handled;
  }

  releaseWalkKeys(): void {
    this.walk.releaseKeys();
  }

  /** Paredes y muebles que estorban al caminar, con la escena tal como está ahora. */
  private world(): WalkWorld {
    const shell = this.store.shell();
    if (!shell) return { room: [], walls: [], obstacles: [] };
    this.walkWorld ??= buildWalkWorld(
      shell,
      this.store.placements().flatMap((p) => {
        const item = this.store.catalog().get(p.catalogItemId);
        if (!item) return [];
        const dims = effectiveDimensions(item.dimensionsM, p);
        return [{ corners: footprint(p.position, dims, p.rotationY).corners, baseY: p.position.y, heightM: dims.y }];
      }),
    );
    return this.walkWorld;
  }

  // ------------------------------------------------------------------ interacción
  onPointerDown(event: PointerEvent): void {
    if (this.cameraMode() !== 'walk') return this.dragController.onPointerDown(event);
    this.lookFrom = { x: event.clientX, y: event.clientY };
    this.canvas?.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.cameraMode() !== 'walk') return this.dragController.onPointerMove(event);
    if (!this.lookFrom) return;
    this.walk.look(event.clientX - this.lookFrom.x, event.clientY - this.lookFrom.y);
    this.lookFrom = { x: event.clientX, y: event.clientY };
    this.invalidate();
  }

  onPointerUp(event: PointerEvent): void {
    if (this.cameraMode() !== 'walk') return this.dragController.onPointerUp(event);
    this.lookFrom = null;
    if (this.canvas?.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  }

  /** Doble clic durante el recorrido: caminar hasta ese punto del piso. */
  onDoubleClick(event: MouseEvent): void {
    if (this.cameraMode() !== 'walk' || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
    if (!hit) return;
    this.walk.goTo({ x: hit.x, z: hit.z });
    this.invalidate();
  }

  // ------------------------------------------------------------------ acciones (teclado / toolbar)
  rotateSelected(deltaRad: number): void {
    this.actions.rotate(deltaRad);
  }

  nudgeSelected(dx: number, dz: number): void {
    this.actions.nudge(dx, dz);
  }

  removeSelected(): void {
    this.actions.remove();
  }

  /** Centro del cuarto a la altura correcta para un mueble (para añadir desde el catálogo). */
  roomCenterFor(item: CatalogItem): Vector3 {
    const shell = this.store.shell()!;
    return { ...roomCenter(shell), y: mountY(item.mount, item.dimensionsM, shell) };
  }
}
