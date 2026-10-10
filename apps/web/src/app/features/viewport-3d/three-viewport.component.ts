import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  computed,
  input,
  isDevMode,
  signal,
  viewChild,
} from '@angular/core';
import { inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { RoomActionsComponent } from '../floor-plan/room-actions.component';
import { PaintPaletteComponent } from './tools/paint-palette.component';
import { VIEWPORT_TOOLS } from './tools/tools';
import { SceneService } from './scene.service';

/**
 * Viewport 3D como "caja negra" aislada (§5 del documento):
 * 1. El render loop corre FUERA de la zona de Angular (runOutsideAngular) y solo dibuja
 *    cuando algo cambió (render bajo demanda): Angular nunca se entera de los frames.
 * 2. Todo el estado sale vía SceneService (signals); este componente solo posee el canvas.
 * 3. En ngOnDestroy se libera TODA la memoria GPU (geometrías, materiales, texturas,
 *    render targets y el contexto WebGL): la causa nº1 de fugas en Angular + Three.js.
 */
@Component({
  selector: 'app-three-viewport',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PaintPaletteComponent, RoomActionsComponent],
  host: { '(dragover)': 'onDragOver($event)', '(drop)': 'onDrop($event)' },
  template: `
    <canvas
      #canvas
      tabindex="0"
      role="application"
      [attr.aria-label]="walking() ? walkLabel : orbitLabel"
      (pointerdown)="scene.onPointerDown($event)"
      (pointermove)="scene.onPointerMove($event)"
      (pointerup)="scene.onPointerUp($event)"
      (pointercancel)="scene.onPointerUp($event)"
      (dblclick)="scene.onDoubleClick($event)"
      (keydown)="onKey($event)"
      (keyup)="onKeyUp($event)"
      (blur)="scene.releaseWalkKeys()"
    ></canvas>
    <div class="labels" #labels aria-hidden="true"></div>
    <div class="context" #context [class.off]="!showContext()" role="toolbar" aria-label="Acciones del mueble seleccionado">
      @if (showContext()) {
        <button type="button" class="ctx" aria-label="Rotar a la izquierda" title="Rotar a la izquierda" (click)="scene.rotateSelected(-step)"><app-icon name="rotateLeft" /></button>
        <button type="button" class="ctx" aria-label="Rotar a la derecha" title="Rotar a la derecha" (click)="scene.rotateSelected(step)"><app-icon name="rotateRight" /></button>
        <button type="button" class="ctx" aria-label="Duplicar" title="Duplicar (Ctrl+D)" (click)="edits?.duplicate()"><app-icon name="copy" /></button>
        <button type="button" class="ctx" [attr.aria-pressed]="locked()" [attr.aria-label]="locked() ? 'Soltar' : 'Fijar'" [title]="locked() ? 'Fijo: Otra distribución no lo mueve' : 'Fijar en su sitio'" (click)="toggleLock()">
          <app-icon [name]="locked() ? 'lock' : 'unlock'" />
        </button>
        <button type="button" class="ctx danger" aria-label="Quitar" title="Quitar (Supr)" (click)="scene.removeSelected()"><app-icon name="trash" /></button>
      }
    </div>
    @if (editable()) {
      <div class="tools" role="toolbar" aria-label="Herramientas del visor">
        @for (t of tools; track t.id) {
          <button type="button" class="tool" [attr.aria-pressed]="scene.tool() === t.id" [title]="t.hint + ' (' + t.key.toUpperCase() + ')'" (click)="useTool(t.id)">{{ t.label }}</button>
        }
      </div>
      @if (scene.paintTarget(); as paint) {
        <app-paint-palette [target]="paint.target" [style.left.px]="paletteLeft(paint.x)" [style.top.px]="paint.y + 12" (closed)="scene.paintTarget.set(null)" />
      }
      @if (scene.tool() === 'room' && edits) {
        <app-room-actions class="room-actions" />
      }
      @if (toolNote(); as note) {
        <p class="tool-note" role="status" [class.warn]="note.warn">{{ note.text }}</p>
      }
    }
    @if (scene.sceneReady() && !contextLost()) {
      <div class="modes">
        <button type="button" class="btn btn-sm mode" [attr.aria-pressed]="night()" (click)="scene.setTimeOfDay(night() ? 'day' : 'night')" title="De día alumbra el sol; de noche, las lámparas del cuarto">
          Modo noche
        </button>
        <button type="button" class="btn btn-sm mode" [attr.aria-pressed]="walking()" (click)="toggleWalk()">
          {{ walking() ? 'Salir del recorrido' : 'Recorrer' }}
        </button>
      </div>
      @if (walking()) {
        <p class="walk-help" role="status">
          <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> o flechas para caminar · arrastra para mirar · doble clic para ir a un punto · <kbd>Esc</kbd> para salir
        </p>
      }
    }
    @if (contextLost()) {
      <div class="overlay" role="alert">
        <p>La vista 3D se detuvo (el navegador liberó la GPU).</p>
        <button class="btn btn-primary" type="button" (click)="reload()">Recargar vista</button>
      </div>
    } @else if (!scene.sceneReady()) {
      <div class="overlay" aria-live="polite">Preparando el modelo 3D…</div>
    }
    @if (scene.invalidDrop()) {
      <div class="hint" role="status">Aquí choca con otro mueble: al soltar volverá a su última posición válida</div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 320px;
      border-radius: var(--radius);
      overflow: hidden;
      background: #e9e3da;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      outline: none;
    }
    canvas:focus-visible {
      box-shadow: inset 0 0 0 3px var(--focus);
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      gap: 12px;
      text-align: center;
      color: var(--text-muted);
      background: color-mix(in srgb, var(--bg) 70%, transparent);
    }
    .labels {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
    }
    .tools {
      position: absolute;
      top: 12px;
      left: 12px;
      display: inline-flex;
      padding: 3px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface) 92%, transparent);
      box-shadow: var(--shadow-sm);
    }
    .tool {
      border: none;
      border-radius: 999px;
      background: transparent;
      padding: 6px 12px;
      font: inherit;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
    }
    .tool[aria-pressed='true'] {
      background: var(--primary);
      color: var(--on-primary);
    }
    .context {
      position: absolute;
      display: inline-flex;
      gap: 2px;
      padding: 3px;
      border-radius: 999px;
      background: var(--surface);
      box-shadow: var(--shadow);
      transform: translate(-50%, -100%);
    }
    .context.off {
      visibility: hidden;
    }
    .ctx {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--text);
      cursor: pointer;
    }
    .ctx:hover {
      background: var(--surface-2);
    }
    .ctx[aria-pressed='true'] {
      color: var(--primary);
    }
    .ctx.danger {
      color: var(--danger);
    }
    .room-actions {
      position: absolute;
      top: 56px;
      left: 12px;
      max-width: calc(100% - 24px);
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      background: color-mix(in srgb, var(--surface) 94%, transparent);
      box-shadow: var(--shadow-sm);
    }
    .tool-note {
      position: absolute;
      left: 12px;
      bottom: 12px;
      margin: 0;
      max-width: calc(100% - 24px);
      padding: 6px 12px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface) 90%, transparent);
      color: var(--text-muted);
      font-size: 0.8rem;
      box-shadow: var(--shadow-sm);
    }
    .tool-note.warn {
      background: var(--danger);
      color: #fff;
    }
    .modes {
      position: absolute;
      top: 12px;
      right: 12px;
      display: flex;
      gap: 8px;
    }
    .mode {
      box-shadow: var(--shadow-sm);
    }
    .mode[aria-pressed='true'] {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--on-primary);
    }
    .walk-help {
      position: absolute;
      left: 50%;
      bottom: 16px;
      transform: translateX(-50%);
      margin: 0;
      max-width: calc(100% - 24px);
      padding: 6px 14px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface) 88%, transparent);
      color: var(--text);
      font-size: 0.82rem;
      box-shadow: var(--shadow-sm);
      text-align: center;
    }
    kbd {
      display: inline-block;
      min-width: 1.5em;
      margin: 0 1px;
      padding: 0 4px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--surface-2);
      font: inherit;
      font-size: 0.78rem;
    }
    .hint {
      position: absolute;
      left: 50%;
      bottom: 16px;
      transform: translateX(-50%);
      background: var(--danger);
      color: #fff;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 0.85rem;
      box-shadow: var(--shadow);
    }
  `,
})
export class ThreeViewportComponent implements AfterViewInit, OnDestroy {
  readonly scene = inject(SceneService);
  private readonly store = inject(DesignProjectStore);
  /** Solo existe dentro del editor: la vista pública no añade muebles. */
  protected readonly edits = inject(SceneEditsService, { optional: true });
  private readonly zone = inject(NgZone);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly readOnly = input(false);
  readonly contextLost = signal(false);
  protected readonly walking = computed(() => this.scene.cameraMode() === 'walk');
  protected readonly night = computed(() => this.scene.timeOfDay() === 'night');
  protected readonly tools = VIEWPORT_TOOLS;
  protected readonly step = Math.PI / 12;
  /** Se puede editar: no es la vista pública, la escena está lista y no se está recorriendo. */
  protected readonly editable = computed(() => !this.readOnly() && this.scene.sceneReady() && !this.contextLost() && !this.walking());
  protected readonly locked = computed(() => !!this.store.selected()?.lockedByUser);
  /** La barra del mueble acompaña a la selección; se esconde mientras se arrastra. */
  protected readonly showContext = computed(() => this.editable() && !!this.edits && !!this.store.selected() && !this.scene.dragging() && this.scene.tool() === 'select');
  /** Aviso de la herramienta: el problema del gesto en curso o, si no, cómo se usa. */
  protected readonly toolNote = computed(() => {
    const problem = this.scene.toolMessage() ?? this.scene.gizmoMessage();
    if (problem) return { text: problem, warn: true };
    const tool = this.scene.tool();
    return tool === 'select' || this.scene.invalidDrop() ? null : { text: VIEWPORT_TOOLS.find((t) => t.id === tool)!.hint, warn: false };
  });
  private readonly labelsRef = viewChild.required<ElementRef<HTMLElement>>('labels');
  private readonly contextRef = viewChild.required<ElementRef<HTMLElement>>('context');
  protected readonly orbitLabel =
    'Vista 3D del cuarto. Arrastra para mover muebles; flechas para desplazar el seleccionado, R para rotar, Supr para quitar.';
  protected readonly walkLabel = 'Recorrido del cuarto a pie. W, A, S, D o flechas para caminar; Escape para salir.';
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private frameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    this.scene.readOnly.set(this.readOnly());
    const canvas = this.canvasRef().nativeElement;
    this.scene.canvas = canvas;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch {
      this.contextLost.set(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const controls = new OrbitControls(this.scene.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49; // no atravesar el piso
    controls.minDistance = 1;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', () => this.scene.invalidate());
    this.controls = controls;
    this.scene.controls = controls;
    this.scene.attachRenderer(renderer);
    this.scene.frameRoom();
    this.scene.labels.attach(this.labelsRef().nativeElement);
    this.scene.labels.anchor(this.contextRef().nativeElement, () => this.scene.selectionAnchor());
    // El buffer no se conserva entre frames: se dibuja y se copia en el mismo instante.
    this.scene.frameCapture = () => {
      if (!canvas.width || !canvas.height) return Promise.resolve(null);
      renderer.render(this.scene.scene, this.scene.camera);
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    };

    canvas.addEventListener('webglcontextlost', this.onContextLost);

    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height, false);
      this.scene.setSize(width, height);
    });
    this.resizeObserver.observe(this.host.nativeElement);

