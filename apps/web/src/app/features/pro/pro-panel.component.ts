import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CompliancePanelComponent } from './compliance-panel.component';
import { DrawingsPanelComponent } from './drawings-panel.component';
import { TakeoffPanelComponent } from './takeoff-panel.component';
import { TechnicalFormComponent } from './technical-form.component';

/**
 * Pestaña Pro del editor: lo que necesita un profesional para llevar el diseño a obra. Cada bloque
 * se pliega para no abrumar; el de la ficha técnica es la base de los demás.
 */
@Component({
  selector: 'app-pro-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TechnicalFormComponent, DrawingsPanelComponent, CompliancePanelComponent, TakeoffPanelComponent],
  template: `
    <div class="pro">
      <details open>
        <summary>Planos técnicos</summary>
        <app-drawings-panel />
      </details>
      <details>
        <summary>Normativa y ergonomía</summary>
        <app-compliance-panel />
      </details>
      <details>
        <summary>Cantidades y presupuesto de obra</summary>
        <app-takeoff-panel />
      </details>
      <details>
        <summary>Ficha técnica</summary>
        <app-technical-form />
      </details>
    </div>
  `,
  styles: `
    .pro {
      display: grid;
      gap: var(--space-2);
    }
    details {
      border-bottom: 1px solid var(--border);
      padding-bottom: var(--space-2);
    }
    summary {
      padding: 8px 0;
      font-weight: 600;
      cursor: pointer;
    }
  `,
})
export class ProPanelComponent {}
