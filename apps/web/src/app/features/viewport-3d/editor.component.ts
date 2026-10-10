import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RoomPlan, clampToRoom, effectiveDimensions, footprint, type CatalogItem } from '@interiores/shared-types';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { ArViewerComponent } from '../ar-view/ar-viewer.component';
import { CalibrationDialogComponent } from '../calibration/calibration-dialog.component';
import { FinishesPanelComponent } from '../finishes/finishes-panel.component';
import { PlanEditorComponent } from '../floor-plan/plan-editor.component';
import { InspectorComponent } from '../inspector/inspector.component';
import { RoomDimensionsDialogComponent } from '../room-dimensions/room-dimensions-dialog.component';
import { CatalogPanelComponent } from '../catalog/catalog-panel.component';
import { ChatPanelComponent } from '../chat/chat-panel.component';
import { DesignChatService } from '../chat/design-chat.service';
import { OutlinerComponent } from '../outliner/outliner.component';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';
import { downloadBlob, fileSlug } from '../../core/ui/download';
import { planSvg } from '../floor-plan/floor-plan-model';
import { SwapCommand } from './commands';
import { SceneService } from './scene.service';
import { ThreeViewportComponent } from './three-viewport.component';

export type ViewMode = '3d' | 'split' | 'plan';

const VIEWS: readonly { id: ViewMode; label: string; title: string }[] = [
  { id: '3d', label: '3D', title: 'Solo la vista 3D' },
  { id: 'split', label: 'Dividida', title: 'El plano y la vista 3D, lado a lado' },
  { id: 'plan', label: 'Plano', title: 'Solo el plano' },
];
const VIEW_KEY = 'interiores.editor.vista';

/** La última vista usada; la primera vez, dividida si la pantalla es ancha. */
function initialView(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === '3d' || saved === 'split' || saved === 'plan') return saved;
  } catch {
    // Sin almacenamiento: se decide por el ancho.
  }
  return typeof window !== 'undefined' && window.innerWidth >= 1180 ? 'split' : '3d';
}

/**
 * Paso 5 del flujo: edición 3D. SceneService se provee AQUÍ, así su ciclo de vida (y la
 * memoria GPU) coincide exactamente con el del editor: al salir del 3D se libera todo.
 */
