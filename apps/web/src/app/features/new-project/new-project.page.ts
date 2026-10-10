import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ROOM_SHAPE_IDS, ROOM_TEMPLATES, ROOM_TYPES, ROOM_TYPE_LABELS, STYLES, type RoomShapeId } from '@interiores/shared-types';
import type { Subscription } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { FloorPlanComponent } from '../floor-plan/floor-plan.component';
import { NewProjectWizard, type ShapeChoice, type WizardData } from './wizard.store';

const MAX_MB = 15;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/** Silueta de cada forma para su botón: la planta de la plantilla en un cuadro de 10 × 8. */
const SHAPE_ICONS: Record<RoomShapeId, string> = Object.fromEntries(
  ROOM_SHAPE_IDS.map((id) => {
    const template = ROOM_TEMPLATES[id];
    return [id, template.outline(10, 8, template.defaultNotch(10, 8)).map((p) => `${p.x},${p.z}`).join(' ')];
  }),
) as Record<RoomShapeId, string>;

type NumberField = 'widthM' | 'depthM' | 'heightM' | 'notchWidthM' | 'notchDepthM';

/**
 * Nuevo proyecto en tres pasos: de dónde sale el cuarto (foto o a mano), su forma y medidas con
 * el plano a la vista, y el tipo y estilo. Las reglas viven en `NewProjectWizard`.
 */
