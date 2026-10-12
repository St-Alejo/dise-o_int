import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChildren } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STYLES, STYLE_IDS, type CatalogItem, type StyleId } from '@interiores/shared-types';
import { CatalogApi } from '../../core/api/projects.api';
import { IconComponent } from '../../shared/ui/icon.component';
import { tabAfterKey } from '../../shared/ui/tabs';

/** Qué materiales y piezas se asocian a cada estilo, para que diga algo más que su nombre. */
const DETAILS: Record<StyleId, readonly string[]> = {
  escandinavo: ['Roble claro', 'Lino y lana', 'Blancos cálidos'],
  minimalista: ['Superficies lisas', 'Grises neutros', 'Poco mobiliario'],
  industrial: ['Metal negro', 'Cuero', 'Madera recuperada'],
  bohemio: ['Ratán y fibras', 'Plantas', 'Tonos tierra'],
  moderno: ['Formas geométricas', 'Contraste', 'Un acento de color'],
  clasico: ['Maderas oscuras', 'Molduras', 'Tapicería'],
};

/** A dónde lleva "Empezar con este estilo": al asistente, pasando antes por el registro si hace falta. */
export function styleLink(style: StyleId, signedIn: boolean): { path: string; query: Record<string, string> } {
  return signedIn
    ? { path: '/proyectos/nuevo', query: { estilo: style } }
    : { path: '/registro', query: { volver: `/proyectos/nuevo?estilo=${style}` } };
}

type Piece = Pick<CatalogItem, 'id' | 'name' | 'category' | 'styleTags' | 'price'>;
/** Qué se enseña primero: las piezas que definen un cuarto antes que los accesorios. */
const CATEGORY_ORDER = ['sofa', 'bed', 'table', 'chair', 'storage', 'lighting'];

/**
 * Tres piezas del catálogo propias de un estilo, con precio y de categorías distintas. Primero las
 * más específicas (las que llevan menos estilos): son las que mejor lo representan.
 */
export function piecesFor(style: StyleId, catalog: readonly Piece[], count = 3): Piece[] {
  const rank = (p: Piece) => {
    const at = CATEGORY_ORDER.indexOf(p.category);
    return at < 0 ? CATEGORY_ORDER.length : at;
  };
  const options = catalog
    .filter((p) => p.styleTags.includes(style) && (p.price ?? 0) > 0)
    .sort((a, b) => a.styleTags.length - b.styleTags.length || rank(a) - rank(b) || a.id.localeCompare(b.id));
  const picked: Piece[] = [];
  for (const piece of options) {
    if (picked.length >= count) break;
    if (!picked.some((p) => p.category === piece.category)) picked.push(piece);
  }
  return picked;
}

/**
 * Los estilos de la app, uno por pestaña: la misma sala amueblada en ese estilo, su paleta, lo que
 * lo caracteriza y tres piezas reales del catálogo con su precio.
 */
