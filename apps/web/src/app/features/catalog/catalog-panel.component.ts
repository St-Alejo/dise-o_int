import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import {
  CATALOG_CATEGORIES,
  STYLES,
  type CatalogCategory,
  type CatalogItem,
  type RoomType,
  type StyleId,
} from '@interiores/shared-types';

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  sofa: 'Sofás',
  table: 'Mesas',
  chair: 'Sillas',
  bed: 'Camas',
  storage: 'Almacenaje',
  lighting: 'Luz',
  decor: 'Deco',
};

export const CATEGORY_ICONS: Record<CatalogCategory, string> = {
  sofa: '🛋️',
  table: '🪵',
  chair: '🪑',
  bed: '🛏️',
  storage: '🗄️',
  lighting: '💡',
  decor: '🪴',
};

/**
 * Catálogo contextual (progressive disclosure): en modo "cambiar" solo muestra muebles
 * de la misma categoría que el seleccionado; en modo "añadir", filtra por categoría y estilo.
 */
@Component({
  selector: 'app-catalog-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe],
  template: `
    <div class="stack">
      <div class="row">
        <h3 style="margin: 0">{{ mode() === 'swap' ? 'Cambiar por…' : 'Añadir mueble' }}</h3>
        <span class="spacer"></span>
        @if (mode() === 'swap') {
          <button type="button" class="btn btn-sm btn-ghost" (click)="cancel.emit()">Cancelar</button>
        }
      </div>
      <input class="input" type="search" placeholder="Buscar…" aria-label="Buscar en el catálogo" [value]="query()" (input)="query.set($any($event.target).value)" />
      @if (mode() === 'add') {
        <div class="chips" role="group" aria-label="Categoría">
          <button type="button" class="chip" [attr.aria-pressed]="category() === null" (click)="category.set(null)">Todo</button>
          @for (c of categories; track c) {
            <button type="button" class="chip" [attr.aria-pressed]="category() === c" (click)="category.set(c)">{{ icons[c] }} {{ labels[c] }}</button>
          }
        </div>
      }
      <label class="row small">
        <input type="checkbox" [checked]="onlyStyle()" (change)="onlyStyle.set($any($event.target).checked)" [disabled]="!styleId()" />
        Solo estilo {{ styleId() ? styles[styleId()!].label : '' }}
      </label>
      <ul class="list" role="list">
        @for (item of filtered(); track item.id) {
          <li>
            <button type="button" class="item" (click)="picked.emit(item)" [class.current]="item.id === currentItemId()" [disabled]="item.id === currentItemId()">
              <span class="icon" aria-hidden="true">{{ icons[item.category] }}</span>
              <span class="info">
                <strong>{{ item.name }}</strong>
                <span class="muted">{{ item.dimensionsM.x.toFixed(2) }}×{{ item.dimensionsM.z.toFixed(2) }} m · {{ tags(item) }}</span>
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
  readonly cancel = output<void>();

  protected readonly categories = CATALOG_CATEGORIES;
  protected readonly labels = CATEGORY_LABELS;
  protected readonly icons = CATEGORY_ICONS;
  protected readonly styles = STYLES;
  protected readonly query = signal('');
  protected readonly category = signal<CatalogCategory | null>(null);
  protected readonly onlyStyle = linkedSignal(() => !!this.styleId());

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const cat = this.mode() === 'swap' ? this.swapCategory() : this.category();
    const style = this.onlyStyle() ? this.styleId() : null;
    const room = this.roomType();
    return this.items()
      .filter((i) => !cat || i.category === cat)
      .filter((i) => !style || i.styleTags.includes(style))
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => Number(room ? !a.roomTypes.includes(room) : 0) - Number(room ? !b.roomTypes.includes(room) : 0) || a.name.localeCompare(b.name));
  });

  tags(item: CatalogItem): string {
    return item.styleTags.map((s) => STYLES[s].label).join(', ');
  }
}
