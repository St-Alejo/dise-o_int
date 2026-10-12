import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { clampToRoom, type CatalogItem } from '@interiores/shared-types';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { BudgetPanelComponent } from '../budget/budget-panel.component';
import { CatalogPanelComponent } from '../catalog/catalog-panel.component';
import { ChatPanelComponent } from '../chat/chat-panel.component';
import { FinishesPanelComponent } from '../finishes/finishes-panel.component';
import { GroupPanelComponent } from '../inspector/group-panel.component';
import { InspectorComponent } from '../inspector/inspector.component';
import { OutlinerComponent } from '../outliner/outliner.component';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';
import { SwapCommand } from './commands';
import { SceneService } from './scene.service';

/**
 * Panel lateral del editor: lo que hay seleccionado (un mueble, varios, o el cambio de uno por
 * otro) y, sin selección, el resumen del cuarto con sus pestañas. En pantallas angostas es una
 * hoja inferior que sube y baja.
 */
@Component({
  selector: 'app-editor-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    CatalogPanelComponent,
    GroupPanelComponent,
    InspectorComponent,
    BudgetPanelComponent,
    ChatPanelComponent,
    OutlinerComponent,
    FinishesPanelComponent,
    CurrencyPipe,
  ],
  template: `
    <aside class="panel card" aria-label="Panel del mueble" [class.sheet-open]="sheetOpen()">
      <button type="button" class="sheet-handle" (click)="sheetOpen.set(!sheetOpen())" [attr.aria-expanded]="sheetOpen()">
        <span class="grip" aria-hidden="true"></span>
        {{ sheetOpen() ? 'Ocultar el panel' : store.selected() ? 'Ver el mueble seleccionado' : 'Añadir muebles y ajustes' }}
      </button>
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
      } @else if (store.selection().length > 1) {
        <app-group-panel />
      } @else if (store.selected() && selectedItem()) {
        <app-inspector (swap)="swapMode.set(true)" (ar)="ar.emit($event)" />
      } @else {
        <div class="summary row">
          <div>
            <strong>{{ store.placements().length }}</strong> muebles
          </div>
          <span class="spacer"></span>
          <div>Total aprox. <strong>{{ store.totalPrice() | currency: 'USD' : 'symbol' : '1.0-0' }}</strong></div>
        </div>
        <app-budget-panel />
        <div class="tabs" role="tablist" aria-label="Panel del editor">
          <button type="button" role="tab" id="tab-add" aria-controls="panel-add" [attr.aria-selected]="panelTab() === 'add'" (click)="panelTab.set('add')">Añadir muebles</button>
          <button type="button" role="tab" id="tab-objects" aria-controls="panel-objects" [attr.aria-selected]="panelTab() === 'objects'" (click)="panelTab.set('objects')">Objetos</button>
          <button type="button" role="tab" id="tab-room" aria-controls="panel-room" [attr.aria-selected]="panelTab() === 'room'" (click)="panelTab.set('room')">Cuarto y acabados</button>
          @if (!demo()) {
            <button type="button" role="tab" id="tab-chat" aria-controls="panel-chat" [attr.aria-selected]="panelTab() === 'chat'" (click)="panelTab.set('chat')">Asistente IA</button>
          }
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
            <button type="button" class="btn btn-sm" (click)="roomDims.emit()"><app-icon name="ruler" /> Medidas, puertas y ventanas</button>
            <app-finishes-panel />
          </div>
        }
      }
    </aside>
  `,
  styles: `
    /* El panel es una columna de la rejilla del editor: el elemento propio no pinta caja. */
    :host {
      display: contents;
    }
    .panel {
      padding: 16px;
      overflow-x: hidden;
      align-self: start;
      max-height: min(72vh, 720px);
      overflow: auto;
    }
    /* El asa de la hoja inferior solo existe en pantallas angostas. */
    .sheet-handle {
      display: none;
      position: sticky;
      top: 0;
      z-index: 1;
      width: 100%;
      min-height: 52px;
      padding: 8px 0;
      border: 0;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .grip {
      width: 40px;
      height: 4px;
      border-radius: 999px;
      background: var(--border);
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
      /* En pantallas angostas el panel es una hoja inferior: el cuarto queda siempre a la vista y */
      /* el panel sube cuando hace falta, en vez de quedar debajo, al final de la página. */
      .panel {
        position: fixed;
        inset: auto 0 0 0;
        z-index: 30;
        max-height: 70vh;
        padding-top: 0;
        border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        box-shadow: var(--shadow-lg);
        transform: translateY(calc(100% - 52px));
        transition: transform 0.25s var(--ease);
        overflow: hidden;
      }
      .panel.sheet-open {
        transform: none;
        overflow: auto;
      }
      .sheet-handle {
        display: grid;
        justify-items: center;
        gap: 6px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel {
        transition: none;
      }
    }
  `,
})
export class EditorPanelComponent {
  protected readonly store = inject(DesignProjectStore);
  private readonly scene = inject(SceneService);
  protected readonly edits = inject(SceneEditsService);
  private readonly toast = inject(ToastService);

  /** Demostración sin cuenta: no hay asistente. */
  readonly demo = input(false);
  /** Se pidió abrir las medidas del cuarto (el diálogo es del editor). */
  readonly roomDims = output<void>();
  /** Se pidió ver un mueble en realidad aumentada. */
  readonly ar = output<CatalogItem>();

  /** En pantallas angostas el panel es una hoja inferior que se sube y se baja. */
  protected readonly sheetOpen = signal(false);
  protected readonly swapMode = signal(false);
  protected readonly panelTab = signal<'add' | 'objects' | 'room' | 'chat'>('add');
  protected readonly selectedItem = this.store.selectedItem;
  protected readonly catalogItems = computed(() => [...this.store.catalog().values()]);
  protected readonly styleId = computed(() => this.store.project()?.selectedStyleId ?? null);
  protected readonly roomType = computed(() => this.store.project()?.roomType ?? null);

  /** Abre la revisión del diseño (está en la pestaña de objetos). */
  showReview(): void {
    this.swapMode.set(false);
    this.store.select(null);
    this.panelTab.set('objects');
    this.sheetOpen.set(true);
  }

  /** Enseña el catálogo para cambiar el mueble seleccionado por otro (lo pide también el visor). */
  startSwap(): void {
    this.swapMode.set(true);
    this.sheetOpen.set(true);
  }

  add(item: CatalogItem): void {
    this.edits.add(item);
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
}
