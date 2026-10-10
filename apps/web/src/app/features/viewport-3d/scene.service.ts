import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { finishesForStyle, mountY, type CatalogItem, type RoomShell, type Vector3 } from '@interiores/shared-types';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DesignProjectStore } from '../project/design-project.store';
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
  cameraMode: 'orbit';
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
 * `LightingRig`, `DragController` y `SelectionActions`.
 */
@Injectable()
export class SceneService implements SceneContext {
  private readonly store = inject(DesignProjectStore);

  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 120);
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

  readonly dragging = this.dragController.dragging.asReadonly();
  readonly invalidDrop = this.dragController.invalidDrop.asReadonly();

  private needsRender = true;
  private framedShellId: string | null = null;

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
      untracked(() => this.furniture.sync(placements, catalog, (id) => this.dragController.holds(id)));
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

  /** Registra algo que avanza en cada frame (p. ej. un modo de cámara). */
  addFrameSystem(system: FrameSystem): void {
    this.systems.push(system);
  }

  /** Avanza el estado por frame (`dt` en segundos); devuelve true si hay que dibujar. */
  tick(dt = 0): boolean {
    let moved = this.controls?.update() ?? false;
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
    return { walls: this.room.wallCount, hasCeiling: this.room.hasCeiling, cameraMode: 'orbit', placements: this.furniture.count };
  }

  async dispose(): Promise<void> {
    this.room.dispose();
    this.selection.dispose();
    this.lighting.dispose();
    await this.furniture.dispose();
  }

  // ------------------------------------------------------------------ sincronización
  private syncRoom(shell: RoomShell | null): void {
    this.room.sync(shell);
    if (!shell) {
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
    this.room.updateCutaway();
    this.invalidate();
  }

  private refreshSelection(invalid = false): void {
    const placement = this.store.selected();
    const item = placement ? this.store.catalog().get(placement.catalogItemId) : null;
    this.selection.update(placement && item ? { placement, item, pose: this.dragController.poseOf(placement.id), invalid } : null);
  }

  // ------------------------------------------------------------------ interacción
  onPointerDown(event: PointerEvent): void {
    this.dragController.onPointerDown(event);
  }

  onPointerMove(event: PointerEvent): void {
    this.dragController.onPointerMove(event);
  }

  onPointerUp(event: PointerEvent): void {
    this.dragController.onPointerUp(event);
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
    return { x: shell.widthM / 2, y: mountY(item.mount, item.dimensionsM, shell), z: shell.depthM / 2 };
  }
}
