import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { FurniturePlacement } from '@interiores/shared-types';
import { CATEGORY_LABELS } from '../catalog/catalog-labels';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';
import { SceneService } from '../viewport-3d/scene.service';

interface OutlinerRow {
  placement: FurniturePlacement;
  name: string;
  /** Dónde está: sobre qué mueble, en la pared, colgado del techo o su categoría. */
  where: string;
}

/**
 * Lista de todo lo que hay en el cuarto: sirve para encontrar y seleccionar una pieza tapada por
 * otra (una lámpara detrás del sofá), fijarla para que "Otra distribución" no la mueva, quitarla
 * o vaciar el cuarto entero.
 */
@Component({
  selector: 'app-outliner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <div class="row">
        <h3>Objetos del cuarto</h3>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm btn-danger" (click)="edits.clear()" [disabled]="!rows().length" title="Quita todos los muebles (se puede deshacer)">Vaciar cuarto</button>
      </div>
      <ul class="list" role="list">
        @for (row of rows(); track row.placement.id) {
          <li class="line">
            <button type="button" class="pick" (click)="store.select(row.placement.id)">
              <strong>{{ row.name }}</strong>
              <span class="muted">{{ row.where }}</span>
            </button>
            <button
              type="button"
              class="mini"
              [attr.aria-pressed]="row.placement.lockedByUser"
              [attr.aria-label]="'Fijar ' + row.name"
              [title]="row.placement.lockedByUser ? 'Fijo: Otra distribución no lo mueve' : 'Libre: Otra distribución puede moverlo'"
              (click)="edits.toggleLock(row.placement)"
            >
              {{ row.placement.lockedByUser ? 'Fijo' : 'Libre' }}
            </button>
            <button type="button" class="mini danger" [attr.aria-label]="'Quitar ' + row.name" (click)="remove(row.placement.id)">Quitar</button>
          </li>
        } @empty {
          <li class="muted empty">El cuarto está vacío. Añade muebles desde el catálogo o arrástralos al plano.</li>
        }
      </ul>
    </div>
  `,
  styles: `
    h3 {
      margin: 0;
      font-size: 1.05rem;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
      max-height: 52vh;
      overflow: auto;
    }
    .line {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px 4px 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
    }
    .line:hover {
      border-color: var(--primary);
    }
    .pick {
      flex: 1;
      min-width: 0;
      display: grid;
      gap: 2px;
      padding: 6px 10px;
      border: none;
      background: none;
      color: var(--text);
      font: inherit;
      font-size: 0.88rem;
      text-align: left;
      cursor: pointer;
    }
    .pick strong,
    .pick .muted {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pick .muted {
      font-size: 0.78rem;
    }
    .mini {
      min-height: 28px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--text-muted);
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .mini[aria-pressed='true'] {
      background: var(--primary-soft);
      border-color: var(--primary);
      color: var(--primary-strong);
      font-weight: 600;
    }
    .mini.danger {
      color: var(--danger);
    }
    .empty {
      font-size: 0.85rem;
    }
  `,
})
export class OutlinerComponent {
  protected readonly store = inject(DesignProjectStore);
  protected readonly edits = inject(SceneEditsService);
  private readonly scene = inject(SceneService);

  protected readonly rows = computed<OutlinerRow[]>(() => {
    const catalog = this.store.catalog();
    const placements = this.store.placements();
    const nameOf = (id: string | undefined) => {
      const p = id ? placements.find((x) => x.id === id) : undefined;
      return p ? catalog.get(p.catalogItemId)?.name : undefined;
    };
    return placements
      .flatMap((placement) => {
        const item = catalog.get(placement.catalogItemId);
        if (!item) return [];
        const on = nameOf(placement.supportId);
        const where = on ? `Sobre ${on}` : placement.wallId ? 'En la pared' : item.mount === 'ceiling' ? 'Colgado del techo' : CATEGORY_LABELS[item.category];
        return [{ placement, name: item.name, where }];
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });

  /** Igual que Supr en el visor: lo que tenía encima cae al piso en vez de desaparecer. */
  protected remove(id: string): void {
    this.store.select(id);
    this.scene.removeSelected();
  }
}