@Component({
  selector: 'app-style-showcase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, CurrencyPipe],
  template: `
    <div class="tabs" role="tablist" aria-label="Estilos">
      @for (s of styles; track s.id; let i = $index) {
        <button
          #tab
          type="button"
          role="tab"
          class="tab"
          [id]="'style-tab-' + s.id"
          [attr.aria-selected]="i === index()"
          [attr.aria-controls]="'style-panel-' + s.id"
          [attr.tabindex]="i === index() ? 0 : -1"
          (click)="index.set(i)"
          (keydown)="onKey($event, i)"
        >
          {{ s.label }}
        </button>
      }
    </div>

    <div class="panel" role="tabpanel" [id]="'style-panel-' + current().id" [attr.aria-labelledby]="'style-tab-' + current().id" tabindex="0">
      <figure class="look">
        <img
          class="room"
          [src]="'landing/estilo-' + current().id + '.webp'"
          [alt]="'Una sala de 5 por 4,2 metros amueblada por la app en estilo ' + current().label + '.'"
          width="960"
          height="640"
          loading="lazy"
          decoding="async"
        />
        <!-- Una casa real del mismo estilo junto a lo que dibuja la app (fotos CC0, ver landing/fotos/ATTRIBUTION.md). -->
        <figcaption class="real">
          <img
            [src]="'landing/fotos/' + current().id + '.webp'"
            [alt]="'Fotografía de un interior real de estilo ' + current().label + '.'"
            width="720"
            height="480"
            loading="lazy"
            decoding="async"
          />
          <span>El estilo, en una casa real</span>
        </figcaption>
      </figure>
      <div class="copy">
        <div class="swatches" aria-hidden="true">
          @for (c of current().palette; track c) {
            <span [style.background]="c"></span>
          }
        </div>
        <h3>{{ current().label }}</h3>
        <p class="muted">{{ current().description }}</p>
        <ul class="details" [attr.aria-label]="'Lo típico del estilo ' + current().label">
          @for (d of details[current().id]; track d) {
            <li>{{ d }}</li>
          }
        </ul>
        @if (pieces().length) {
          <dl class="pieces">
            @for (p of pieces(); track p.id) {
              <div>
                <dt>{{ p.name }}</dt>
                <dd>{{ p.price | currency: 'USD' : 'symbol' : '1.0-0' }}</dd>
              </div>
            }
          </dl>
          <p class="fine muted">Precios estimados del catálogo: la app no vende nada.</p>
        }
        <a class="arrow-link" [routerLink]="link().path" [queryParams]="link().query" [attr.aria-label]="'Empezar con el estilo ' + current().label">
          Empezar con este estilo <app-icon name="arrowRight" />
        </a>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .tabs {
      display: flex;
      gap: var(--space-5);
      overflow-x: auto;
      border-bottom: 1px solid var(--rule);
      margin-bottom: var(--space-6);
      scrollbar-width: none;
    }
    .tab {
      flex: none;
      min-height: 48px;
      padding: 0 2px;
      border: 0;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      background: none;
      color: var(--text-muted);
      font-family: var(--font-display);
      font-size: var(--text-lg);
      cursor: pointer;
    }
    .tab:hover {
      color: var(--text);
    }
    .tab[aria-selected='true'] {
      color: var(--text);
      border-bottom-color: var(--accent);
    }
    .panel {
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
      gap: var(--space-6) var(--space-7);
      align-items: center;
    }
    .look {
      position: relative;
      margin: 0;
      /* Hueco para la foto, que sobresale por debajo del cuarto. */
      padding-bottom: var(--space-6);
    }
    .real {
      position: absolute;
      left: var(--space-4);
      bottom: 0;
      width: min(34%, 240px);
      display: grid;
      gap: 6px;
      padding: 6px 6px 8px;
      border-radius: var(--radius-sm);
      background: var(--surface);
      box-shadow: var(--shadow);
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .real img {
      width: 100%;
      height: auto;
      aspect-ratio: 3 / 2;
      object-fit: cover;
      border-radius: 4px;
    }
    .real span {
      padding-inline: 2px;
    }
    .room {
      width: 100%;
      height: auto;
      aspect-ratio: 3 / 2;
      object-fit: cover;
      border-radius: var(--radius-lg);
      background: var(--surface-2);
    }
    .copy {
      display: grid;
      gap: var(--space-3);
      justify-items: start;
    }
    .copy > * {
      margin: 0;
    }
    h3 {
      font-size: var(--text-2xl);
      font-weight: 440;
    }
    .swatches {
      display: flex;
      gap: 6px;
    }
    .swatches span {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 1px solid var(--rule);
    }
    .details {
      list-style: none;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 6px var(--space-4);
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .details li::before {
      content: '— ';
      color: var(--accent);
    }
    .pieces {
      width: 100%;
      margin-top: var(--space-2);
      border-top: 1px solid var(--rule);
    }
    .pieces div {
      display: flex;
      justify-content: space-between;
      gap: var(--space-4);
      padding: 10px 0;
      border-bottom: 1px solid var(--rule);
    }
    .pieces dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }
    .arrow-link {
      margin-top: var(--space-3);
    }
    @media (max-width: 900px) {
      .panel {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class StyleShowcaseComponent {
  readonly signedIn = input(false);

  protected readonly styles = STYLE_IDS.map((id) => STYLES[id]);
  protected readonly details = DETAILS;
  protected readonly index = signal(0);
  protected readonly current = computed(() => this.styles[this.index()]!);
  protected readonly link = computed(() => styleLink(this.current().id, this.signedIn()));
  private readonly catalog = signal<readonly CatalogItem[]>([]);
  /** Piezas del catálogo de ese estilo; sin red, la sección sigue sin ellas. */
  protected readonly pieces = computed(() => piecesFor(this.current().id, this.catalog()));
  private readonly tabs = viewChildren<ElementRef<HTMLButtonElement>>('tab');

  constructor() {
    inject(CatalogApi)
      .all()
      .then((items) => this.catalog.set(items))
      .catch(() => undefined);
  }

  /** Flechas, Inicio y Fin cambian de pestaña y llevan el foco con ellas. */
  protected onKey(event: KeyboardEvent, from: number): void {
    const next = tabAfterKey(event.key, from, this.styles.length);
    if (next === null) return;
    event.preventDefault();
    this.index.set(next);
    this.tabs()[next]?.nativeElement.focus();
  }
}