    if (isDevMode()) {
      // Criterio de la Fase 0: permite comprobar fugas desde la consola (entrar/salir del 3D).
      (window as unknown as { __threeInfo?: THREE.WebGLInfo }).__threeInfo = renderer.info;
    }

    // Resumen de la escena para las pruebas e2e (cuántas paredes, si hay techo…), sin comparar píxeles.
    Object.defineProperty(window, '__scene', { configurable: true, get: () => this.scene.snapshot() });

    // Todo el loop vive fuera de Angular: ningún frame dispara detección de cambios.
    this.zone.runOutsideAngular(() => {
      let last = performance.now();
      const loop = (now: number) => {
        this.frameId = requestAnimationFrame(loop);
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        if (this.scene.tick(dt)) renderer.render(this.scene.scene, this.scene.camera);
      };
      loop(last);
    });
  }

  /** Entra o sale del recorrido a pie; al entrar, el canvas toma el foco para que respondan las teclas. */
  protected toggleWalk(): void {
    this.scene.setCameraMode(this.walking() ? 'orbit' : 'walk');
    this.canvasRef().nativeElement.focus();
  }

  protected useTool(id: (typeof VIEWPORT_TOOLS)[number]['id']): void {
    this.scene.setTool(id);
    this.canvasRef().nativeElement.focus();
  }

  protected toggleLock(): void {
    const selected = this.store.selected();
    if (selected) this.edits?.toggleLock(selected);
  }

  /** La paleta no se sale del visor por la derecha. */
  protected paletteLeft(x: number): number {
    const width = (this.host.nativeElement as HTMLElement).clientWidth;
    return Math.max(8, Math.min(x - 116, width - 240));
  }

  /** Un mueble del catálogo arrastrado sobre el visor se puede soltar en el piso. */
  protected onDragOver(event: DragEvent): void {
    if (!this.edits?.dragged() || this.walking()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected onDrop(event: DragEvent): void {
    const edits = this.edits;
    const item = edits?.dragged();
    if (!edits || !item || this.walking()) return;
    event.preventDefault();
    edits.dragged.set(null);
    edits.add(item, this.scene.floorPointAt(event.clientX, event.clientY) ?? undefined);
  }

  onKeyUp(event: KeyboardEvent): void {
    this.scene.walkKey(event.code, false);
  }

  onKey(event: KeyboardEvent): void {
    if (this.walking()) {
      // Recorriendo, las teclas mueven a la persona; Escape vuelve a la vista de órbita.
      if (event.key === 'Escape') this.scene.setCameraMode('orbit');
      else if (!this.scene.walkKey(event.code, true)) return;
      event.preventDefault();
      return;
    }
    // Atajos de herramienta: V mover, W paredes, B pintar, M medir.
    const tool = event.ctrlKey || event.metaKey || event.altKey ? undefined : VIEWPORT_TOOLS.find((t) => t.key === event.key.toLowerCase());
    if (tool && this.editable()) {
      event.preventDefault();
      this.scene.setTool(tool.id);
      return;
    }
    if (event.key === 'Escape' && this.scene.tool() !== 'select') {
      event.preventDefault();
      this.scene.setTool('select');
      return;
    }
    const step = event.shiftKey ? 0.25 : 0.05;
    // Con varios muebles elegidos, las flechas y Supr actúan sobre todos.
    const group = this.edits && this.store.selection().length > 1 ? this.edits : null;
    const nudge = (dx: number, dz: number) => (group ? group.nudgeSelection(dx, dz) : this.scene.nudgeSelected(dx, dz));
    const remove = () => (group ? group.removeSelection() : this.scene.removeSelected());
    const handled: Record<string, () => void> = {
      ArrowLeft: () => nudge(-step, 0),
      ArrowRight: () => nudge(step, 0),
      ArrowUp: () => nudge(0, -step),
      ArrowDown: () => nudge(0, step),
      r: () => this.scene.rotateSelected(Math.PI / 12),
      R: () => this.scene.rotateSelected(-Math.PI / 12),
      Delete: remove,
      Backspace: remove,
      Escape: () => this.store.select(null),
    };
    const action = handled[event.key];
    if (action && (this.store.selected() || event.key === 'Escape')) {
      event.preventDefault();
      action();
    }
  }

  reload(): void {
    location.reload();
  }

  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.zone.run(() => this.contextLost.set(true));
  };

  ngOnDestroy(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    delete (window as { __scene?: unknown }).__scene;
    this.resizeObserver?.disconnect();
    this.canvasRef().nativeElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.controls?.dispose();
    this.scene.controls = null;
    this.scene.canvas = null;
    this.scene.frameCapture = null;
    this.scene.labels.anchor(this.contextRef().nativeElement, null);
    void this.scene.dispose();
    this.renderer?.renderLists.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}
