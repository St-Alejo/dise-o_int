import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ROOM_LIMITS } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ToastService } from '../../core/ui/toast.service';
import { DesignProjectStore } from '../project/design-project.store';
import {
  wallOptions,
  draftFromShell,
  newOpening,
  openingsFromDraft,
  previewRoom,
  wallLengthsFor,
  withDimension,
  type OpeningDraft,
  type RoomDraft,
} from './room-draft';

/**
 * "Medidas del cuarto": el usuario escribe ancho, largo y alto exactos (cada uno por separado)
 * y ajusta puertas y ventanas. La vista previa usa la misma geometría que el servidor, así el
 * error que se ve aquí es el mismo que daría la API. Si no tiene metro, puede calibrar con una
 * sola medida conocida (`calibrate`).
 */
@Component({
  selector: 'app-room-dimensions-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <dialog #dialog class="modal wide" aria-labelledby="room-title" (close)="closed.emit()">
      @if (draft(); as d) {
        <form class="modal-body stack" (submit)="$event.preventDefault(); apply()">
          <h2 id="room-title">Medidas del cuarto</h2>
          <p class="muted">Escribe las medidas reales en metros. Los muebles que queden fuera se acomodan dentro; ninguno se borra.</p>

          <div class="dims">
            <div class="field">
              <label for="room-w">Ancho del cuarto</label>
              <div class="unit"><input id="room-w" class="input" type="number" inputmode="decimal" step="0.01" [min]="limits.minSideM" [max]="limits.maxSideM" [value]="d.widthM" (input)="setDim('widthM', $event)" /><span>m</span></div>
            </div>
            <div class="field">
              <label for="room-d">Largo del cuarto</label>
              <div class="unit"><input id="room-d" class="input" type="number" inputmode="decimal" step="0.01" [min]="limits.minSideM" [max]="limits.maxSideM" [value]="d.depthM" (input)="setDim('depthM', $event)" /><span>m</span></div>
            </div>
            <div class="field">
              <label for="room-h">Alto del techo</label>
              <div class="unit"><input id="room-h" class="input" type="number" inputmode="decimal" step="0.01" [min]="limits.minHeightM" [max]="limits.maxHeightM" [value]="d.heightM" (input)="setDim('heightM', $event)" /><span>m</span></div>
            </div>
          </div>

          <fieldset class="openings">
            <legend class="label">Puertas y ventanas</legend>
            @for (o of d.openings; track o.id; let i = $index) {
              <div class="opening" role="group" [attr.aria-label]="(o.type === 'door' ? 'Puerta ' : 'Ventana ') + (i + 1)">
                <span class="kind" aria-hidden="true">{{ o.type === 'door' ? '🚪' : '🪟' }}</span>
                <div class="field">
                  <label [for]="'o-wall-' + i">Pared</label>
                  <select [id]="'o-wall-' + i" class="input" [value]="o.wallId" (change)="patchOpening(i, { wallId: $any($event.target).value })">
                    @for (w of walls(); track w.id) {
                      <option [value]="w.id" [selected]="w.id === o.wallId">{{ w.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label [for]="'o-from-' + i">Desde la esquina</label>
                  <input [id]="'o-from-' + i" class="input" type="number" step="0.01" min="0" [value]="o.fromCornerM" (input)="patchOpening(i, { fromCornerM: num($event) })" />
                  <span class="hint">pared de {{ lengths()[o.wallId] | number: '1.2-2' }} m</span>
                </div>
                <div class="field">
                  <label [for]="'o-w-' + i">Ancho</label>
                  <input [id]="'o-w-' + i" class="input" type="number" step="0.01" min="0.2" [value]="o.widthM" (input)="patchOpening(i, { widthM: num($event) })" />
                </div>
                <div class="field">
                  <label [for]="'o-h-' + i">Alto</label>
                  <input [id]="'o-h-' + i" class="input" type="number" step="0.01" min="0.2" [value]="o.heightM" (input)="patchOpening(i, { heightM: num($event) })" />
                </div>
                @if (o.type === 'window') {
                  <div class="field">
                    <label [for]="'o-s-' + i">Alféizar</label>
                    <input [id]="'o-s-' + i" class="input" type="number" step="0.01" min="0" [value]="o.sillHeightM" (input)="patchOpening(i, { sillHeightM: num($event) })" />
                  </div>
                } @else {
                  <span></span>
                }
                <button type="button" class="icon-btn" [attr.aria-label]="'Quitar ' + (o.type === 'door' ? 'puerta' : 'ventana') + ' ' + (i + 1)" (click)="removeOpening(i)">×</button>
              </div>
            } @empty {
              <p class="muted small">Sin puertas ni ventanas.</p>
            }
            <div class="row">
              <button type="button" class="btn btn-sm" (click)="addOpening('door')">+ Puerta</button>
              <button type="button" class="btn btn-sm" (click)="addOpening('window')">+ Ventana</button>
            </div>
          </fieldset>

          @if (preview(); as pv) {
            @if (pv.error) {
              <p class="alert alert-danger" role="alert">{{ pv.error }}</p>
            } @else {
              <p class="alert" style="background: var(--surface-2)" aria-live="polite">
                Quedará de <strong>{{ d.widthM | number: '1.2-2' }} × {{ d.depthM | number: '1.2-2' }} m</strong>
                ({{ d.widthM * d.depthM | number: '1.1-1' }} m²) y {{ d.heightM | number: '1.2-2' }} m de alto.
                @if (pv.moved) { Se acomodarán {{ pv.moved }} mueble(s) para que queden dentro. }
                @if (pv.tooBig) { <strong>{{ pv.tooBig }} mueble(s) no caben</strong>: quedarán marcados para que los cambies o quites. }
              </p>
            }
          }
        </form>
        <div class="modal-actions">
          <button type="button" class="btn btn-link" (click)="calibrate.emit(); close()">¿No tienes metro? Calibra con una medida</button>
          <span class="spacer"></span>
          <button type="button" class="btn" (click)="close()">Cancelar</button>
          <button type="button" class="btn btn-primary" [disabled]="saving() || !!preview()?.error" (click)="apply()">
            {{ saving() ? 'Aplicando…' : 'Aplicar medidas' }}
          </button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .wide {
      width: min(760px, calc(100vw - 32px));
    }
    .dims {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .unit {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .unit span,
    .hint {
      color: var(--text-muted);
      font-size: 0.8rem;
    }
    .openings {
      border: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 10px;
    }
    .opening {
      display: grid;
      grid-template-columns: auto 1.6fr repeat(4, minmax(0, 1fr)) auto;
      gap: 8px;
      align-items: end;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .opening .field label {
      font-size: 0.78rem;
    }
    .kind {
      font-size: 1.3rem;
      align-self: center;
    }
    .small {
      font-size: 0.85rem;
      margin: 0;
    }
    .btn-link {
      background: none;
      border: none;
      color: var(--primary);
      text-decoration: underline;
      padding: 0;
      cursor: pointer;
    }
    @media (max-width: 720px) {
      .dims {
        grid-template-columns: 1fr;
      }
      .opening {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .kind {
        display: none;
      }
    }
  `,
})
export class RoomDimensionsDialogComponent {
  private readonly store = inject(DesignProjectStore);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly closed = output<void>();
  /** El usuario prefiere calibrar con una sola medida conocida. */
  readonly calibrate = output<void>();

  protected readonly limits = ROOM_LIMITS;
  protected readonly walls = computed(() => wallOptions(this.store.shell()));
  protected readonly draft = signal<RoomDraft | null>(null);
  protected readonly saving = signal(false);
  protected readonly lengths = computed(() => {
    const d = this.draft();
    return d ? wallLengthsFor(d, this.store.shell()) : {};
  });

  protected readonly preview = computed(() => {
    const shell = this.store.shell();
    const d = this.draft();
    if (!shell || !d) return null;
    return previewRoom(shell, d, this.store.placements(), (p) => this.store.placementDimensions(p) ?? undefined);
  });

  open(): void {
    const shell = this.store.shell();
    if (!shell) return;
    this.draft.set(draftFromShell(shell));
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected num(event: Event): number {
    const raw = (event.target as HTMLInputElement).value.replace(',', '.');
    return raw.trim() === '' ? Number.NaN : Number(raw);
  }

  protected setDim(key: 'widthM' | 'depthM' | 'heightM', event: Event): void {
    const value = this.num(event);
    this.draft.update((d) => (d ? withDimension(d, key, value, this.store.shell()) : d));
  }

  protected patchOpening(index: number, patch: Partial<OpeningDraft>): void {
    this.draft.update((d) => (d ? { ...d, openings: d.openings.map((o, i) => (i === index ? { ...o, ...patch } : o)) } : d));
  }

  protected addOpening(type: 'door' | 'window'): void {
    this.draft.update((d) => (d ? { ...d, openings: [...d.openings, newOpening(type, d.openings, wallLengthsFor(d, this.store.shell()))] } : d));
  }

  protected removeOpening(index: number): void {
    this.draft.update((d) => (d ? { ...d, openings: d.openings.filter((_, i) => i !== index) } : d));
  }

  async apply(): Promise<void> {
    const d = this.draft();
    if (!d || this.preview()?.error) return;
    this.saving.set(true);
    try {
      await this.store.updateRoom({ widthM: d.widthM, depthM: d.depthM, heightM: d.heightM, openings: openingsFromDraft(d) });
      this.toast.success('Medidas del cuarto actualizadas.');
      this.close();
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    } finally {
      this.saving.set(false);
    }
  }
}
