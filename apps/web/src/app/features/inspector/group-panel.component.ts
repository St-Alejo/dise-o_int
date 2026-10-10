import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ALIGN_LABELS, type AlignMode } from '@interiores/shared-types';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';

const ALIGN_X: readonly AlignMode[] = ['left', 'centre-x', 'right'];
const ALIGN_Z: readonly AlignMode[] = ['back', 'centre-z', 'front'];
const SHORT: Record<AlignMode, string> = { left: 'Izquierda', 'centre-x': 'Centro', right: 'Derecha', back: 'Fondo', 'centre-z': 'Centro', front: 'Frente' };

/**
 * Panel de la multiselección: lo que se puede hacer con varios muebles a la vez. Cada acción es
 * un solo paso de deshacer.
 */
@Component({
  selector: 'app-group-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <div class="row">
        <h3>{{ count() }} muebles seleccionados</h3>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" aria-label="Deseleccionar" (click)="store.select(null)">×</button>
      </div>
      <p class="muted small">Con Shift+clic añades o quitas muebles de la selección. Las flechas los mueven juntos.</p>

      <section class="block" aria-labelledby="grp-align">
        <h4 id="grp-align">Alinear</h4>
        <div class="grid">
          @for (mode of alignX; track mode) {
            <button type="button" class="btn btn-sm" [title]="labels[mode]" [attr.aria-label]="labels[mode]" (click)="edits.align(mode)">{{ short[mode] }}</button>
          }
          @for (mode of alignZ; track mode) {
            <button type="button" class="btn btn-sm" [title]="labels[mode]" [attr.aria-label]="labels[mode]" (click)="edits.align(mode)">{{ short[mode] }}</button>
          }
        </div>
      </section>

      <section class="block" aria-labelledby="grp-dist">
        <h4 id="grp-dist">Repartir con la misma separación</h4>
        <div class="grid two">
          <button type="button" class="btn btn-sm" (click)="edits.distribute('x')" [disabled]="count() < 3">A lo ancho</button>
          <button type="button" class="btn btn-sm" (click)="edits.distribute('z')" [disabled]="count() < 3">A lo largo</button>
        </div>
        @if (count() < 3) {
          <p class="muted small">Hacen falta al menos tres muebles.</p>
        }
      </section>

      <div class="grid two">
        <button type="button" class="btn" (click)="edits.duplicateSelection()">Duplicar</button>
        <button type="button" class="btn" (click)="edits.lockSelection(!allLocked())">{{ allLocked() ? 'Soltar todos' : 'Fijar todos' }}</button>
        <button type="button" class="btn btn-danger" (click)="edits.removeSelection()">Quitar todos</button>
      </div>
    </div>
  `,
  styles: `
    h3 {
      margin: 0;
      font-size: 1.05rem;
    }
    h4 {
      margin: 0 0 8px;
      font-size: 0.9rem;
    }
    .small {
      margin: 0;
      font-size: 0.82rem;
    }
    .block {
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .grid.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .grid .btn {
      min-width: 0;
      padding: 0 8px;
    }
  `,
})
export class GroupPanelComponent {
  protected readonly store = inject(DesignProjectStore);
  protected readonly edits = inject(SceneEditsService);
  protected readonly alignX = ALIGN_X;
  protected readonly alignZ = ALIGN_Z;
  protected readonly labels = ALIGN_LABELS;
  protected readonly short = SHORT;

  protected readonly count = computed(() => this.store.selection().length);
  protected readonly allLocked = computed(() => this.store.selection().every((p) => p.lockedByUser));
}
