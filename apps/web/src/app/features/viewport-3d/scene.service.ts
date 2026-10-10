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
  type Point2,
  type RoomShell,
  type SnapGuide,
  type Vector3,
  type WalkWorld,
} from '@interiores/shared-types';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clearancesOf, metres } from '../floor-plan/floor-plan-model';
import { DesignProjectStore } from '../project/design-project.store';
import { CameraDirector } from './camera/camera-director';
import type { CameraModeId, CameraPose } from './camera/camera-mode';
import { ORBIT_FOV, OrbitMode } from './camera/orbit-mode';
import { WalkMode } from './camera/walk-mode';
import type { GizmoHandleKind } from './mounts/gizmo-math';
import type { Ray } from './mounts/mount-strategies';
import { DragController } from './scene/drag-controller';
import { FurnitureView } from './scene/furniture-view';
import { GizmoController } from './scene/gizmo-controller';
import { GizmoView } from './scene/gizmo-view';
import { GuidesView } from './scene/guides-view';
import { OverlayLabels } from './scene/overlay-labels';
import { LightingRig, type TimeOfDay } from './scene/lighting-rig';
import type { FrameSystem, SceneContext } from './scene/render-loop';
import { RoomView } from './scene/room-view';
import { SelectionActions } from './scene/selection-actions';
import { SelectionView } from './scene/selection-view';
import { MeasureTool, PaintTool, RoomTool, SelectTool, ToolManager, type PaintTarget, type ToolEvent, type ViewportToolId } from './tools/tools';