@Component({
  selector: 'app-new-project',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, FloorPlanComponent],
  template: `
    <section class="container page">
      <h1>Nuevo proyecto</h1>

      <ol class="steps" aria-label="Pasos">
        @for (s of wizard.steps; track s.id; let i = $index) {
          <li>
            <button type="button" class="step" [class.done]="i < wizard.index()" [attr.aria-current]="i === wizard.index() ? 'step' : null" (click)="wizard.goTo(i)">
              <span class="num" aria-hidden="true">{{ i + 1 }}</span>{{ s.title }}
            </button>
          </li>
        }
      </ol>

      @switch (wizard.step().id) {
        @case ('source') {
          <div class="source">
            <div
              class="dropzone"
              [class.over]="dragOver()"
              [class.has-file]="preview()"
              (dragover)="$event.preventDefault(); dragOver.set(true)"
              (dragleave)="dragOver.set(false)"
              (drop)="onDrop($event)"
            >
              @if (preview(); as src) {
                <img [src]="src" alt="Vista previa de la foto seleccionada" />
                <button type="button" class="btn btn-sm change" (click)="fileInput.click()">Cambiar foto</button>
              } @else {
                <div class="drop-text">
                  <h2>Con una foto</h2>
                  <p><strong>Arrastra aquí la foto de tu cuarto</strong></p>
                  <p class="muted">JPG, PNG o WebP, hasta {{ maxMb }} MB</p>
                  <button type="button" class="btn btn-primary" (click)="fileInput.click()">Elegir foto</button>
                </div>
              }
              <input #fileInput type="file" [accept]="accepted" capture="environment" class="visually-hidden" (change)="onFile($event)" aria-label="Elegir foto del cuarto" />
            </div>

            <div class="side stack">
              <ul class="tips" aria-label="Consejos para una buena foto">
                <li><strong>De frente.</strong> Párate en una esquina o puerta y apunta hacia la pared opuesta.</li>
                <li><strong>Buena luz.</strong> Abre cortinas y enciende luces: importa más que la cámara.</li>
                <li><strong>Cuarto completo.</strong> Que se vean el piso, al menos dos paredes y las ventanas.</li>
              </ul>
              <div class="card stack manual">
                <h2>Sin foto</h2>
                <p class="muted">Elige la forma del cuarto, escribe sus medidas y lo amueblamos en 3D.</p>
                <button type="button" class="btn" (click)="startManual()">Empezar sin foto</button>
              </div>
            </div>
          </div>
        }

        @case ('room') {
          <div class="room">
            <div class="card stack">
              <fieldset class="field">
                <legend class="label">Forma del cuarto</legend>
                <div class="shapes">
                  @if (d().source === 'photo') {
                    <button type="button" class="shape" [attr.aria-pressed]="d().shape === 'auto'" (click)="wizard.chooseShape('auto')">
                      <span class="shape-auto" aria-hidden="true">Foto</span>
                      Según la foto
                    </button>
                  }
                  @for (shape of shapes; track shape.id) {
                    <button type="button" class="shape" [attr.aria-pressed]="d().shape === shape.id" [title]="shape.description" (click)="wizard.chooseShape(shape.id)">
                      <svg viewBox="-1 -1 12 10" aria-hidden="true"><polygon [attr.points]="shape.icon" /></svg>
                      {{ shape.label }}
                    </button>
                  }
                </div>
              </fieldset>

              <fieldset class="field">
                <legend class="label">
                  Medidas
                  @if (d().shape === 'auto') {
                    <span class="muted">(opcionales: si las escribes, mandan sobre la foto)</span>
                  }
                </legend>
                <div class="dims-grid">
                  <div class="field">
                    <label for="dim-w">Ancho (m)</label>
                    <input id="dim-w" name="dimW" class="input" type="number" inputmode="decimal" min="0.8" max="30" step="0.01" [ngModel]="d().widthM" (ngModelChange)="setNumber('widthM', $event)" placeholder="4.20" />
                  </div>
                  <div class="field">
                    <label for="dim-d">Largo (m)</label>
                    <input id="dim-d" name="dimD" class="input" type="number" inputmode="decimal" min="0.8" max="30" step="0.01" [ngModel]="d().depthM" (ngModelChange)="setNumber('depthM', $event)" placeholder="3.50" />
                  </div>
                  <div class="field">
                    <label for="dim-h">Alto (m)</label>
                    <input id="dim-h" name="dimH" class="input" type="number" inputmode="decimal" min="2" max="6" step="0.01" [ngModel]="d().heightM" (ngModelChange)="setNumber('heightM', $event)" placeholder="2.50" />
                  </div>
                </div>
              </fieldset>

              @if (hasNotch()) {
                <fieldset class="field">
                  <legend class="label">Muesca <span class="muted">(la parte que le falta al rectángulo)</span></legend>
                  <div class="dims-grid two">
                    <div class="field">
                      <label for="notch-w">Ancho de la muesca (m)</label>
                      <input id="notch-w" name="notchW" class="input" type="number" inputmode="decimal" min="0.4" step="0.05" [ngModel]="d().notchWidthM" (ngModelChange)="setNumber('notchWidthM', $event)" />
                    </div>
                    <div class="field">
                      <label for="notch-d">Largo de la muesca (m)</label>
                      <input id="notch-d" name="notchD" class="input" type="number" inputmode="decimal" min="0.4" step="0.05" [ngModel]="d().notchDepthM" (ngModelChange)="setNumber('notchDepthM', $event)" />
                    </div>
                  </div>
                </fieldset>
              }
            </div>

            <div class="card preview-card">
              @if (wizard.room().shell; as shell) {
                <app-floor-plan class="plan" [shell]="shell" />
                <p class="muted small">Nace con una ventana al fondo y una puerta al frente; en el editor puedes moverlas o añadir más.</p>
              } @else if (d().shape === 'auto' && preview()) {
                <img class="photo" [src]="preview()" alt="Foto del cuarto" />
                <p class="muted small">Estimaremos la forma y las medidas a partir de la foto. Podrás corregirlas en el editor.</p>
              } @else {
                <p class="muted empty">Escribe las medidas para ver el plano.</p>
              }
            </div>
          </div>
        }

        @case ('style') {
          <form class="card stack style" (ngSubmit)="submit()">
            <div class="field">
              <label for="name">Nombre del proyecto</label>
              <input id="name" name="name" class="input" [ngModel]="d().name" (ngModelChange)="wizard.patch({ name: $event })" maxlength="120" required />
            </div>
            <fieldset class="field">
              <legend class="label">¿Qué cuarto es?</legend>
              <div class="row">
                @for (r of roomTypes; track r) {
                  <button type="button" class="chip" [attr.aria-pressed]="d().roomType === r" (click)="wizard.patch({ roomType: r })">{{ roomLabels[r] }}</button>
                }
              </div>
            </fieldset>
            <fieldset class="field">
              <legend class="label">{{ d().photo ? 'Estilos a generar' : 'Estilo de los muebles' }} <span class="muted">({{ d().styles.length }}/4)</span></legend>
              <div class="row">
                @for (s of allStyles; track s.id) {
                  <button type="button" class="chip" [attr.aria-pressed]="d().styles.includes(s.id)" (click)="wizard.toggleStyle(s.id)" [disabled]="!d().styles.includes(s.id) && d().styles.length >= 4">
                    <span class="dot" [style.background]="s.palette[1]" aria-hidden="true"></span>{{ s.label }}
                  </button>
                }
              </div>
            </fieldset>

            @if (uploading()) {
              <div class="progress" role="progressbar" aria-label="Creando el proyecto" [attr.aria-valuenow]="uploadPct()" aria-valuemin="0" aria-valuemax="100">
                <div [style.width.%]="uploadPct()"></div>
              </div>
              <p class="muted" aria-live="polite">{{ d().photo ? 'Subiendo foto… ' + uploadPct() + '%' : 'Creando tu cuarto…' }}</p>
            }
            <button type="submit" class="btn btn-primary btn-lg" [disabled]="!wizard.ready() || uploading()">
              {{ uploading() ? 'Un momento…' : d().photo ? 'Analizar mi cuarto' : 'Crear mi cuarto' }}
            </button>
            @if (d().photo) {
              <p class="muted small">Quitamos la ubicación GPS de la foto. Si no guardas el proyecto, se borra a las 24 h.</p>
            } @else {
              <p class="muted small">Si no guardas el proyecto, se borra a las 24 h.</p>
            }
          </form>
        }
      }

      @if (message(); as msg) {
        <p class="alert alert-danger" role="alert">{{ msg }}</p>
      }

      <div class="nav">
        @if (wizard.index() > 0) {
          <button type="button" class="btn" (click)="wizard.back()" [disabled]="uploading()">Atrás</button>
        }
        <span class="spacer"></span>
        @if (!wizard.isLast()) {
          <button type="button" class="btn btn-primary" (click)="next()" [disabled]="wizard.step().id === 'source' && wizard.problem() !== null">Siguiente</button>
        }
      </div>
    </section>
  `,
  styles: `
    .page {
      padding: 32px 0 64px;
    }
    h2 {
      margin: 0;
      font-size: 1.15rem;
    }
    .steps {
      list-style: none;
      display: flex;
      gap: var(--space-2);
      padding: 0;
      margin: 0 0 var(--space-5);
      flex-wrap: wrap;
    }
    .step {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: 6px 14px 6px 6px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      font: inherit;
      cursor: pointer;
    }
    .step[aria-current='step'] {
      border-color: var(--primary);
      color: var(--text);
      font-weight: 600;
    }
    .num {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--surface-2);
      font-size: 0.85rem;
    }
    .step[aria-current='step'] .num,
    .step.done .num {
      background: var(--primary);
      color: var(--on-primary);
    }
    .source,
    .room {
      display: grid;
      grid-template-columns: 1.3fr 1fr;
      gap: var(--space-5);
      align-items: start;
    }
    .room {
      grid-template-columns: 1fr 1.1fr;
    }
    .dropzone {
      position: relative;
      min-height: 380px;
      border: 2px dashed var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
      display: grid;
      place-items: center;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .dropzone.over {
      border-color: var(--primary);
      background: var(--primary-soft);
    }
    .dropzone.has-file {
      border-style: solid;
    }
    .dropzone img {
      width: 100%;
      height: 100%;
      max-height: 520px;
      object-fit: contain;
      background: var(--surface-2);
    }
    .change {
      position: absolute;
      top: 12px;
      right: 12px;
    }
    .drop-text {
      text-align: center;
      padding: var(--space-5);
      display: grid;
      gap: var(--space-2);
      justify-items: center;
    }
    .drop-text p {
      margin: 0;
    }
    .tips strong {
      font-weight: 600;
    }
    .tips {
      margin: 0;
      padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
      border-radius: var(--radius);
      background: var(--surface);
      border: 1px solid var(--border);
      display: grid;
      gap: var(--space-2);
      font-size: 0.92rem;
    }
    .manual p {
      margin: 0;
    }
    fieldset {
      border: none;
      padding: 0;
      margin: 0;
    }
    .shapes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
      gap: var(--space-2);
    }
    .shape {
      display: grid;
      justify-items: center;
      gap: 6px;
      padding: var(--space-3) var(--space-2);
      border-radius: var(--radius);
      border: 2px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 0.88rem;
      cursor: pointer;
    }
    .shape[aria-pressed='true'] {
      border-color: var(--primary);
      background: var(--primary-soft);
    }
    .shape svg {
      width: 56px;
      height: 46px;
    }
    .shape polygon {
      fill: var(--surface-2);
      stroke: var(--text);
      stroke-width: 0.7;
      stroke-linejoin: round;
    }
    .shape-auto {
      display: grid;
      place-items: center;
      width: 56px;
      height: 46px;
      border-radius: var(--radius-sm);
      border: 1.5px dashed var(--text-muted);
      color: var(--text-muted);
      font-size: 0.8rem;
    }
    .dims-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-2);
    }
    .dims-grid.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .preview-card {
      display: grid;
      gap: var(--space-2);
      min-height: 380px;
      align-content: center;
    }
    .plan {
      width: 100%;
      aspect-ratio: 4 / 3;
      max-height: 460px;
    }
    .photo {
      width: 100%;
      max-height: 420px;
      object-fit: contain;
      border-radius: var(--radius-sm);
    }
    .empty {
      text-align: center;
    }
    .style {
      max-width: 640px;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .progress {
      height: 8px;
      border-radius: 99px;
      background: var(--surface-2);
      overflow: hidden;
    }
    .progress div {
      height: 100%;
      background: var(--primary);
      transition: width 0.2s;
    }
    .small {
      font-size: 0.82rem;
      margin: 0;
    }
    .alert {
      margin-top: var(--space-4);
    }
    .nav {
      display: flex;
      gap: var(--space-2);
      margin-top: var(--space-5);
    }
    .spacer {
      flex: 1;
    }
    @media (max-width: 860px) {
      .source,
      .room {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class NewProjectPage implements OnDestroy {
  private readonly api = inject(ProjectsApi);
  private readonly router = inject(Router);

  protected readonly wizard = new NewProjectWizard();
  protected readonly d = this.wizard.data;

  protected readonly maxMb = MAX_MB;
  protected readonly accepted = ACCEPTED.join(',');
  protected readonly roomTypes = ROOM_TYPES;
  protected readonly roomLabels = ROOM_TYPE_LABELS;
  protected readonly allStyles = Object.values(STYLES);
  protected readonly shapes = ROOM_SHAPE_IDS.map((id) => ({ id, label: ROOM_TEMPLATES[id].label, description: ROOM_TEMPLATES[id].description, icon: SHAPE_ICONS[id] }));

  protected readonly preview = signal<string | null>(null);
  protected readonly dragOver = signal(false);
  protected readonly uploading = signal(false);
  protected readonly uploadPct = signal(0);
  private readonly error = signal<string | null>(null);
  /** Se intentó avanzar con el paso incompleto: desde entonces se muestra qué falta. */
  private readonly nagging = signal(false);

  protected readonly hasNotch = computed(() => {
    const shape: ShapeChoice = this.d().shape;
    return shape !== 'auto' && ROOM_TEMPLATES[shape].hasNotch;
  });
  /** Un error del servidor o de la foto; si no, lo que le falta al paso (solo tras intentar avanzar). */
  protected readonly message = computed(() => this.error() ?? (this.nagging() ? this.wizard.problem() : null));
  private sub: Subscription | null = null;

  protected setNumber(key: NumberField, value: unknown): void {
    const n = value === null || value === '' ? null : Number(value);
    this.wizard.patch({ [key]: n !== null && Number.isFinite(n) ? n : null } as Partial<WizardData>);
  }

  protected next(): void {
    this.error.set(null);
    this.nagging.set(!this.wizard.next());
  }

  protected startManual(): void {
    this.revokePreview();
    this.preview.set(null);
    this.wizard.chooseSource('manual');
    this.next();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const f = event.dataTransfer?.files?.[0];
    if (f) this.setFile(f);
  }

  onFile(event: Event): void {
    const f = (event.target as HTMLInputElement).files?.[0];
    if (f) this.setFile(f);
  }

  private setFile(f: File): void {
    this.error.set(null);
    if (!ACCEPTED.includes(f.type)) {
      this.error.set('Formato no soportado: usa una foto JPG, PNG o WebP.');
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      this.error.set(`La foto pesa ${(f.size / 1024 / 1024).toFixed(1)} MB; el máximo es ${MAX_MB} MB.`);
      return;
    }
    this.revokePreview();
    this.preview.set(URL.createObjectURL(f));
    this.wizard.chooseSource('photo', f);
  }

  submit(): void {
    const request = this.wizard.request();
    if (!request || this.uploading()) {
      this.nagging.set(true);
      return;
    }
    this.error.set(null);
    this.uploading.set(true);
    this.uploadPct.set(0);
    this.sub = this.api.create(request).subscribe({
      next: (e) => {
        if (e.kind === 'progress') this.uploadPct.set(e.pct);
        else void this.router.navigate(['/proyectos', e.project.id]);
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        this.error.set(ApiError.from(err).userMessage);
      },
    });
  }

  private revokePreview(): void {
    const p = this.preview();
    if (p) URL.revokeObjectURL(p);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.revokePreview();
  }
}
