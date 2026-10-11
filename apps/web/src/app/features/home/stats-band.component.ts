import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ROOM_SHAPE_IDS, ROOM_TYPES, STYLE_IDS, type CatalogItem } from '@interiores/shared-types';
import { CatalogApi } from '../../core/api/projects.api';

export interface Stat {
  value: number;
  label: string;
}

/** Cifras que no dependen de la red: salen del mismo código que usa el editor. */
const FIXED: Stat[] = [
  { value: ROOM_TYPES.length, label: 'tipos de cuarto, de la sala al baño' },
  { value: ROOM_SHAPE_IDS.length, label: 'formas de planta: rectangular, en L, en T y en U' },
  { value: STYLE_IDS.length, label: 'estilos para amueblar' },
];

/** Las cifras de la franja: las del catálogo solo si se pudo leer. */
export function statsOf(catalog: readonly Pick<CatalogItem, 'category'>[] | null): Stat[] {
  if (!catalog?.length) return FIXED;
  return [
    { value: catalog.length, label: 'muebles y objetos en el catálogo' },
    { value: new Set(catalog.map((item) => item.category)).size, label: 'categorías, de sofás a lámparas' },
    ...FIXED,
  ];
}

/**
 * Las cifras de la página de inicio, en una fila de numerales. Son datos reales: el catálogo público y las listas de
 * `shared-types`. Si el catálogo no responde, se muestran las demás sin dejar huecos.
 */
@Component({
  selector: 'app-stats-band',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="visually-hidden">La app en cifras</h2>
    <dl class="band">
      @for (stat of stats(); track stat.label) {
        <div class="stat">
          <dt class="stat-label">{{ stat.label }}</dt>
          <dd class="stat-value">{{ stat.value }}</dd>
        </div>
      }
    </dl>
  `,
  styles: `
    :host {
      display: block;
    }
    .band {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: var(--space-5) var(--space-6);
      margin: 0;
      padding-top: var(--space-5);
      border-top: 1px solid var(--rule);
    }
    /* La cifra va antes que su leyenda a la vista; en el HTML, el término antes que el valor. */
    .stat {
      display: grid;
      gap: var(--space-2);
      align-content: start;
    }
    dt {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    dd {
      margin: 0;
      order: -1;
      font-family: var(--font-display);
      font-size: var(--text-3xl);
      font-weight: 380;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class StatsBandComponent {
  private readonly catalog = signal<CatalogItem[] | null>(null);
  protected readonly stats = computed(() => statsOf(this.catalog()));

  constructor() {
    inject(CatalogApi)
      .all()
      .then((items) => this.catalog.set(items))
      .catch(() => undefined); // Sin catálogo quedan las cifras fijas.
  }
}