/** Lo que las pruebas e2e pueden leer de la escena sin comparar píxeles. */
export interface SceneSnapshot {
  walls: number;
  hasCeiling: boolean;
  cameraMode: CameraModeId;
  /** Posición de la cámara, redondeada al centímetro. */
  camera: { x: number; y: number; z: number };
  timeOfDay: TimeOfDay;
  /** Lámparas del cuarto que están alumbrando. */
  lamps: number;
  placements: number;
  /** Herramienta activa del visor. */
  tool: ViewportToolId;
  selectedId: string | null;
  /** Tiradores del gizmo, con su posición en la ventana (para arrastrarlos en las pruebas). */
  gizmo: { kind: GizmoHandleKind; x: number; y: number }[];
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
  /** Lo registra el viewport, que es quien tiene el renderer: dibuja un frame y lo devuelve como imagen. */
  frameCapture: (() => Promise<Blob | null>) | null = null;

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
    guides: (guides) => this.showSnapGuides(guides),
  });
  private readonly systems: FrameSystem[] = [];

  private readonly gizmoView = new GizmoView(this);
  private readonly guides = new GuidesView(this);
  /** Textos y controles HTML pegados a puntos de la escena (cotas, barra del mueble). */
  readonly labels = new OverlayLabels();
  private readonly gizmo = new GizmoController(this.store, this.actions, (poses) => this.previewPoses(poses));
  private readonly tools = new ToolManager(
    [
      new SelectTool({
        pickHandle: () => this.gizmoView.pick(this.raycaster),
        beginHandle: (kind, e) => this.gizmo.begin(kind, this.gizmoPointer(e)),
        moveHandle: (e) => {
          this.gizmo.move(this.gizmoPointer(e));
          this.refreshSelection();
        },
        endHandle: () => {
          this.gizmo.end();
          this.refreshSelection();
        },
        highlight: (kind) => this.gizmoView.highlight(kind),
        dragDown: (event) => this.dragController.onPointerDown(event),
        dragMove: (event) => this.dragController.onPointerMove(event),
        dragUp: (event) => this.dragController.onPointerUp(event),
        readOnly: () => this.readOnly(),
      }),
      new RoomTool(this.store, {
        shell: () => this.store.shell(),
        panBy: (dx, dz) => this.panBy(dx, dz),
        message: (text) => this.toolMessage.set(text),
      }),
      new PaintTool({
        shell: () => this.store.shell(),
        pickItem: () => this.furniture.pick(this.raycaster),
        select: (id) => this.store.select(id),
        open: (target, at) => this.paintTarget.set(target && at ? { target, ...this.localPoint(at.x, at.y) } : null),
      }),
      new MeasureTool({ measure: (line) => this.showMeasure(line) }),
    ],
    (id) => this.tool.set(id),
  );
  /** Herramienta activa del visor: mover, paredes, pintar o medir. */
  readonly tool = signal<ViewportToolId>('select');
  /** Aviso de la herramienta en curso (un cuarto imposible, una medida que no cabe). */
  readonly toolMessage = signal<string | null>(null);
  readonly gizmoMessage = this.gizmo.message.asReadonly();
  /** Superficie que se está pintando y dónde mostrar su paleta (píxeles dentro del visor). */
  readonly paintTarget = signal<{ target: PaintTarget; x: number; y: number } | null>(null);

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
  private size = { width: 1, height: 1 };
  private pressed = false;
  /** Poses provisionales que llegan de fuera del visor (el plano, el aro de rotación). */
  private previewed: ReadonlyMap<string, { position: Vector3; rotationY: number }> | null = null;
  private framedShellId: string | null = null;
  /** Mundo del recorrido (paredes y muebles que estorban); se recalcula si cambia la escena. */
  private walkWorld: WalkWorld | null = null;
  private lookFrom: { x: number; y: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** Hora del día con la que se ilumina el cuarto. */
  readonly timeOfDay = signal<TimeOfDay>('day');

  constructor() {
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
        this.syncLamps();
      });
    });
    effect(() => {
      this.store.selectedId();
      this.store.placements();
      this.store.shell();
      this.cameraMode();
      this.readOnly();
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
    if (render) {
      this.gizmoView.rescale();
      this.labels.update(this.camera, this.size.width, this.size.height);
    }
    return render;
  }

  setSize(width: number, height: number): void {
    this.size = { width, height };
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
      timeOfDay: this.timeOfDay(),
      lamps: this.lighting.lampCount,
      placements: this.furniture.count,
      tool: this.tool(),
      selectedId: this.store.selectedId(),
      gizmo: this.gizmoView.handlePositions().map(({ kind, position }) => ({ kind, ...this.clientPoint(position) })),
    };
  }

  async dispose(): Promise<void> {
    this.room.dispose();
    this.selection.dispose();
    this.gizmoView.dispose();
    this.guides.dispose();
    this.labels.attach(null);
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
    const pose = placement ? (this.previewed?.get(placement.id) ?? this.dragController.poseOf(placement.id)) : null;
    this.selection.update(placement && item ? { placement, item, pose, invalid } : null);
    const editable = !this.readOnly() && this.cameraMode() !== 'walk' && this.tool() === 'select';
    this.gizmoView.update(editable ? this.gizmo.layout(pose) : null);
    this.showClearances(editable && placement && item && item.mount === 'floor' && !placement.supportId ? { placement, item, pose } : null);
  }

  /** Cotas del mueble seleccionado hasta las paredes, dibujadas en el piso. */
  private showClearances(target: { placement: { position: Vector3; rotationY: number; dimensionsM?: Vector3 }; item: CatalogItem; pose: { position: Vector3; rotationY: number } | null } | null): void {
    const shell = this.store.shell();
    if (!target || !shell) {
      this.guides.set('clearance', []);
      this.labels.set('clearance', []);
      return;
    }
    const { placement, item, pose } = target;
    const corners = footprint(pose?.position ?? placement.position, effectiveDimensions(item.dimensionsM, placement), pose?.rotationY ?? placement.rotationY).corners;
    const lines = clearancesOf(shell, corners);
    const y = 0.03;
    this.guides.set(
      'clearance',
      lines.map((c) => [
        { x: c.from.x, y, z: c.from.y },
        { x: c.to.x, y, z: c.to.y },
      ]),
    );
    this.labels.set(
      'clearance',
      lines.map((c) => ({ position: { x: (c.from.x + c.to.x) / 2, y, z: (c.from.y + c.to.y) / 2 }, text: c.label.text, kind: 'clearance' as const })),
    );
  }

  /** Guías de alineación de la pieza que se arrastra. */
  private showSnapGuides(guides: readonly SnapGuide[]): void {
    const y = 0.035;
    this.guides.set(
      'snap',
      guides.map((g) =>
        g.axis === 'x'
          ? ([
              { x: g.at, y, z: g.from },
              { x: g.at, y, z: g.to },
            ] as const)
          : ([
              { x: g.from, y, z: g.at },
              { x: g.to, y, z: g.at },
            ] as const),
      ),
    );
  }

  /** Regla entre dos puntos del piso. */
  private showMeasure(line: { from: Point2; to: Point2 } | null): void {
    const y = 0.04;
    this.guides.set('measure', line ? [[{ x: line.from.x, y, z: line.from.z }, { x: line.to.x, y, z: line.to.z }]] : []);
    this.labels.set(
      'measure',
      line
        ? [
            {
              position: { x: (line.from.x + line.to.x) / 2, y: 0.12, z: (line.from.z + line.to.z) / 2 },
              text: metres(Math.hypot(line.to.x - line.from.x, line.to.z - line.from.z)),
              kind: 'measure' as const,
            },
          ]
        : [],
    );
    this.invalidate();
  }

  /** Punto sobre el mueble seleccionado donde va su barra de acciones (null = no mostrarla). */
  selectionAnchor(): Vector3 | null {
    const placement = this.store.selected();
    const item = placement ? this.store.catalog().get(placement.catalogItemId) : null;
    if (!placement || !item) return null;
    const pose = this.previewed?.get(placement.id) ?? this.dragController.poseOf(placement.id);
    const position = pose?.position ?? placement.position;
    return { x: position.x, y: position.y + effectiveDimensions(item.dimensionsM, placement).y + 0.3, z: position.z };
  }

  // ------------------------------------------------------------------ herramientas
  setTool(id: ViewportToolId): void {
    if (this.readOnly() || this.cameraMode() === 'walk') return;
    this.tools.use(id);
    this.paintTarget.set(null);
    if (this.canvas) this.canvas.style.cursor = '';
    this.refreshSelection();
  }

  /** Rayo del cursor (deja apuntado también el raycaster de la escena). */
  private toolEvent(event: PointerEvent): ToolEvent | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const ray: Ray = { origin: { x: origin.x, y: origin.y, z: origin.z }, direction: { x: direction.x, y: direction.y, z: direction.z } };
    return { ray, event };
  }

  private gizmoPointer(e: ToolEvent): { ray: Ray; free: boolean } {
    return { ray: e.ray, free: e.event.altKey };
  }

  /** Posición en la ventana de un punto de la escena. */
  private clientPoint(position: { x: number; y: number; z: number }): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    const p = new THREE.Vector3(position.x, position.y, position.z).project(this.camera);
    return {
      x: Math.round((rect?.left ?? 0) + ((p.x + 1) / 2) * (rect?.width ?? 0)),
      y: Math.round((rect?.top ?? 0) + ((1 - p.y) / 2) * (rect?.height ?? 0)),
    };
  }

  /** Coordenadas de la ventana → píxeles dentro del visor. */
  private localPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  /**
   * Vista previa de un arrastre hecho fuera del visor (en el plano): mueve las piezas en la escena
   * sin tocar el estado. Con `null` vuelven a donde dice el proyecto.
   */
  previewPoses(poses: ReadonlyMap<string, { position: Vector3; rotationY: number }> | null): void {
    this.previewed = poses;
    if (poses) for (const [id, pose] of poses) this.furniture.place(id, pose.position, pose.rotationY);
    else for (const p of this.store.placements()) this.furniture.place(p.id, p.position, p.rotationY);
    this.refreshSelection();
    this.invalidate();
  }

  /**
   * Desplaza la cámara de órbita en planta. El cuarto vive pegado al origen: al empujar su pared
   * izquierda o la del fondo todo se corre, y la cámara lo acompaña para que no parezca un salto.
   */
  panBy(dx: number, dz: number): void {
    if (this.cameraMode() === 'walk') return;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
    if (this.controls) {
      this.controls.target.x += dx;
      this.controls.target.z += dz;
      this.controls.update();
    }
    this.room.updateCutaway();
    this.invalidate();
  }

  // ------------------------------------------------------------------ luz
  /** De día alumbra el sol; de noche, las lámparas del cuarto. */
  setTimeOfDay(time: TimeOfDay): void {
    this.timeOfDay.set(time);
    this.lighting.setTimeOfDay(time);
    this.invalidate();
  }

  /** Cada lámpara colocada alumbra desde donde está su pantalla. */
  private syncLamps(): void {
    const catalog = this.store.catalog();
    this.lighting.syncLamps(
      this.store.placements().flatMap((p) => {
        const item = catalog.get(p.catalogItemId);
        if (!item || item.category !== 'lighting') return [];
        const dims = effectiveDimensions(item.dimensionsM, p);
        // Las colgantes alumbran por abajo; las de pie y de mesa, cerca de su parte alta.
        const y = item.mount === 'ceiling' ? p.position.y + 0.1 : p.position.y + dims.y * 0.85;
        return [{ id: p.id, x: p.position.x, y, z: p.position.z }];
      }),
    );
    this.invalidate();
  }

  // ------------------------------------------------------------------ cámara
  /** Cambia entre la vista de órbita y el recorrido a pie (con un vuelo de cámara entre ambas). */
  setCameraMode(mode: CameraModeId): void {
    if (mode === this.cameraMode() || !this.store.shell()) return;
    if (mode === 'walk') {
      // Recorrer es solo mirar: nada seleccionado y el mundo de colisión al día.
      this.setTool('select');
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
    if (this.cameraMode() !== 'walk') {
      const e = event.button === 0 ? this.toolEvent(event) : null;
      if (!e) return;
      this.pressed = true;
      this.paintTarget.set(null);
      if (this.tools.down(e)) {
        // La herramienta se queda con el gesto: la cámara espera a que se suelte.
        if (this.controls) this.controls.enabled = false;
        this.canvas?.setPointerCapture(event.pointerId);
      }
      return;
    }
    this.lookFrom = { x: event.clientX, y: event.clientY };
    this.canvas?.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.cameraMode() !== 'walk') {
      const e = this.toolEvent(event);
      if (!e) return;
      const cursor = this.tools.move(e, this.pressed);
      if (this.canvas && cursor !== null && (cursor || this.tool() !== 'select')) this.canvas.style.cursor = cursor;
      return;
    }
    if (!this.lookFrom) return;
    this.walk.look(event.clientX - this.lookFrom.x, event.clientY - this.lookFrom.y);
    this.lookFrom = { x: event.clientX, y: event.clientY };
    this.invalidate();
  }

  onPointerUp(event: PointerEvent): void {
    if (this.cameraMode() !== 'walk') {
      const e = this.pressed ? this.toolEvent(event) : null;
      if (!e) return;
      this.pressed = false;
      const captured = this.tools.busy;
      this.tools.up(e);
      if (captured) {
        if (this.controls) this.controls.enabled = true;
        if (this.canvas?.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      }
      return;
    }
    this.lookFrom = null;
    if (this.canvas?.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  }

  /** Doble clic durante el recorrido: caminar hasta ese punto del piso. */
  onDoubleClick(event: MouseEvent): void {
    if (this.cameraMode() !== 'walk') return;
    const hit = this.floorPointAt(event.clientX, event.clientY);
    if (!hit) return;
    this.walk.goTo(hit);
    this.invalidate();
  }

  /** Punto del piso que queda bajo una posición de la pantalla (para soltar un mueble del catálogo). */
  floorPointAt(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** Imagen PNG de lo que muestra el visor ahora mismo (null si no hay visor o está oculto). */
  capturePng(): Promise<Blob | null> {
    return this.frameCapture ? this.frameCapture() : Promise.resolve(null);
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
