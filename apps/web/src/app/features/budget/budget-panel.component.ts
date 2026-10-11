import { CurrencyPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { budgetStatus, totalsByCategory } from '@interiores/shared-types';
import { DesignProjectStore } from '../project/design-project.store';

const STORAGE_PREFIX = 'interiores.presupuesto.';

/** El tope guardado para un proyecto en este navegador (null si no hay). */
export function readBudget(projectId: string): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_PREFIX + projectId));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeBudget(projectId: string, cap: number | null): void {
  try {
    if (cap === null) localStorage.removeItem(STORAGE_PREFIX + projectId);
    else localStorage.setItem(STORAGE_PREFIX + projectId, String(cap));
  } catch {
    // Sin almacenamiento, el tope vale solo para esta visita.
  }
}

/**
 * Presupuesto del cuarto: un tope que pone la persona, cuánto lleva gastado y en qué se va. El
 * tope es una nota personal: se guarda en este navegador, no en el proyecto.
 */
@Component({
  selector: 'app-budget-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, PercentPipe],
  template: `
    <details class="budget" [class.over]="status().level === 'over'" [class.near]="status().level === 'near'">
      <summary>
        <span>Presupuesto</span>
        @switch (status().level) {
          @case ('over') { <span class="badge badge-danger">Te pasas {{ -status().remaining | currency: 'USD' : 'symbol' : '1.0-0' }}</span> }
          @case ('near') { <span class="badge badge-warning">Quedan {{ status().remaining | currency: 'USD' : 'symbol' : '1.0-0' }}</span> }
          @case ('ok') { <span class="badge badge-success">Quedan {{ status().remaining | currency: 'USD' : 'symbol' : '1.0-0' }}</span> }
          @default { <span class="muted">sin tope</span> }
        }
      </summary>
      <div class="body">
        <label class="cap">
          <span>Tope (USD)</span>
          <input
            class="input"
            type="number"
            min="0"
            step="50"
            inputmode="numeric"
            placeholder="Sin tope"
            [value]="cap() ?? ''"
            (change)="setCap($any($event.target).value)"
          />
        </label>
        @if (status().level !== 'none') {
          <div class="meter" role="img" [attr.aria-label]="'Llevas gastado el ' + (status().used | percent) + ' del tope'">
            <span [style.width.%]="fill()"></span>
          </div>
        }
        @if (totals().length) {
          <table>
            <caption class="visually-hidden">Total estimado por categoría</caption>
            <tbody>
              @for (t of totals(); track t.category) {
                <tr>
                  <th scope="row">{{ t.label }} <span class="muted">({{ t.pieces }})</span></th>
                  <td>{{ t.share | percent }}</td>
                  <td>{{ t.total | currency: 'USD' : 'symbol' : '1.0-0' }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="muted fine">Aún no hay muebles con precio.</p>
        }
        <p class="muted fine">El tope se guarda en este navegador. Los precios son estimados del catálogo.</p>
      </div>
    </details>
  `,
  styles: `
    .budget {
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      margin: 8px 0;
    }
    summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding: 8px 0;
      font-weight: 600;
      cursor: pointer;
    }
    .body {
      display: grid;
      gap: var(--space-2);
      padding-bottom: var(--space-3);
    }
    .cap {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-2);
      align-items: center;
      font-size: var(--text-sm);
    }
    .meter {
      height: 6px;
      border-radius: 999px;
      background: var(--surface-2);
      overflow: hidden;
    }
    .meter span {
      display: block;
      height: 100%;
      background: var(--success);
    }
    .near .meter span {
      background: var(--warning);
    }
    .over .meter span {
      background: var(--danger);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    th {
      text-align: left;
      font-weight: 500;
    }
    td {
      text-align: right;
      font-variant-numeric: tabular-nums;
      padding-left: var(--space-2);
    }
    th,
    td {
      padding-block: 3px;
    }
    p {
      margin: 0;
    }
  `,
})
export class BudgetPanelComponent {
  private readonly store = inject(DesignProjectStore);

  protected readonly cap = signal<number | null>(null);
  protected readonly totals = computed(() => totalsByCategory(this.store.placements(), this.store.catalog()));
  protected readonly status = computed(() => budgetStatus(this.store.totalPrice(), this.cap()));
  protected readonly fill = computed(() => Math.min(100, Math.round(this.status().used * 100)));

  constructor() {
    // Cada proyecto tiene su tope: al abrir otro se lee el suyo.
    effect(() => {
      const id = this.store.project()?.id;
      untracked(() => this.cap.set(id ? readBudget(id) : null));
    });
  }

  protected setCap(raw: string): void {
    const value = Number(raw);
    const cap = raw.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null;
    this.cap.set(cap);
    const id = this.store.project()?.id;
    if (id) writeBudget(id, cap);
  }
}
