import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SegmentOption<T extends string = string> {
  id: T;
  label: string;
  /** Explicación al pasar el cursor. */
  title?: string;
}

/**
 * Control segmentado: unas pocas opciones excluyentes en una sola pastilla (la vista del editor, la
 * luz del encabezado). Son botones con `aria-pressed` dentro de un grupo con nombre, así que se
 * recorren con Tab y se activan con Enter o Espacio como cualquier botón.
 */
@Component({
  selector: 'app-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="segmented" role="group" [attr.aria-label]="label()">
      @for (option of options(); track option.id) {
        <button type="button" [attr.aria-pressed]="value() === option.id" [attr.title]="option.title ?? null" (click)="value.set(option.id)">
          {{ option.label }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .segmented {
      display: inline-flex;
      gap: 2px;
      padding: 3px;
      border-radius: 999px;
      border: 1px solid var(--rule);
      background: var(--surface);
    }
    button {
      min-height: 34px;
      padding: 0 var(--space-4);
      border: 0;
      border-radius: 999px;
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover {
      color: var(--text);
    }
    button[aria-pressed='true'] {
      background: var(--text);
      color: var(--bg);
    }
  `,
})
export class SegmentedComponent<T extends string = string> {
  /** Nombre del grupo para lectores de pantalla ("Vista del editor"). */
  readonly label = input.required<string>();
  readonly options = input.required<readonly SegmentOption<T>[]>();
  /** Opción elegida (enlace de doble sentido). */
  readonly value = model.required<T>();
}
