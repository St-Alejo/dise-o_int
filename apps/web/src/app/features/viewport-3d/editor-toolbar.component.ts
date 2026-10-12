import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RoomPlan, effectiveDimensions, footprint, shoppingCsv, shoppingRows } from '@interiores/shared-types';
import { downloadBlob, fileSlug } from '../../core/ui/download';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { SegmentedComponent } from '../../shared/ui/segmented.component';
import { TooltipDirective } from '../../shared/ui/tooltip.directive';
import { planSvg } from '../floor-plan/floor-plan-model';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';
import { SceneService } from './scene.service';

export type ViewMode = '3d' | 'split' | 'plan';

export const VIEWS: readonly { id: ViewMode; label: string; title: string }[] = [
  { id: '3d', label: '3D', title: 'Solo la vista 3D' },
  { id: 'split', label: 'Dividida', title: 'El plano y la vista 3D, lado a lado' },
  { id: 'plan', label: 'Plano', title: 'Solo el plano' },
];

/**
 * Barra del editor: deshacer, la vista, lo que se le pide al cuarto entero (medidas, otra
 * distribución, revisión, presentar), exportar y el estado del guardado. Lo que abre otra pieza
 * del editor (un diálogo, el panel) se pide con una salida; exportar lo hace ella misma.
 */
