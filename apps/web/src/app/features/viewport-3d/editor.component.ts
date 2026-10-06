import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { STYLES, clampToRoom, type CatalogItem } from '@interiores/shared-types';
import { ToastService } from '../../core/ui/toast.service';
import { ArViewerComponent } from '../ar-view/ar-viewer.component';
import { CalibrationDialogComponent } from '../calibration/calibration-dialog.component';
import { RoomDimensionsDialogComponent } from '../room-dimensions/room-dimensions-dialog.component';
import { CATEGORY_ICONS, CatalogPanelComponent } from '../catalog/catalog-panel.component';
import { DesignProjectStore } from '../project/design-project.store';
import { AddCommand, SwapCommand } from './commands';
import { SceneService } from './scene.service';
import { ThreeViewportComponent } from './three-viewport.component';

/**
 * Paso 5 del flujo: edición 3D. SceneService se provee AQUÍ, así su ciclo de vida (y la
 * memoria GPU) coincide exactamente con el del editor: al salir del 3D se libera todo.
 */
@Component({
  selector: 'app-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SceneService],
  imports: [
    ThreeViewportComponent,
    CatalogPanelComponent,
    CalibrationDialogComponent,
    RoomDimensionsDialogComponent,
    ArViewerComponent,
    CurrencyPipe,
  ],
  host: { '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    <div class="toolbar row" role="toolbar" aria-label="Herramientas del editor">
      <button type="button" class="icon-btn" (click)="store.undo()" [disabled]="!store.canUndo()" [attr.aria-label]="'Deshacer ' + (store.undoLabel() ?? '')" title="Deshacer (Ctrl+Z)">↶</button>
      <button type="button" class="icon-btn" (click)="store.redo()" [disabled]="!store.canRedo()" [attr.aria-label]="'Rehacer ' + (store.redoLabel() ?? '')" title="Rehacer (Ctrl+Y)">↷</button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="btn btn-sm" (click)="scene.frameRoom()">Centrar vista</button>
      <button type="button" class="btn btn-sm" (click)="roomDims.open()" title="Ancho, largo, alto, puertas y ventanas">📏 Medidas del cuarto</button>
      <button type="button" class="btn btn-sm" (click)="autoLayout.emit()" [disabled]="busy()" title="El motor de colocación redistribuye los muebles que no moviste a mano">✨ Reacomodar</button>
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
        <span>📏 Medidas aproximadas (confianza {{ confidence() }}%). Escribe las reales si quieres precisión al comprar.</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" (click)="roomDims.open()">Escribir medidas</button>
        <button type="button" class="btn btn-sm" (click)="calibration.open()">Calibrar con una medida</button>
      </div>
    }

    <div class="layout">
      <div class="viewport-wrap">
        <app-three-viewport />
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
            (cancel)="swapMode.set(false)"
          />
        } @else if (store.selected() && selectedItem(); as item) {
          <div class="stack">
            <div class="row">
              <span class="big-icon" aria-hidden="true">{{ icons[item.category] }}</span>
              <div class="grow">
                <h3 style="margin: 0">{{ item.name }}</h3>
                <p class="muted small" style="margin: 0">{{ tags(item) }}</p>
              </div>
              <button type="button" class="icon-btn" aria-label="Deseleccionar" (click)="store.select(null)">×</button>
            </div>
            <dl class="facts">
              <div><dt>Precio</dt><dd>{{ item.price | currency: item.currency : 'symbol' : '1.0-0' }}</dd></div>
              <div><dt>Medidas</dt><dd>{{ item.dimensionsM.x.toFixed(2) }} × {{ item.dimensionsM.z.toFixed(2) }} × {{ item.dimensionsM.y.toFixed(2) }} m</dd></div>
              <div><dt>Licencia 3D</dt><dd>{{ item.license.toUpperCase() }}{{ item.attribution ? ' · ' + item.attribution : '' }}</dd></div>
            </dl>
            @if (store.selected()!.lockedByUser) {
              <p class="small muted">🔒 Lo moviste a mano: "Reacomodar" no lo cambiará de sitio.</p>
            }
            <div class="actions">
              <button type="button" class="btn" (click)="scene.rotateSelected(-pi / 12)" aria-label="Rotar a la izquierda 15 grados">⟲ Rotar</button>
              <button type="button" class="btn" (click)="scene.rotateSelected(pi / 12)" aria-label="Rotar a la derecha 15 grados">⟳ Rotar</button>
              <button type="button" class="btn" (click)="swapMode.set(true)">🔁 Cambiar</button>
              <button type="button" class="btn" (click)="ar.open(item)">📱 Ver en mi cuarto</button>
              @if (item.productUrl) {
                <a class="btn" [href]="item.productUrl" target="_blank" rel="noopener noreferrer">🛒 Buscar similar</a>
              }
              <button type="button" class="btn btn-danger" (click)="scene.removeSelected()">🗑 Quitar</button>
            </div>
          </div>
        } @else {
          <div class="summary row">
            <div>
              <strong>{{ store.placements().length }}</strong> muebles
            </div>
            <span class="spacer"></span>
            <div>Total aprox. <strong>{{ store.totalPrice() | currency: 'USD' : 'symbol' : '1.0-0' }}</strong></div>
          </div>
          <app-catalog-panel mode="add" [items]="catalogItems()" [styleId]="styleId()" [roomType]="roomType()" (picked)="add($event)" />
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
    app-three-viewport {
      flex: 1;
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
      .panel {
        max-height: none;
      }
    }
  `,
})
export class EditorComponent {
  protected readonly store = inject(DesignProjectStore);
  protected readonly scene = inject(SceneService);
  private readonly toast = inject(ToastService);

  readonly busy = input(false);
  readonly autoLayout = output<void>();

  protected readonly pi = Math.PI;
  protected readonly icons = CATEGORY_ICONS;
  protected readonly swapMode = signal(false);
  protected readonly shell = this.store.shell;
  protected readonly selectedItem = this.store.selectedItem;
  protected readonly catalogItems = computed(() => [...this.store.catalog().values()]);
  protected readonly styleId = computed(() => this.store.project()?.selectedStyleId ?? null);
  protected readonly roomType = computed(() => this.store.project()?.roomType ?? null);
  protected readonly confidence = computed(() => Math.round((this.shell()?.scaleConfidence ?? 0) * 100));

  tags(item: CatalogItem): string {
    return item.styleTags.map((s) => STYLES[s].label).join(', ');
  }

  add(item: CatalogItem): void {
    const id = `u-${crypto.randomUUID().slice(0, 12)}`;
    const pos = this.store.findFreeSpot(id, item, this.scene.roomCenterFor(item));
    if (!pos) {
      this.toast.error('No hay espacio libre para este mueble. Quita o mueve algo primero.');
      return;
    }
    this.store.execute(new AddCommand({ id, catalogItemId: item.id, position: pos, rotationY: 0, lockedByUser: true }));
    this.store.select(id);
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
    }
  }
}
