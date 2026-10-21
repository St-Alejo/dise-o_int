import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BATHROOM_PRESETS, type DesignBrief } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { DesignProjectStore } from '../project/design-project.store';
import { briefChips, emptyBrief, pinLighting, pinStyle, pinSurface, removeChip, subcategoryLabel, toggleLock, wish, type SurfaceKey } from './brief-model';
import { RecommendService } from './recommend.service';

/**
 * "Lo que pediste": el Brief como chips con candado. Lo fijado (🔒) se mantiene al pulsar
 * Recomendar; lo suelto es una preferencia. También se piden o vetan piezas ("quiero un tocador",
 * "sin alfombras") y el tipo de baño privado.
 */
@Component({
  selector: 'app-brief-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="stack">
      <p class="muted intro">Lo que fijes con el candado se mantiene cuando pulses <strong>Recomendar</strong>; lo demás cambia en cada propuesta.</p>
      <div class="row recommend">
        <button type="button" class="btn btn-primary grow" (click)="rec.recommend('total')" [disabled]="rec.working()"><app-icon name="wand" /> Recomendar</button>
        <button type="button" class="btn" (click)="rec.recommend('suave')" [disabled]="rec.working()">Solo colores y luz</button>
      </div>

      @if (chips().length) {
        <ul class="chips" aria-label="Lo que pediste">
          @for (c of chips(); track c.key) {
            <li class="chip" [class.locked]="c.locked">
              @for (s of c.swatches; track $index) {
                <span class="swatch" [style.background]="s" aria-hidden="true"></span>
              }
              <span class="grow"><strong>{{ c.label }}:</strong> {{ c.detail }}</span>
              @if (c.locked !== null) {
                <button type="button" class="icon-btn sm" [attr.aria-pressed]="c.locked" [attr.aria-label]="(c.locked ? 'Soltar ' : 'Fijar ') + c.label" (click)="save(toggle(c.key))">
                  <app-icon [name]="c.locked ? 'lock' : 'unlock'" />
                </button>
              }
              <button type="button" class="icon-btn sm" [attr.aria-label]="'Quitar ' + c.label" (click)="save(remove(c.key))"><app-icon name="close" /></button>
            </li>
          }
        </ul>
      } @else {
        <p class="empty muted">Aún no fijaste nada: cada propuesta será una sorpresa. Fija lo que ya te gusta con los botones de abajo, o pídeselo al asistente.</p>
      }

      <fieldset>
        <legend>Fijar lo que hay ahora</legend>
        <div class="row wrap">
          <button type="button" class="btn btn-sm" (click)="pin('floor')" [disabled]="!store.finishes()"><app-icon name="lock" /> Piso</button>
          <button type="button" class="btn btn-sm" (click)="pin('walls')" [disabled]="!store.finishes()"><app-icon name="lock" /> Paredes</button>
          @if (store.finishes()?.wallTiles) {
            <button type="button" class="btn btn-sm" (click)="pin('wallTiles')"><app-icon name="lock" /> Revestimiento</button>
          }
          <button type="button" class="btn btn-sm" (click)="pinCurrentStyle()" [disabled]="!styleId()"><app-icon name="lock" /> Estilo</button>
          <button type="button" class="btn btn-sm" (click)="pinCurrentLight()"><app-icon name="lock" /> Luz</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Piezas</legend>
        <div class="row wrap">
          <label class="sr-only" for="brief-sub">Pieza</label>
          <select id="brief-sub" class="grow" [value]="chosen()" (change)="sub.set($any($event.target).value)">
            @for (s of subcategories(); track s) {
              <option [value]="s">{{ label(s) }}</option>
            }
          </select>
          <button type="button" class="btn btn-sm" (click)="want('want')" [disabled]="!chosen()">Quiero</button>
          <button type="button" class="btn btn-sm" (click)="want('avoid')" [disabled]="!chosen()">Sin</button>
        </div>
      </fieldset>

      @if (hasBathroom()) {
        <fieldset>
          <legend>Baño privado</legend>
          <label class="sr-only" for="brief-bath">Tipo de baño</label>
          <select id="brief-bath" [value]="bathPreset()" (change)="setBath($any($event.target).value)">
            <option value="">Que lo elija la recomendación</option>
            @for (p of presets; track p.id) {
              <option [value]="p.id">{{ p.label }}</option>
            }
          </select>
        </fieldset>
      }
    </div>
  `,
  styles: `
    .intro {
      margin: 0;
      font-size: 0.85rem;
    }
    .recommend {
      gap: 8px;
    }
    .chips {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 0.85rem;
    }
    .chip.locked {
      border-color: var(--primary);
    }
    .swatch {
      width: 14px;
      height: 14px;
      border-radius: 4px;
      border: 1px solid var(--border);
      flex: none;
    }
    .icon-btn.sm {
      width: 28px;
      height: 28px;
    }
    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    legend {
      font-weight: 600;
      font-size: 0.85rem;
      margin-bottom: 4px;
    }
    .wrap {
      flex-wrap: wrap;
      gap: 6px;
    }
    .empty {
      font-size: 0.85rem;
      margin: 0;
    }
  `,
})
export class BriefPanelComponent {
  protected readonly store = inject(DesignProjectStore);
  protected readonly rec = inject(RecommendService);
  private readonly toast = inject(ToastService);

  protected readonly presets = BATHROOM_PRESETS;
  protected readonly chips = computed(() => briefChips(this.store.brief()));
  protected readonly styleId = computed(() => this.store.project()?.selectedStyleId ?? null);
  protected readonly label = subcategoryLabel;
  /** Las piezas que hay en el catálogo, por su nombre. */
  protected readonly subcategories = computed(() => {
    const subs = new Set<string>();
    for (const item of this.store.catalog().values()) if (item.subcategory) subs.add(item.subcategory);
    return [...subs].sort((a, b) => subcategoryLabel(a).localeCompare(subcategoryLabel(b), 'es'));
  });
  protected readonly sub = signal('');
  /** Lo elegido en el selector o, sin tocarlo, lo primero de la lista. */
  protected readonly chosen = computed(() => this.sub() || this.subcategories()[0] || '');
  protected readonly hasBathroom = computed(() => (this.store.shell()?.zones ?? []).some((z) => z.kind === 'bathroom'));
  protected readonly bathPreset = computed(() => this.store.brief()?.zones.find((z) => z.kind === 'bathroom')?.preset ?? '');

  protected toggle(key: string): DesignBrief {
    return toggleLock(this.store.brief() ?? emptyBrief(), key);
  }

  protected remove(key: string): DesignBrief {
    return removeChip(this.store.brief() ?? emptyBrief(), key);
  }

  protected pin(surface: SurfaceKey): void {
    void this.save(pinSurface(this.store.brief(), surface, this.store.finishes()));
  }

  protected pinCurrentStyle(): void {
    const id = this.styleId();
    if (id) void this.save(pinStyle(this.store.brief(), id));
  }

  protected pinCurrentLight(): void {
    void this.save(pinLighting(this.store.brief(), this.store.finishes()?.lighting ?? { mood: 'neutra', level: 'media' }));
  }

  protected want(kind: 'want' | 'avoid'): void {
    const sub = this.chosen();
    if (sub) void this.save(wish(this.store.brief(), sub, kind));
  }

  protected setBath(preset: string): void {
    const brief = structuredClone(this.store.brief() ?? emptyBrief());
    brief.zones = brief.zones.filter((z) => z.kind !== 'bathroom');
    if (preset) brief.zones.push({ kind: 'bathroom', preset });
    void this.save(brief);
  }

  protected async save(brief: DesignBrief): Promise<void> {
    try {
      await this.store.setBrief(brief);
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    }
  }
}
