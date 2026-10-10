import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { DesignIssue, IssueSeverity } from '@interiores/shared-types';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';

const SEVERITY: Record<IssueSeverity, string> = { problem: 'Problema', warning: 'Atención', tip: 'Sugerencia' };

/**
 * Revisión del diseño: lo que conviene corregir antes de dar el cuarto por bueno (la puerta
 * bloqueada, un mueble al que no se llega, una ventana tapada). Se recalcula con cada cambio y
 * al pulsar un aviso se selecciona el mueble implicado.
 */
@Component({
  selector: 'app-design-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="review-title">
      <h3 id="review-title">Revisión del diseño</h3>
      @if (edits.issues().length) {
        <ul class="list" role="list">
          @for (issue of edits.issues(); track issue.id) {
            <li>
              <button type="button" class="issue" [class]="'issue issue-' + issue.severity" (click)="open(issue)" [disabled]="!issue.placementIds.length">
                <span class="tag">{{ labels[issue.severity] }}</span>
                <strong>{{ issue.title }}</strong>
                <span class="muted">{{ issue.detail }}</span>
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="ok" role="status">Todo en orden: se puede entrar, se llega a cada mueble y nada tapa las ventanas.</p>
      }
    </section>
  `,
  styles: `
    h3 {
      margin: 0 0 8px;
      font-size: 1.05rem;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .issue {
      width: 100%;
      display: grid;
      gap: 2px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-left-width: 4px;
      border-radius: 10px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 0.88rem;
      text-align: left;
      cursor: pointer;
    }
    .issue:disabled {
      cursor: default;
    }
    .issue:hover:not(:disabled) {
      background: var(--surface-2);
    }
    .issue-problem {
      border-left-color: var(--danger);
    }
    .issue-warning {
      border-left-color: var(--warning);
    }
    .issue-tip {
      border-left-color: var(--accent);
    }
    .tag {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .muted {
      font-size: 0.8rem;
    }
    .ok {
      margin: 0;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--success-soft);
      color: var(--success);
      font-size: 0.85rem;
    }
  `,
})
export class DesignReviewComponent {
  private readonly store = inject(DesignProjectStore);
  protected readonly edits = inject(SceneEditsService);
  protected readonly labels = SEVERITY;

  protected open(issue: DesignIssue): void {
    const id = issue.placementIds[0];
    if (id) this.store.select(id);
  }
}
