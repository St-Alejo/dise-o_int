import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ROOM_TYPE_LABELS, type JobProgressEvent, type StyleId } from '@interiores/shared-types';
import type { Subscription } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { ProgressService } from '../../core/realtime/progress.service';
import { ToastService } from '../../core/ui/toast.service';
import { StyleGalleryComponent } from '../style-gallery/style-gallery.component';
import { EditorComponent } from '../viewport-3d/editor.component';
import { DesignProjectStore } from './design-project.store';
import { ProcessingPanelComponent } from './processing-panel.component';

type View = 'estilos' | '3d';

@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DesignProjectStore],
  imports: [RouterLink, DatePipe, ProcessingPanelComponent, StyleGalleryComponent, EditorComponent],
  template: `
    <section class="container page">
      @if (store.loadError(); as err) {
        <div class="card" role="alert">
          <h1>No pudimos abrir el proyecto</h1>
          <p class="muted">{{ err }}</p>
          <a routerLink="/proyectos" class="btn">Volver a mis proyectos</a>
        </div>
      } @else if (store.project(); as p) {
        <header class="head">
          <div class="title">
            <a routerLink="/proyectos" class="back" aria-label="Volver a mis proyectos">←</a>
            <div>
              <h1>{{ p.name }}</h1>
              <p class="muted meta">
                {{ roomLabels[p.roomType] }}
                @if (p.saved) {
                  · <span class="badge badge-success">Guardado</span>
                } @else {
                  · <span class="badge badge-warning" title="Guarda una versión o compártelo para conservarlo">Se borra en 24 h si no lo guardas</span>
                }
                @if (p.visibility === 'shared-link') {
                  · <span class="badge badge-primary">Compartido</span>
                }
              </p>
            </div>
          </div>
          @if (p.status === 'ready') {
            <div class="row">
              <button type="button" class="btn" (click)="saveVersion()" [disabled]="working()">💾 Guardar versión</button>
              <button type="button" class="btn" (click)="openVersions()">🕘 Versiones ({{ p.versions.length }})</button>
              <button type="button" class="btn" (click)="share()" [disabled]="working()">🔗 Compartir</button>
              <button type="button" class="btn" (click)="downloadPdf()" [disabled]="working()">🧾 Lista de compras</button>
            </div>
          }
        </header>

        @if (p.status === 'failed') {
          <div class="card" role="alert">
            <h2>No pudimos procesar la foto</h2>
            <p class="muted">{{ p.lastError ?? 'Ocurrió un error inesperado.' }}</p>
            <div class="row">
              <button type="button" class="btn btn-primary" (click)="retry()" [disabled]="working()">Reintentar</button>
              <a routerLink="/proyectos/nuevo" class="btn">Probar con otra foto</a>
            </div>
          </div>
        } @else if (p.status !== 'ready' || (job() && job()!.kind === 'analyze-room')) {
          <app-processing-panel [event]="job()" />
        } @else {
          <div class="tabs" role="tablist" aria-label="Vistas del proyecto">
            <button role="tab" type="button" class="tab" [attr.aria-selected]="view() === 'estilos'" (click)="setView('estilos')">🎨 Propuestas 2D</button>
            <button role="tab" type="button" class="tab" [attr.aria-selected]="view() === '3d'" (click)="setView('3d')">🧊 Editor 3D</button>
          </div>
          @if (job(); as j) {
            <div class="job card row" role="status" aria-live="polite">
              <div class="mini-bar"><div [style.width.%]="j.pct"></div></div>
              <span>{{ j.message }}</span>
            </div>
          }
          @if (view() === 'estilos') {
            <app-style-gallery [project]="p" [busy]="!!job()" (view3d)="goTo3d($event)" (jobStarted)="noop()" />
          } @else {
            <app-editor [busy]="!!job()" (autoLayout)="relayout()" />
          }
        }

        <dialog #versionsDialog class="modal" aria-labelledby="ver-title">
          <div class="modal-body stack">
            <h2 id="ver-title">Versiones guardadas</h2>
            <p class="muted">Cada versión es una copia fija: restaurar no borra las demás.</p>
            @for (v of p.versions; track v.id) {
              <div class="row version">
                <div class="grow">
                  <strong>Versión {{ v.number }}</strong> {{ v.note ? '— ' + v.note : '' }}
                  <div class="muted small">{{ v.createdAt | date: 'd MMM y, HH:mm' }} · {{ v.itemCount }} muebles</div>
                </div>
                <button type="button" class="btn btn-sm" (click)="restore(v.id)" [disabled]="working()">Restaurar</button>
              </div>
            } @empty {
              <p class="muted">Todavía no guardaste ninguna versión.</p>
            }
          </div>
          <div class="modal-actions"><button type="button" class="btn" (click)="versionsDialog.close()">Cerrar</button></div>
        </dialog>

        <dialog #shareDialog class="modal" aria-labelledby="share-title">
          <div class="modal-body stack">
            <h2 id="share-title">Compartir proyecto</h2>
            <p class="muted">Cualquiera con este enlace puede ver el diseño (solo lectura). Puedes revocarlo cuando quieras.</p>
            <div class="row">
              <input class="input grow" readonly [value]="shareUrl()" aria-label="Enlace para compartir" (focus)="$any($event.target).select()" />
              <button type="button" class="btn btn-primary" (click)="copyShare()">Copiar</button>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-danger" (click)="unshare()">Dejar de compartir</button>
            <button type="button" class="btn" (click)="shareDialog.close()">Cerrar</button>
          </div>
        </dialog>
      } @else {
        <div class="skeleton" style="height: 60vh; margin-top: 24px" aria-busy="true" aria-label="Cargando proyecto"></div>
      }
    </section>
  `,
  styles: `
    .page {
      padding: 24px 0 64px;
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .title {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .title h1 {
      margin: 0;
      font-size: 1.7rem;
    }
    .meta {
      margin: 4px 0 0;
      font-size: 0.9rem;
    }
    .back {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 1px solid var(--border);
      text-decoration: none;
      color: var(--text);
    }
    .tabs {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      border-radius: 999px;
      background: var(--surface-2);
      margin-bottom: 16px;
    }
    .tab {
      border: none;
      background: transparent;
      padding: 8px 18px;
      border-radius: 999px;
      font: inherit;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
    }
    .tab[aria-selected='true'] {
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow-sm);
    }
    .job {
      padding: 10px 16px;
      margin-bottom: 16px;
    }
    .mini-bar {
      width: 140px;
      height: 6px;
      border-radius: 99px;
      background: var(--surface-2);
      overflow: hidden;
    }
    .mini-bar div {
      height: 100%;
      background: var(--primary);
      transition: width 0.3s;
    }
    .version {
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }
    .grow {
      flex: 1;
    }
    .small {
      font-size: 0.82rem;
    }
  `,
})
export class ProjectPage implements OnInit {
  protected readonly store = inject(DesignProjectStore);
  private readonly api = inject(ProjectsApi);
  private readonly progress = inject(ProgressService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Parámetros de ruta enlazados (withComponentInputBinding). */
  readonly id = input.required<string>();
  readonly vista = input<View | undefined>();

  protected readonly roomLabels = ROOM_TYPE_LABELS;
  protected readonly job = signal<JobProgressEvent | null>(null);
  protected readonly working = signal(false);
  protected readonly shareUrl = signal('');
  private readonly localView = signal<View | null>(null);
  protected readonly view = computed<View>(() => this.localView() ?? this.vista() ?? 'estilos');

  private readonly versionsDialog = viewChild<ElementRef<HTMLDialogElement>>('versionsDialog');
  private readonly shareDialog = viewChild<ElementRef<HTMLDialogElement>>('shareDialog');
  private sub: Subscription | null = null;

  ngOnInit(): void {
    void this.store.load(this.id());
    this.sub = this.progress.watch(this.id()).subscribe((e) => this.onProgress(e));
    this.destroyRef.onDestroy(() => this.sub?.unsubscribe());
  }

  private lastHandled = '';
  private onProgress(e: JobProgressEvent): void {
    const finished = e.status !== 'active';
    // El historial puede repetir el fin de un job viejo: solo se reacciona una vez por job.
    const key = `${e.jobId}|${e.status}`;
    if (finished) {
      const alreadyHandled = this.lastHandled === key;
      this.lastHandled = key;
      if (this.job()?.jobId === e.jobId || !alreadyHandled) {
        this.job.set(null);
        void this.store.reload();
        if (e.status === 'failed' && !alreadyHandled) this.toast.error(e.error ?? e.message);
        if (e.status === 'completed' && e.kind === 'build-scene' && !alreadyHandled) this.toast.success('Muebles reacomodados');
      }
      return;
    }
    // Un evento "active" de un job ya terminado (llega tarde en el historial) se ignora.
    if (this.lastHandled.startsWith(`${e.jobId}|`)) return;
    this.job.set(e);
  }

  setView(v: View): void {
    this.localView.set(v);
    void this.router.navigate([], { queryParams: { vista: v }, replaceUrl: true });
  }

  async goTo3d(styleId: StyleId): Promise<void> {
    const project = this.store.project();
    if (!project) return;
    if (project.selectedStyleId !== styleId) {
      // Elegir otro estilo re-distribuye los muebles con piezas de ese estilo (respetando los fijados).
      try {
        await this.store.selectStyle(styleId);
        await this.api.autoLayout(project.id, { styleId, keepLocked: true });
      } catch (err) {
        this.toast.error(ApiError.from(err).userMessage);
      }
    }
    this.setView('3d');
  }

  async relayout(): Promise<void> {
    const project = this.store.project();
    if (!project) return;
    await this.store.flush();
    try {
      await this.api.autoLayout(project.id, { keepLocked: true });
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    }
  }

  async retry(): Promise<void> {
    await this.run(async (id) => {
      this.store.replaceFromServer(await this.api.retry(id));
    });
  }

  async saveVersion(): Promise<void> {
    await this.run(async (id) => {
      await this.store.flush();
      this.store.patchProject(await this.api.saveVersion(id));
      this.toast.success('Versión guardada. El proyecto ya no se borrará automáticamente.');
    });
  }

  openVersions(): void {
    this.versionsDialog()?.nativeElement.showModal();
  }

  async restore(versionId: string): Promise<void> {
    await this.run(async (id) => {
      this.store.saveState.set('saved');
      this.store.replaceFromServer(await this.api.restoreVersion(id, versionId, this.store.project()?.revision));
      this.versionsDialog()?.nativeElement.close();
      this.toast.success('Versión restaurada');
    });
  }

  async share(): Promise<void> {
    await this.run(async (id) => {
      const link = await this.api.share(id);
      this.shareUrl.set(new URL(link.path, location.origin).href);
      await this.store.reload();
      this.shareDialog()?.nativeElement.showModal();
    });
  }

  async copyShare(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.shareUrl());
      this.toast.success('Enlace copiado');
    } catch {
      this.toast.show('Selecciona el enlace y cópialo manualmente');
    }
  }

  async unshare(): Promise<void> {
    await this.run(async (id) => {
      await this.api.unshare(id);
      await this.store.reload();
      this.shareDialog()?.nativeElement.close();
      this.toast.success('El enlace dejó de funcionar');
    });
  }

  async downloadPdf(): Promise<void> {
    await this.run(async (id) => {
      await this.store.flush();
      const blob = await this.api.shoppingListPdf(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lista-de-compras-${this.store.project()?.name ?? 'proyecto'}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  noop(): void {}

  private async run(fn: (projectId: string) => Promise<void>): Promise<void> {
    const project = this.store.project();
    if (!project) return;
    this.working.set(true);
    try {
      await fn(project.id);
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    } finally {
      this.working.set(false);
    }
  }
}
