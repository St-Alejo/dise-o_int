import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  DEFAULT_STYLES,
  ROOM_TYPES,
  ROOM_TYPE_LABELS,
  STYLES,
  type RoomType,
  type StyleId,
} from '@interiores/shared-types';
import type { Subscription } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';

const MAX_MB = 15;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/** Paso 1 del flujo: tips ANTES de subir (prevenir el mal input es más barato que corregirlo). */
@Component({
  selector: 'app-new-project',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <section class="container page">
      <h1>Nuevo proyecto</h1>

      <ol class="tips" aria-label="Consejos para una buena foto">
        <li><span aria-hidden="true">📐</span><div><strong>De frente</strong><p class="muted">Párate en una esquina o puerta y apunta hacia la pared opuesta.</p></div></li>
        <li><span aria-hidden="true">💡</span><div><strong>Buena luz</strong><p class="muted">La iluminación importa más que la cámara: abre cortinas, enciende luces.</p></div></li>
        <li><span aria-hidden="true">🖼️</span><div><strong>Cuarto completo</strong><p class="muted">Que se vean el piso, al menos dos paredes y las ventanas.</p></div></li>
      </ol>

      <div class="layout">
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
              <p class="big" aria-hidden="true">📷</p>
              <p><strong>Arrastra aquí la foto de tu cuarto</strong></p>
              <p class="muted">JPG, PNG o WebP, hasta {{ maxMb }} MB</p>
              <button type="button" class="btn btn-primary" (click)="fileInput.click()">Elegir foto</button>
            </div>
          }
          <input #fileInput type="file" [accept]="accepted" capture="environment" class="visually-hidden" (change)="onFile($event)" aria-label="Elegir foto del cuarto" />
        </div>

        <form class="card stack" (ngSubmit)="submit()">
          <div class="field">
            <label for="name">Nombre del proyecto</label>
            <input id="name" name="name" class="input" [(ngModel)]="name" maxlength="120" required />
          </div>
          <fieldset class="field">
            <legend class="label">¿Qué cuarto es?</legend>
            <div class="row">
              @for (r of roomTypes; track r) {
                <button type="button" class="chip" [attr.aria-pressed]="roomType() === r" (click)="roomType.set(r)">{{ roomLabels[r] }}</button>
              }
            </div>
          </fieldset>
          <fieldset class="field">
            <legend class="label">Estilos a generar <span class="muted">({{ styles().length }}/4)</span></legend>
            <div class="row">
              @for (s of allStyles; track s.id) {
                <button type="button" class="chip" [attr.aria-pressed]="styles().includes(s.id)" (click)="toggleStyle(s.id)"
                  [disabled]="!styles().includes(s.id) && styles().length >= 4">
                  <span class="dot" [style.background]="s.palette[1]" aria-hidden="true"></span>{{ s.label }}
                </button>
              }
            </div>
          </fieldset>

          @if (error()) {
            <p class="alert alert-danger" role="alert">{{ error() }}</p>
          }
          @if (uploading()) {
            <div class="progress" role="progressbar" aria-label="Subiendo foto" [attr.aria-valuenow]="uploadPct()" aria-valuemin="0" aria-valuemax="100">
              <div [style.width.%]="uploadPct()"></div>
            </div>
            <p class="muted" aria-live="polite">Subiendo foto… {{ uploadPct() }}%</p>
          }
          <button type="submit" class="btn btn-primary btn-lg" [disabled]="!canSubmit()">
            {{ uploading() ? 'Subiendo…' : 'Analizar mi cuarto' }}
          </button>
          <p class="muted small">Quitamos la ubicación GPS de la foto. Si no guardas el proyecto, se borra a las 24 h.</p>
        </form>
      </div>
    </section>
  `,
  styles: `
    .page {
      padding: 32px 0 64px;
    }
    .tips {
      list-style: none;
      padding: 0;
      margin: 0 0 24px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .tips li {
      display: flex;
      gap: 12px;
      padding: 14px;
      border-radius: var(--radius);
      background: var(--surface);
      border: 1px solid var(--border);
    }
    .tips span {
      font-size: 1.6rem;
    }
    .tips p {
      margin: 2px 0 0;
      font-size: 0.9rem;
    }
    .layout {
      display: grid;
      grid-template-columns: 1.3fr 1fr;
      gap: 24px;
      align-items: start;
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
      background: #000;
    }
    .change {
      position: absolute;
      top: 12px;
      right: 12px;
    }
    .drop-text {
      text-align: center;
      padding: 24px;
    }
    .big {
      font-size: 3rem;
      margin: 0;
    }
    fieldset {
      border: none;
      padding: 0;
      margin: 0;
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
    @media (max-width: 860px) {
      .layout,
      .tips {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class NewProjectPage implements OnDestroy {
  private readonly api = inject(ProjectsApi);
  private readonly router = inject(Router);

  protected readonly maxMb = MAX_MB;
  protected readonly accepted = ACCEPTED.join(',');
  protected readonly roomTypes = ROOM_TYPES;
  protected readonly roomLabels = ROOM_TYPE_LABELS;
  protected readonly allStyles = Object.values(STYLES);

  protected name = 'Mi cuarto';
  protected readonly roomType = signal<RoomType>('living');
  protected readonly styles = signal<StyleId[]>([...DEFAULT_STYLES]);
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly dragOver = signal(false);
  protected readonly uploading = signal(false);
  protected readonly uploadPct = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly canSubmit = computed(() => !!this.file() && this.styles().length > 0 && !this.uploading());
  private sub: Subscription | null = null;

  toggleStyle(id: StyleId): void {
    this.styles.update((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
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
    this.file.set(f);
    this.preview.set(URL.createObjectURL(f));
  }

  submit(): void {
    const f = this.file();
    if (!f || !this.canSubmit()) return;
    this.error.set(null);
    this.uploading.set(true);
    this.uploadPct.set(0);
    this.sub = this.api.create(f, this.name.trim() || 'Mi cuarto', this.roomType(), this.styles()).subscribe({
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
