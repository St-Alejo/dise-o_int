import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  CalibrationError,
  calibrateRoomShell,
  referenceValue,
  type CalibrationReference,
} from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { ToastService } from '../../core/ui/toast.service';
import { DesignProjectStore } from '../project/design-project.store';

const REFERENCES: { id: CalibrationReference; label: string; hint: string; def: number }[] = [
  { id: 'door-height', label: 'Altura de la puerta', hint: 'Una puerta estándar mide ~2.0 m', def: 2.0 },
  { id: 'ceiling-height', label: 'Altura del techo', hint: 'Suele estar entre 2.4 y 2.7 m', def: 2.5 },
  { id: 'room-width', label: 'Ancho del cuarto', hint: 'La pared que ves de frente en la foto', def: 4 },
  { id: 'room-depth', label: 'Profundidad del cuarto', hint: 'Desde la cámara hasta la pared del fondo', def: 4 },
];

/**
 * Calibración de un solo gesto (§8.1): la profundidad monocular es relativa; el usuario
 * confirma UNA medida conocida y todo el cuarto se reescala. La vista previa se calcula en
 * el cliente con la misma función que usa el servidor (packages/shared-types).
 */
@Component({
  selector: 'app-calibration-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <dialog #dialog class="modal" aria-labelledby="cal-title" (close)="closed.emit()">
      <form method="dialog" class="modal-body stack" (submit)="$event.preventDefault(); apply()">
        <h2 id="cal-title">Ajustar medidas reales</h2>
        <p class="muted">
          Estimamos las medidas desde una sola foto, así que son aproximadas. Confirma una medida que conozcas y
          reescalamos todo el cuarto.
        </p>
        <fieldset class="refs">
          <legend class="label">¿Qué medida conoces?</legend>
          @for (r of references; track r.id) {
            <label class="ref" [class.selected]="reference() === r.id" [class.disabled]="current(r.id) === null">
              <input type="radio" name="ref" [value]="r.id" [checked]="reference() === r.id" [disabled]="current(r.id) === null" (change)="pick(r.id)" />
              <span>
                <strong>{{ r.label }}</strong>
                <span class="muted small">
                  @if (current(r.id) !== null) {
                    estimada: {{ current(r.id) | number: '1.2-2' }} m · {{ r.hint }}
                  } @else {
                    no se detectó ninguna puerta
                  }
                </span>
              </span>
            </label>
          }
        </fieldset>
        <div class="field">
          <label for="cal-value">Medida real (metros)</label>
          <input id="cal-value" class="input" type="number" min="0.3" max="30" step="0.01" [value]="value()" (input)="value.set(+$any($event.target).value)" />
        </div>
        @if (preview(); as pv) {
          @if (pv.error) {
            <p class="alert alert-danger" role="alert">{{ pv.error }}</p>
          } @else {
            <p class="alert" style="background: var(--surface-2)" aria-live="polite">
              El cuarto quedará de <strong>{{ pv.w | number: '1.2-2' }} × {{ pv.d | number: '1.2-2' }} m</strong> y
              {{ pv.h | number: '1.2-2' }} m de alto (factor ×{{ pv.factor | number: '1.2-2' }}).
            </p>
          }
        }
      </form>
      <div class="modal-actions">
        <button type="button" class="btn" (click)="close()">Cancelar</button>
        <button type="button" class="btn btn-primary" [disabled]="saving() || !!preview()?.error" (click)="apply()">
          {{ saving() ? 'Aplicando…' : 'Aplicar medidas' }}
        </button>
      </div>
    </dialog>
  `,
  styles: `
    .refs {
      border: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 8px;
    }
    .ref {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      cursor: pointer;
    }
    .ref > span {
      display: grid;
    }
    .ref.selected {
      border-color: var(--primary);
      background: var(--primary-soft);
    }
    .ref.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .small {
      font-size: 0.82rem;
    }
  `,
})
export class CalibrationDialogComponent {
  private readonly store = inject(DesignProjectStore);
  private readonly api = inject(ProjectsApi);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly closed = output<void>();

  protected readonly references = REFERENCES;
  protected readonly reference = signal<CalibrationReference>('ceiling-height');
  protected readonly value = signal(2.5);
  protected readonly saving = signal(false);

  protected readonly preview = computed(() => {
    const shell = this.store.shell();
    if (!shell) return null;
    try {
      const { shell: s, factor } = calibrateRoomShell(shell, this.reference(), this.value());
      return { w: s.widthM, d: s.depthM, h: s.heightM, factor, error: null };
    } catch (err) {
      return { w: 0, d: 0, h: 0, factor: 1, error: err instanceof CalibrationError ? err.message : 'Medida inválida' };
    }
  });

  current(ref: CalibrationReference): number | null {
    const shell = this.store.shell();
    return shell ? referenceValue(shell, ref) : null;
  }

  open(): void {
    const hasDoor = this.current('door-height') !== null;
    this.pick(hasDoor ? 'door-height' : 'ceiling-height');
    this.dialog().nativeElement.showModal();
  }

  pick(ref: CalibrationReference): void {
    this.reference.set(ref);
    const def = REFERENCES.find((r) => r.id === ref)!.def;
    const cur = this.current(ref);
    this.value.set(ref === 'room-width' || ref === 'room-depth' ? Math.round((cur ?? def) * 100) / 100 : def);
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  async apply(): Promise<void> {
    const project = this.store.project();
    if (!project || this.preview()?.error) return;
    await this.store.flush();
    this.saving.set(true);
    try {
      const updated = await this.api.calibrate(project.id, {
        revision: this.store.project()!.revision,
        reference: this.reference(),
        valueM: this.value(),
      });
      this.store.replaceFromServer(updated);
      this.toast.success('Medidas actualizadas: el cuarto y los muebles se reescalaron.');
      this.close();
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    } finally {
      this.saving.set(false);
    }
  }
}