@Component({
  selector: 'app-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // La conversación del asistente vive con el editor (no se pierde al cambiar de pestaña).
  providers: [SceneService, DesignChatService, SceneEditsService],
  imports: [
    ThreeViewportComponent,
    PlanEditorComponent,
    OutlinerComponent,
    IconComponent,
    CatalogPanelComponent,
    CalibrationDialogComponent,
    RoomDimensionsDialogComponent,
    InspectorComponent,
    FinishesPanelComponent,
    ChatPanelComponent,
    ArViewerComponent,
    CurrencyPipe,
  ],
  host: { '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    <div class="toolbar row" role="toolbar" aria-label="Herramientas del editor">
      <button type="button" class="icon-btn" (click)="store.undo()" [disabled]="!store.canUndo()" [attr.aria-label]="'Deshacer ' + (store.undoLabel() ?? '')" title="Deshacer (Ctrl+Z)"><app-icon name="undo" /></button>
      <button type="button" class="icon-btn" (click)="store.redo()" [disabled]="!store.canRedo()" [attr.aria-label]="'Rehacer ' + (store.redoLabel() ?? '')" title="Rehacer (Ctrl+Y)"><app-icon name="redo" /></button>
      <span class="sep" aria-hidden="true"></span>
      <div class="views" role="group" aria-label="Vista del editor">
        @for (v of views; track v.id) {
          <button type="button" class="view" [attr.aria-pressed]="viewMode() === v.id" [title]="v.title" (click)="setView(v.id)">{{ v.label }}</button>
        }
      </div>
      <button type="button" class="btn btn-sm" (click)="scene.frameRoom()" [disabled]="viewMode() === 'plan'">Centrar vista</button>
      <button type="button" class="btn btn-sm" (click)="roomDims.open()" title="Ancho, largo, alto, puertas y ventanas"><app-icon name="ruler" /> Medidas del cuarto</button>
      <button type="button" class="btn btn-sm" (click)="autoLayout.emit()" [disabled]="busy()" title="Prueba otra distribución de los muebles; los que moviste a mano se quedan donde están"><app-icon name="shuffle" /> Otra distribución</button>
      <details class="menu" #exportMenu>
        <summary class="btn btn-sm"><app-icon name="download" /> Exportar</summary>
        <div class="menu-items card">
          <button type="button" class="menu-item" (click)="exportImage(); exportMenu.open = false" [disabled]="viewMode() === 'plan'">
            <strong>Imagen del cuarto</strong>
            <span class="muted">La vista 3D tal como se ve ahora (PNG)</span>
          </button>
          <button type="button" class="menu-item" (click)="exportPlan(); exportMenu.open = false">
            <strong>Plano con medidas</strong>
            <span class="muted">Para imprimir o enviar (SVG)</span>
          </button>
        </div>
      </details>
      <span class="spacer"></span>
      <span class="save" [class]="'save save-' + store.saveState()" aria-live="polite">
        @switch (store.saveState()) {
          @case ('saved') { ✓ Guardado }
          @case ('dirty') { Cambios sin guardar… }
          @case ('saving') { Guardando… }
          @case ('error') { Error al guardar <button class="btn btn-sm" type="button" (click)="store.retrySave()">Reintentar</button> }
          @case ('conflict') { }
        }
      </span>
    </div>

    @if (store.saveState() === 'conflict') {
      <div class="alert alert-warning row" role="alert">
        <span>El proyecto cambió en otra pestaña o el generador lo actualizó. Tus últimos cambios no se guardaron.</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" (click)="store.discardLocalAndReload()">Cargar la versión actual</button>
      </div>
    }
    @if (shell()?.needsCalibration) {
      <div class="alert alert-warning row calib">
        <span><app-icon name="ruler" /> Medidas aproximadas (confianza {{ confidence() }}%). Escribe las reales si quieres precisión al comprar.</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" (click)="roomDims.open()">Escribir medidas</button>
        <button type="button" class="btn btn-sm" (click)="calibration.open()">Calibrar con una medida</button>
      </div>
    }

    <div class="layout">
      <div class="viewport-wrap">
        <div class="stage" [class]="'stage stage-' + viewMode()">
          @if (viewMode() !== '3d') {
            <app-plan-editor class="pane" />
          }
          <!-- El visor 3D no se destruye al pasar al plano: solo se oculta (conserva la cámara y la GPU). -->
          <app-three-viewport class="pane" [class.off]="viewMode() === 'plan'" />
        </div>
        <p class="help muted">Arrastra un mueble para moverlo · clic derecho o dos dedos para desplazar la cámara · con uno seleccionado: flechas, R para rotar, Supr para quitar</p>
      </div>

      <aside class="panel card" aria-label="Panel del mueble">
        @if (swapMode() && selectedItem()) {
          <app-catalog-panel
            mode="swap"
            [items]="catalogItems()"
            [swapCategory]="selectedItem()!.category"
            [currentItemId]="selectedItem()!.id"
            [styleId]="styleId()"
            [roomType]="roomType()"
            (picked)="swap($event)"
            (cancelled)="swapMode.set(false)"
          />
        } @else if (store.selected() && selectedItem()) {
          <app-inspector (swap)="swapMode.set(true)" (ar)="ar.open($event)" />
        } @else {
          <div class="summary row">
            <div>
              <strong>{{ store.placements().length }}</strong> muebles
            </div>
            <span class="spacer"></span>
            <div>Total aprox. <strong>{{ store.totalPrice() | currency: 'USD' : 'symbol' : '1.0-0' }}</strong></div>
          </div>
          <div class="tabs" role="tablist" aria-label="Panel del editor">
            <button type="button" role="tab" id="tab-add" aria-controls="panel-add" [attr.aria-selected]="panelTab() === 'add'" (click)="panelTab.set('add')">Añadir muebles</button>
            <button type="button" role="tab" id="tab-objects" aria-controls="panel-objects" [attr.aria-selected]="panelTab() === 'objects'" (click)="panelTab.set('objects')">Objetos</button>
            <button type="button" role="tab" id="tab-room" aria-controls="panel-room" [attr.aria-selected]="panelTab() === 'room'" (click)="panelTab.set('room')">Cuarto y acabados</button>
            <button type="button" role="tab" id="tab-chat" aria-controls="panel-chat" [attr.aria-selected]="panelTab() === 'chat'" (click)="panelTab.set('chat')">Asistente IA</button>
          </div>
          @if (panelTab() === 'chat') {
            <div role="tabpanel" id="panel-chat" aria-labelledby="tab-chat">
              <app-chat-panel />
            </div>
          } @else if (panelTab() === 'add') {
            <div role="tabpanel" id="panel-add" aria-labelledby="tab-add">
              <app-catalog-panel
                mode="add"
                [items]="catalogItems()"
                [styleId]="styleId()"
                [roomType]="roomType()"
                (picked)="add($event)"
                (dragStarted)="edits.dragged.set($event)"
                (dragEnded)="edits.dragged.set(null)"
              />
            </div>
          } @else if (panelTab() === 'objects') {
            <div role="tabpanel" id="panel-objects" aria-labelledby="tab-objects">
              <app-outliner />
            </div>
          } @else {
            <div role="tabpanel" id="panel-room" aria-labelledby="tab-room" class="stack">
              <button type="button" class="btn btn-sm" (click)="roomDims.open()"><app-icon name="ruler" /> Medidas, puertas y ventanas</button>
              <app-finishes-panel />
            </div>
          }
        }
      </aside>
    </div>

    <app-room-dimensions-dialog #roomDims (calibrate)="calibration.open()" />
    <app-calibration-dialog #calibration />
    <app-ar-viewer #ar />
  `,
  styles: `
    :host {
      display: block;
    }
    .toolbar {
      margin-bottom: 12px;
    }
    .sep {
      width: 1px;
      height: 28px;
      background: var(--border);
    }
    .views {
      display: inline-flex;
      padding: 3px;
      border-radius: 999px;
      background: var(--surface-2);
    }
    .view {
      border: none;
      border-radius: 999px;
      background: transparent;
      padding: 6px 14px;
      font: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
    }
    .view[aria-pressed='true'] {
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow-sm);
    }
    .menu {
      position: relative;
    }
    .menu summary {
      list-style: none;
      cursor: pointer;
    }
    .menu summary::-webkit-details-marker {
      display: none;
    }
    .menu-items {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 20;
      display: grid;
      gap: 2px;
      width: 260px;
      padding: 6px;
      box-shadow: var(--shadow);
    }
    .menu-item {
      display: grid;
      gap: 2px;
      padding: 8px 10px;
      border: none;
      border-radius: 8px;
      background: none;
      color: var(--text);
      font: inherit;
      font-size: 0.88rem;
      text-align: left;
      cursor: pointer;
    }
    .menu-item .muted {
      font-size: 0.78rem;
    }
    .menu-item:hover:not(:disabled) {
      background: var(--surface-2);
    }
    .menu-item:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .save {
      font-size: 0.88rem;
      color: var(--text-muted);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .save-saved {
      color: var(--success);
    }
    .save-error {
      color: var(--danger);
    }
    .alert {
      margin-bottom: 12px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 16px;
    }
    .viewport-wrap {
      height: min(72vh, 720px);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .stage {
      flex: 1;
      min-height: 0;
      display: grid;
      gap: 12px;
      grid-template-columns: minmax(0, 1fr);
    }
    .stage-split {
      grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    }
    .pane {
      min-width: 0;
      min-height: 0;
    }
    .pane.off {
      display: none;
    }
    .help {
      font-size: 0.8rem;
      margin: 0;
    }
    .panel {
      padding: 16px;
      overflow-x: hidden;
      align-self: start;
      max-height: min(72vh, 720px);
      overflow: auto;
    }
    .big-icon {
      font-size: 2rem;
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
    .small {
      font-size: 0.85rem;
    }
    .facts {
      margin: 0;
      display: grid;
      gap: 6px;
    }
    .facts div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 0.9rem;
    }
    .facts dt {
      color: var(--text-muted);
    }
    .facts dd {
      margin: 0;
      font-weight: 600;
      text-align: right;
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .actions .btn {
      white-space: normal;
      padding: 6px 10px;
      min-width: 0;
    }
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .tabs button {
      flex: 1;
      background: none;
      border: none;
      border-bottom: 3px solid transparent;
      padding: 8px 4px;
      font: inherit;
      font-size: 0.82rem;
      color: var(--text-muted);
      cursor: pointer;
    }
    .tabs button[aria-selected='true'] {
      color: var(--text);
      font-weight: 600;
      border-bottom-color: var(--primary);
    }
    .summary {
      padding-bottom: 12px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    @media (max-width: 960px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .viewport-wrap {
        height: 60vh;
      }
      /* En pantallas angostas la vista dividida apila el plano sobre el 3D. */
      .viewport-wrap:has(.stage-split) {
        height: 110vh;
      }
      .stage-split {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
      }
      .panel {
        max-height: none;
      }
    }
  `,
})
export class EditorComponent {
  protected readonly store = inject(DesignProjectStore);
  protected readonly scene = inject(SceneService);
  protected readonly edits = inject(SceneEditsService);
  private readonly toast = inject(ToastService);

  readonly busy = input(false);
  readonly autoLayout = output<void>();

  protected readonly views = VIEWS;
  /** Vista elegida: solo 3D, plano y 3D lado a lado, o solo plano. Se recuerda entre visitas. */
  protected readonly viewMode = signal<ViewMode>(initialView());
  protected readonly swapMode = signal(false);
  protected readonly panelTab = signal<'add' | 'objects' | 'room' | 'chat'>('add');
  protected readonly shell = this.store.shell;
  protected readonly selectedItem = this.store.selectedItem;
  protected readonly catalogItems = computed(() => [...this.store.catalog().values()]);
  protected readonly styleId = computed(() => this.store.project()?.selectedStyleId ?? null);
  protected readonly roomType = computed(() => this.store.project()?.roomType ?? null);
  protected readonly confidence = computed(() => Math.round((this.shell()?.scaleConfidence ?? 0) * 100));

  protected setView(mode: ViewMode): void {
    this.viewMode.set(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {
      // Sin almacenamiento (modo privado): la vista simplemente no se recuerda.
    }
  }

  add(item: CatalogItem): void {
    this.edits.add(item);
  }

  /** La vista 3D tal como se ve ahora, como imagen. */
  protected async exportImage(): Promise<void> {
    const blob = await this.scene.capturePng();
    if (!blob) {
      this.toast.error('No se pudo capturar la vista 3D.');
      return;
    }
    downloadBlob(blob, `${fileSlug(this.store.project()?.name ?? '')}.png`);
  }

  /** El plano con cotas y los muebles, listo para imprimir. */
  protected exportPlan(): void {
    const shell = this.store.shell();
    if (!shell) return;
    const catalog = this.store.catalog();
    const footprints = this.store.placements().flatMap((p) => {
      const item = catalog.get(p.catalogItemId);
      if (!item || p.supportId || item.subcategory === 'rug') return [];
      return [{ id: p.id, name: item.name, corners: footprint(p.position, effectiveDimensions(item.dimensionsM, p), p.rotationY).corners }];
    });
    const name = this.store.project()?.name ?? 'Cuarto';
    const metres = (v: number) => v.toFixed(2).replace('.', ',');
    const area = RoomPlan.from(shell).area().toFixed(1).replace('.', ',');
    const title = `${name} · ${metres(shell.widthM)} × ${metres(shell.depthM)} m · ${area} m²`;
    downloadBlob(new Blob([planSvg(shell, footprints, title)], { type: 'image/svg+xml' }), `plano-${fileSlug(name)}.svg`);
  }

  swap(item: CatalogItem): void {
    const current = this.store.selected();
    const shell = this.store.shell();
    if (!current || !shell) return;
    let to = clampToRoom(current.position, item.dimensionsM, current.rotationY, shell);
    to = { ...to, y: this.scene.roomCenterFor(item).y };
    if (!this.store.isPoseValid(current.id, item.id, to, current.rotationY)) {
      const free = this.store.findFreeSpot(current.id, item, to, current.rotationY);
      if (!free) {
        this.toast.error('El mueble nuevo no cabe en este lugar. Mueve algo para hacerle espacio.');
        return;
      }
      to = free;
    }
    this.store.execute(new SwapCommand(current.id, current.catalogItemId, item.id, current.position, to));
    this.swapMode.set(false);
  }

  onGlobalKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.store.redo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      // Duplicar (si no hay nada seleccionado, el atajo del navegador sigue su curso).
      if (!this.store.selected()) return;
      e.preventDefault();
      this.edits.duplicate();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      // Con texto seleccionado, Ctrl+C sigue copiando el texto.
      if (!window.getSelection()?.toString()) this.edits.copy();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      if (this.edits.paste()) e.preventDefault();
    }
  }
}
