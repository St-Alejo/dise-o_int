import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  builtAreas,
  COMPLIANCE_PROFILES,
  DRAWING_SCALES,
  PAPER_SIZES,
  TechnicalSpecSchema,
  type ComplianceProfileId,
  type TechnicalSpec,
  type TitleBlock,
} from '@interiores/shared-types';
import { ToastService } from '../../core/ui/toast.service';
import { DesignProjectStore } from '../project/design-project.store';

const PROFILE_LABELS: Record<ComplianceProfileId, string> = {
  neufert: 'Buenas prácticas (Neufert)',
  colombia: 'Colombia (orientativo: NSR-10, NTC 6047, RETIE, RETILAP)',
};

const TITLE_FIELDS: { key: Exclude<keyof TitleBlock, 'date'>; label: string; max: number }[] = [
  { key: 'project', label: 'Proyecto', max: 80 },
  { key: 'client', label: 'Cliente', max: 80 },
  { key: 'address', label: 'Dirección', max: 120 },
  { key: 'professional', label: 'Profesional', max: 80 },
  { key: 'license', label: 'Matrícula', max: 40 },
  { key: 'revision', label: 'Revisión', max: 8 },
];

/**
 * Ficha técnica del proyecto: grosor de muros, cajetín de las láminas, papel y escala, y con qué
 * criterios se revisa. Cada campo se guarda al salir de él; si el valor no es válido se avisa y se
 * deja el anterior.
 */
@Component({
  selector: 'app-technical-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="form">
      <fieldset>
        <legend>Muros</legend>
        <label>
          <span>Muro (cm)</span>
          <input class="input" type="number" min="5" max="60" step="1" [value]="cm(spec().walls.exteriorM)" (change)="setWall('exteriorM', $any($event.target))" />
        </label>
        <label>
          <span>Tabique (cm)</span>
          <input class="input" type="number" min="5" max="60" step="1" [value]="cm(spec().walls.partitionM)" (change)="setWall('partitionM', $any($event.target))" />
        </label>
        <p class="muted fine">
          Área útil {{ areas().usefulM2.toFixed(2) }} m² · construida {{ areas().builtM2.toFixed(2) }} m². El grosor crece hacia fuera: el cuarto por dentro no cambia.
        </p>
      </fieldset>

      <fieldset>
        <legend>Cajetín</legend>
        @for (f of titleFields; track f.key) {
          <label>
            <span>{{ f.label }}</span>
            <input class="input" type="text" [attr.maxlength]="f.max" [value]="spec().titleBlock[f.key] ?? ''" (change)="setTitle(f.key, $any($event.target).value)" />
          </label>
        }
      </fieldset>

      <fieldset>
        <legend>Láminas</legend>
        <label>
          <span>Papel</span>
          <select class="input" [value]="spec().sheet.paper" (change)="setSheet('paper', $any($event.target).value)">
            @for (p of papers; track p) {
              <option [value]="p" [selected]="p === spec().sheet.paper">{{ p }}</option>
            }
          </select>
        </label>
        <label>
          <span>Escala</span>
          <select class="input" (change)="setSheet('scale', +$any($event.target).value)">
            @for (s of scales; track s) {
              <option [value]="s" [selected]="s === spec().sheet.scale">1:{{ s }}</option>
            }
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Revisión técnica</legend>
        <label class="wide">
          <span>Criterios</span>
          <select class="input" (change)="setCompliance({ profile: $any($event.target).value })">
            @for (p of profiles; track p) {
              <option [value]="p" [selected]="p === spec().compliance.profile">{{ profileLabel(p) }}</option>
            }
          </select>
        </label>
        <label class="check">
          <input type="checkbox" [checked]="spec().compliance.accessible" (change)="setCompliance({ accessible: $any($event.target).checked })" />
          <span>Debe ser accesible en silla de ruedas</span>
        </label>
      </fieldset>
    </div>
  `,
  styles: `
    .form {
      display: grid;
      gap: var(--space-3);
    }
    fieldset {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
      margin: 0;
      padding: var(--space-2) var(--space-3) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius, 10px);
    }
    legend {
      padding: 0 4px;
      font-weight: 600;
    }
    label {
      display: grid;
      gap: 4px;
      font-size: var(--text-sm);
    }
    label.wide,
    label.check,
    p {
      grid-column: 1 / -1;
    }
    label.check {
      grid-template-columns: auto 1fr;
      align-items: center;
    }
    .fine {
      margin: 0;
      font-size: var(--text-xs, 0.8rem);
    }
  `,
})
export class TechnicalFormComponent {
  private readonly store = inject(DesignProjectStore);
  private readonly toast = inject(ToastService);

  protected readonly spec = this.store.technical;
  protected readonly areas = computed(() => {
    const shell = this.store.shell();
    return shell ? builtAreas(shell, this.spec()) : { usefulM2: 0, builtM2: 0 };
  });
  protected readonly titleFields = TITLE_FIELDS;
  protected readonly papers = PAPER_SIZES;
  protected readonly scales = DRAWING_SCALES;
  protected readonly profiles = COMPLIANCE_PROFILES;

  protected cm(m: number): number {
    return Math.round(m * 100);
  }

  protected profileLabel(id: ComplianceProfileId): string {
    return PROFILE_LABELS[id];
  }

  protected setWall(key: 'exteriorM' | 'partitionM', field: HTMLInputElement): void {
    const cm = Number(field.value);
    if (!Number.isFinite(cm) || cm < 5 || cm > 60) {
      this.toast.error('El grosor va de 5 a 60 cm.');
      field.value = String(this.cm(this.spec().walls[key]));
      return;
    }
    void this.save({ ...this.spec(), walls: { ...this.spec().walls, [key]: cm / 100 } });
  }

  protected setTitle(key: keyof TitleBlock, raw: string): void {
    const value = raw.trim();
    const titleBlock: TitleBlock = { ...this.spec().titleBlock };
    if (value) titleBlock[key] = value;
    else if (key === 'revision') titleBlock.revision = 'A';
    else delete titleBlock[key];
    void this.save({ ...this.spec(), titleBlock });
  }

  protected setSheet(key: 'paper' | 'scale', value: string | number): void {
    void this.save({ ...this.spec(), sheet: { ...this.spec().sheet, [key]: value } });
  }

  protected setCompliance(patch: Partial<TechnicalSpec['compliance']>): void {
    void this.save({ ...this.spec(), compliance: { ...this.spec().compliance, ...patch } });
  }

  private async save(next: TechnicalSpec): Promise<void> {
    const parsed = TechnicalSpecSchema.safeParse(next);
    if (!parsed.success) {
      this.toast.error('Ese valor no es válido para la ficha técnica.');
      return;
    }
    try {
      await this.store.setTechnical(parsed.data);
    } catch {
      this.toast.error('No se pudo guardar la ficha técnica.');
    }
  }
}
