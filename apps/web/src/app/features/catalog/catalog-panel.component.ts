import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import {
  CATALOG_CATEGORIES,
  MOUNTS,
  STYLES,
  searchCatalog,
  type CatalogCategory,
  type CatalogItem,
  type Mount,
  type RoomType,
  type StyleId,
} from '@interiores/shared-types';
import { CATEGORY_ICONS, CATEGORY_LABELS, MOUNT_LABELS } from './catalog-labels';
import { CatalogThumbComponent } from './catalog-thumb.component';
import { IconComponent } from '../../shared/ui/icon.component';

export { CATEGORY_ICONS, CATEGORY_LABELS } from './catalog-labels';

/**
 * Catálogo contextual (progressive disclosure): en modo "cambiar" solo muestra muebles
 * de la misma categoría que el seleccionado; en modo "añadir", filtra por categoría y estilo.
 */
@Component({
  selector: 'app-catalog-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, CatalogThumbComponent, IconComponent],
  template: `
    <div class="stack">
      <div class="row">
        <h3 style="margin: 0">{{ mode() === 'swap' ? 'Cambiar por…' : 'Añadir mueble' }}</h3>
        <span class="spacer"></span>
        @if (mode() === 'swap') {
          <button type="button" class="btn btn-sm btn-ghost" (click)="cancelled.emit()">Cancelar</button>
        }
      </div>
      <input class="input" type="search" placeholder="Buscar: lámpara de mesa, closet, cuadro…" aria-label="Buscar en el catálogo" [value]="query()" (input)="query.set($any($event.target).value)" />
      @if (mode() === 'add') {
        <div class="chips" role="group" aria-label="Categoría">
          <button type="button" class="chip" [attr.aria-pressed]="category() === null" (click)="category.set(null)">Todo</button>
          @for (c of categories; track c) {
            <button type="button" class="chip" [attr.aria-pressed]="category() === c" (click)="category.set(c)"><app-icon [name]="icons[c]" /> {{ labels[c] }}</button>
          }
        </div>
        <div class="chips" role="group" aria-label="Dónde va">
          <button type="button" class="chip" [attr.aria-pressed]="mount() === null" (click)="mount.set(null)">Cualquier lugar</button>
          @for (m of mounts; track m) {
            <button type="button" class="chip" [attr.aria-pressed]="mount() === m" (click)="mount.set(m)">{{ mountLabels[m] }}</button>
          }
        </div>
      }
      <label class="row small">
        <input type="checkbox" [checked]="onlyStyle()" (change)="onlyStyle.set($any($event.target).checked)" [disabled]="!styleId()" />
        Solo estilo {{ styleId() ? styles[styleId()!].label : '' }}
        <span class="spacer"></span>
        <span class="muted" aria-live="polite">{{ filtered().length }} resultado(s)</span>
      </label>
      <ul class="list" role="list">
        @for (item of filtered(); track item.id) {
          <li>
            <button
              type="button"
              class="item"
              (click)="picked.emit(item)"
              [class.current]="item.id === currentItemId()"
              [disabled]="item.id === currentItemId()"
              [draggable]="mode() === 'add'"
              [title]="mode() === 'add' ? 'Clic para añadirlo o arrástralo al plano o al cuarto' : ''"
              (dragstart)="onDragStart($event, item)"
              (dragend)="dragEnded.emit()"
            >
              <app-catalog-thumb [item]="item" />
              <span class="info">
                <strong>{{ item.name }}</strong>
                <span class="muted">{{ item.dimensionsM.x.toFixed(2) }} × {{ item.dimensionsM.z.toFixed(2) }} × {{ item.dimensionsM.y.toFixed(2) }} m · {{ tags(item) }}</span>
              </span>
              <span class="price">{{ item.price | currency: item.currency : 'symbol' : '1.0-0' }}</span>
            </button>
          </li>
        } @empty {
          <li class="muted small">No hay muebles con esos filtros.</li>
        }
      </ul>
    </div>
  `,
  styles: `
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chips .chip {
      min-height: 30px;
      padding: 0 10px;
      font-size: 0.82rem;
    }
    .small {
      font-size: 0.85rem;
    }
    .list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 6px;
      max-height: 46vh;
      overflow: auto;
    }
    .item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      text-align: left;
      font: inherit;
      cursor: pointer;
    }
    .item:hover:not(:disabled) {
      border-color: var(--primary);
    }
    .item.current {
      opacity: 0.6;
    }
    .icon {
      font-size: 1.4rem;
    }
    .info {
      flex: 1;
      display: grid;
      font-size: 0.88rem;
      min-width: 0;
    }
    .info .muted {
      font-size: 0.78rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .price {
      font-weight: 700;
      font-size: 0.88rem;
    }
  `,
})
export class CatalogPanelComponent {
  readonly items = input.required<CatalogItem[]>();
  readonly mode = input<'add' | 'swap'>('add');
  readonly roomType = input<RoomType | null>(null);
  readonly styleId = input<StyleId | null>(null);
  /** En modo swap: categoría y mueble actual. */
  readonly swapCategory = input<CatalogCategory | null>(null);
  readonly currentItemId = input<string | null>(null);

  readonly picked = output<CatalogItem>();
  readonly cancelled = output<void>();
  /** Se empezó a arrastrar un mueble hacia el plano o el visor (solo en modo añadir). */
  readonly dragStarted = output<CatalogItem>();
  readonly dragEnded = output<void>();

  protected readonly categories = CATALOG_CATEGORIES;
  protected readonly labels = CATEGORY_LABELS;
  protected readonly icons = CATEGORY_ICONS;
  protected readonly styles = STYLES;
  protected readonly mounts = MOUNTS;
  protected readonly mountLabels = MOUNT_LABELS;
  protected readonly query = signal('');
  protected readonly category = signal<CatalogCategory | null>(null);
  protected readonly mount = signal<Mount | null>(null);
  protected readonly onlyStyle = linkedSignal(() => !!this.styleId());

  /**
   * Misma búsqueda que el servidor (`searchCatalog`): sin acentos, sinónimos es/en y tolerante
   * a errores. Sin texto, primero lo que corresponde al tipo de cuarto.
   */
  protected readonly filtered = computed(() => {
    const swap = this.mode() === 'swap';
    const q = this.query().trim();
    const room = this.roomType();
    const results = searchCatalog(this.items(), {
      ...(q ? { q } : {}),
      ...((swap ? this.swapCategory() : this.category()) ? { category: (swap ? this.swapCategory() : this.category())! } : {}),
      ...(this.onlyStyle() && this.styleId() ? { style: this.styleId()! } : {}),
      ...(!swap && this.mount() ? { mount: this.mount()! } : {}),
    }).map((r) => r.item);
    if (q || !room) return results;
    return [...results].sort((a, b) => Number(!a.roomTypes.includes(room)) - Number(!b.roomTypes.includes(room)));
  });

  protected onDragStart(event: DragEvent, item: CatalogItem): void {
    if (this.mode() !== 'add') return;
    event.dataTransfer?.setData('text/plain', item.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    this.dragStarted.emit(item);
  }

  tags(item: CatalogItem): string {
    return item.styleTags.map((s) => STYLES[s].label).join(', ');
  }
}
