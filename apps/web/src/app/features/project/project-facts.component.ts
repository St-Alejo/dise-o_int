import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RoomPlan, type RoomShell } from '@interiores/shared-types';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { DesignProjectStore } from './design-project.store';

export interface ProjectFact {
  icon: IconName;
  label: string;
  value: string;
}

const metres = (value: number) => value.toFixed(2).replace('.', ',');
// Mismo formato que el total del panel del editor.
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Los datos del cuarto que se enseñan sobre el editor: lo que falta (cuarto, precios) no aparece. */
export function factsOf(shell: RoomShell | null, pieces: number, total: number): ProjectFact[] {
  const facts: ProjectFact[] = [];
  if (shell) {
    facts.push(
      { icon: 'area', label: 'Superficie', value: `${RoomPlan.from(shell).area().toFixed(1).replace('.', ',')} m²` },
      { icon: 'ruler', label: 'Medidas', value: `${metres(shell.widthM)} × ${metres(shell.depthM)} m` },
      { icon: 'layers', label: 'Alto', value: `${metres(shell.heightM)} m` },
    );
  }
  facts.push({ icon: 'sofa', label: 'Muebles', value: String(pieces) });
  if (total > 0) facts.push({ icon: 'tag', label: 'Total aprox.', value: money.format(total) });
  return facts;
}

/**
 * Franja de datos del proyecto abierto. Lee el estado vivo del editor, así que cambia al mover una
 * pared o al añadir un mueble. Sirve igual en el enlace público.
 */
@Component({
  selector: 'app-project-facts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <dl class="facts">
      @for (fact of facts(); track fact.label) {
        <div class="fact">
          <app-icon [name]="fact.icon" />
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
        </div>
      }
    </dl>
  `,
  styles: `
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin: 0;
    }
    .fact {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      font-size: var(--text-sm);
    }
    app-icon {
      color: var(--primary);
      align-self: center;
    }
    dt {
      color: var(--text-muted);
    }
    dd {
      margin: 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ProjectFactsComponent {
  private readonly store = inject(DesignProjectStore);
  protected readonly facts = computed(() => factsOf(this.store.shell(), this.store.placements().length, this.store.totalPrice()));
}