@Component({
  selector: 'app-editor-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SegmentedComponent, TooltipDirective],
  template: `
    <div class="toolbar row" role="toolbar" aria-label="Herramientas del editor">
      <button type="button" class="icon-btn" (click)="store.undo()" [disabled]="!store.canUndo()" [attr.aria-label]="'Deshacer ' + (store.undoLabel() ?? '')" appTooltip="Deshacer (Ctrl+Z)"><app-icon name="undo" /></button>
      <button type="button" class="icon-btn" (click)="store.redo()" [disabled]="!store.canRedo()" [attr.aria-label]="'Rehacer ' + (store.redoLabel() ?? '')" appTooltip="Rehacer (Ctrl+Y)"><app-icon name="redo" /></button>
      <span class="sep" aria-hidden="true"></span>
      <app-segmented label="Vista del editor" [options]="views" [value]="viewMode()" (valueChange)="viewChange.emit($event)" />
      <button type="button" class="btn btn-sm" (click)="scene.frameRoom()" [disabled]="viewMode() === 'plan'">Centrar vista</button>
      <button type="button" class="btn btn-sm" (click)="roomDims.emit()" appTooltip="Ancho, largo, alto, puertas y ventanas"><app-icon name="ruler" /> Medidas del cuarto</button>
      @if (!demo()) {
        <button type="button" class="btn btn-sm" (click)="autoLayout.emit()" [disabled]="busy()" appTooltip="Prueba otra distribución de los muebles; los que moviste a mano se quedan donde están"><app-icon name="shuffle" /> Otra distribución</button>
      }
      <button
        type="button"
        class="btn btn-sm review"
        [class.pending]="edits.issueCount() > 0"
        (click)="review.emit()"
        [appTooltip]="edits.issueCount() ? 'Hay cosas que conviene corregir' : 'Revisa si se puede entrar, si se llega a cada mueble y si algo tapa las ventanas'"
      >
        Revisión
        @if (edits.issueCount(); as n) {
          <span class="count" [attr.aria-label]="n + ' avisos'">{{ n }}</span>
        }
      </button>
      <details class="menu" #exportMenu>
        <summary class="btn btn-sm"><app-icon name="download" /> Exportar</summary>
        <div class="menu-items card">
          <button type="button" class="menu-item" (click)="exportImage(); exportMenu.open = false" [disabled]="viewMode() === 'plan'">
            <strong>Imagen del cuarto</strong>
            <span class="muted">La vista 3D tal como se ve ahora (PNG)</span>
          </button>
          <button type="button" class="menu-item" (click)="exportImage(3); exportMenu.open = false" [disabled]="viewMode() === 'plan'">
            <strong>Imagen en alta resolución</strong>
            <span class="muted">Tres veces más grande y sin las ayudas de edición (PNG)</span>
          </button>
          <button type="button" class="menu-item" (click)="exportPlan(); exportMenu.open = false">
            <strong>Plano con medidas</strong>
            <span class="muted">Para imprimir o enviar (SVG)</span>
          </button>
          <button type="button" class="menu-item" (click)="exportShopping(); exportMenu.open = false" [disabled]="!store.placements().length">
            <strong>Lista de compras</strong>
            <span class="muted">Para abrir en una hoja de cálculo (CSV)</span>
          </button>
        </div>
      </details>
      <button type="button" class="btn btn-sm" (click)="present.emit()" [disabled]="!store.shell()" appTooltip="Enseña el cuarto a pantalla completa, vista por vista (flechas para avanzar)">Presentar</button>
      <button type="button" class="btn btn-sm btn-ghost" (click)="shortcuts.emit()" appTooltip="Atajos de teclado (?)">Atajos</button>
      <span class="spacer"></span>
      <span class="save" [class]="'save save-' + store.saveState()" aria-live="polite">
        @switch (store.saveState()) {
          @case ('saved') { ✓ Guardado }
          @case ('dirty') { Cambios sin guardar… }
          @case ('saving') { Guardando… }
          @case ('error') {
            @if (store.offline()) {
              Sin conexión: tus cambios se guardarán al volver
            } @else {
              No se pudo guardar; reintentando <button class="btn btn-sm" type="button" (click)="store.retrySave()">Reintentar ahora</button>
            }
          }
          @case ('conflict') { }
        }
      </span>
    </div>
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
    .review.pending {
      border-color: var(--warning);
    }
    .count {
      display: inline-grid;
      place-items: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--warning);
      color: var(--surface);
      font-size: 0.72rem;
      font-weight: 700;
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
    @media (max-width: 960px) {
      /* La barra de herramientas no se apila en cinco filas: va en una sola, que se desliza. */
      .toolbar {
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
        padding-bottom: 4px;
      }
      .toolbar > * {
        flex: none;
      }
      /* Dentro de una barra que se desliza, un menú desplegable quedaría recortado: sale fijo, */
      /* sobre el asa de la hoja inferior. */
      .menu-items {
        position: fixed;
        inset: auto 16px 64px 16px;
        z-index: 40;
      }
    }
  `,
})
export class EditorToolbarComponent {
  protected readonly store = inject(DesignProjectStore);
  protected readonly scene = inject(SceneService);
  protected readonly edits = inject(SceneEditsService);
  private readonly toast = inject(ToastService);

  readonly viewMode = input.required<ViewMode>();
  readonly busy = input(false);
  /** Demostración sin cuenta: no hay servidor al que pedir otra distribución. */
  readonly demo = input(false);

  readonly viewChange = output<ViewMode>();
  readonly autoLayout = output<void>();
  readonly roomDims = output<void>();
  readonly review = output<void>();
  readonly present = output<void>();
  readonly shortcuts = output<void>();

  protected readonly views = VIEWS;

  /** La vista 3D tal como se ve ahora, como imagen. */
  protected async exportImage(scale = 1): Promise<void> {
    const blob = await this.scene.capturePng(scale);
    if (!blob) {
      this.toast.error('No se pudo capturar la vista 3D.');
      return;
    }
    downloadBlob(blob, `${fileSlug(this.store.project()?.name ?? '')}${scale > 1 ? '-grande' : ''}.png`);
  }

  /** Lo que hay en el cuarto, agrupado y con precios, para una hoja de cálculo. */
  protected exportShopping(): void {
    const csv = shoppingCsv(shoppingRows(this.store.placements(), this.store.catalog()));
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `compras-${fileSlug(this.store.project()?.name ?? '')}.csv`);
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
}
