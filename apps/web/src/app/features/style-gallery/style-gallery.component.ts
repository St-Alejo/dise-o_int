import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { STYLES, type DesignProject, type StyleId, type StylePreview } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { ToastService } from '../../core/ui/toast.service';
import { CompareSliderComponent } from './compare-slider.component';

/**
 * Paso 3 del flujo (Track A): varias propuestas a la vez (la primera casi nunca es la mejor),
 * comparador antes/después y control de "intensidad del cambio".
 */
@Component({
  selector: 'app-style-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CompareSliderComponent, DecimalPipe],
  template: `
    @if (project(); as p) {
      <div class="layout">
        <div class="viewer">
          @if (active(); as a) {
            @if (a.imageUrl && p.sourcePhotoUrl) {
              <app-compare-slider [before]="p.sourcePhotoUrl" [after]="a.imageUrl" [afterLabel]="styles[a.styleName].label" />
            }
            <div class="row actions">
              <div>
                <h2>{{ styles[a.styleName].label }}</h2>
                <p class="muted">{{ styles[a.styleName].description }} · intensidad {{ a.promptStrength | number: '1.0-2' }}</p>
              </div>
              <span class="spacer"></span>
              <button class="btn btn-primary btn-lg" type="button" (click)="view3d.emit(a.styleName)" [disabled]="busy()">
                Ver en 3D con este estilo →
              </button>
            </div>
            @if (a.provider?.startsWith('mock')) {
              <p class="muted small">
                Vista previa simulada (sin GPU): cambia la atmósfera y la paleta del cuarto. Con un proveedor de difusión
                configurado (Replicate) aquí verías muebles y decoración nuevos.
              </p>
            }
          } @else if (p.sourcePhotoUrl) {
            <img class="source" [src]="p.sourcePhotoUrl" alt="Foto original del cuarto" />
          }
        </div>

        <aside class="side">
          <h3>Propuestas</h3>
          <ul class="thumbs" role="list">
            @for (pr of p.stylePreviews; track pr.id) {
              <li>
                <button
                  type="button"
                  class="thumb"
                  [class.selected]="pr.id === activeId()"
                  [disabled]="pr.status !== 'ready'"
                  (click)="activeId.set(pr.id)"
                  [attr.aria-pressed]="pr.id === activeId()"
                >
                  @if (pr.status === 'ready' && pr.imageUrl) {
                    <img [src]="pr.imageUrl" alt="" loading="lazy" />
                  } @else if (pr.status === 'pending') {
                    <div class="skeleton ph"></div>
                  } @else {
                    <div class="ph failed">No se pudo generar</div>
                  }
                  <span class="label">
                    {{ styles[pr.styleName].label }}
                    @if (p.selectedStyleId === pr.styleName) {
                      <span class="badge badge-primary">Elegido</span>
                    }
                  </span>
                </button>
              </li>
            }
          </ul>

          <div class="card more">
            <h3>Generar más propuestas</h3>
            <div class="field">
              <label for="strength">Intensidad del cambio: {{ strengthLabel() }}</label>
              <input id="strength" type="range" min="0.2" max="0.95" step="0.05" [value]="strength()" (input)="strength.set(+$any($event.target).value)" />
              <div class="row muted small"><span>Conservador</span><span class="spacer"></span><span>Radical</span></div>
            </div>
            <div class="row">
              @for (s of allStyles; track s.id) {
                <button type="button" class="chip" [attr.aria-pressed]="picked().includes(s.id)" (click)="toggle(s.id)"
                  [disabled]="!picked().includes(s.id) && picked().length >= 4">{{ s.label }}</button>
              }
            </div>
            <button type="button" class="btn btn-primary" [disabled]="picked().length === 0 || busy() || generating()" (click)="generate()">
              {{ generating() ? 'Enviando…' : 'Generar ' + picked().length + ' propuesta(s)' }}
            </button>
          </div>
        </aside>
      </div>
    }
  `,
  styles: `
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
      gap: 24px;
    }
    .actions {
      margin-top: 16px;
    }
    .actions h2 {
      margin: 0;
    }
    .source {
      border-radius: var(--radius);
      width: 100%;
    }
    .small {
      font-size: 0.85rem;
    }
    .thumbs {
      list-style: none;
      padding: 0;
      margin: 0 0 16px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .thumb {
      width: 100%;
      padding: 0;
      border: 2px solid transparent;
      border-radius: 12px;
      overflow: hidden;
      background: var(--surface);
      cursor: pointer;
      text-align: left;
      color: var(--text);
    }
    .thumb.selected {
      border-color: var(--primary);
    }
    .thumb:disabled {
      cursor: default;
    }
    .thumb img,
    .ph {
      aspect-ratio: 4 / 3;
      width: 100%;
      object-fit: cover;
      display: grid;
      place-items: center;
    }
    .failed {
      background: var(--danger-soft);
      color: var(--danger);
      font-size: 0.8rem;
    }
    .label {
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 6px 8px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .more {
      display: grid;
      gap: 12px;
    }
    .more h3 {
      margin: 0;
    }
    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class StyleGalleryComponent {
  private readonly api = inject(ProjectsApi);
  private readonly toast = inject(ToastService);

  readonly project = input.required<DesignProject>();
  readonly busy = input(false);
  readonly view3d = output<StyleId>();
  readonly jobStarted = output<void>();

  protected readonly styles = STYLES;
  protected readonly allStyles = Object.values(STYLES);
  protected readonly activeId = signal<string | null>(null);
  protected readonly strength = signal(0.6);
  protected readonly picked = signal<StyleId[]>([]);
  protected readonly generating = signal(false);

  protected readonly ready = computed(() => this.project().stylePreviews.filter((p) => p.status === 'ready'));
  protected readonly active = computed<StylePreview | null>(() => {
    const list = this.ready();
    const selected = this.project().selectedStyleId;
    return (
      list.find((p) => p.id === this.activeId()) ?? list.find((p) => p.styleName === selected) ?? list[0] ?? null
    );
  });
  protected readonly strengthLabel = computed(() => {
    const s = this.strength();
    return s < 0.45 ? 'conservador' : s < 0.75 ? 'equilibrado' : 'radical';
  });

  toggle(id: StyleId): void {
    this.picked.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  async generate(): Promise<void> {
    this.generating.set(true);
    try {
      const res = await this.api.generateStyles(this.project().id, { styles: this.picked(), promptStrength: this.strength() });
      if (res.jobId === 'cached') this.toast.success('Ya tenías esas propuestas: se reutilizaron sin costo.');
      this.picked.set([]);
      this.jobStarted.emit();
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    } finally {
      this.generating.set(false);
    }
  }
}
