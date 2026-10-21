import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ROOM_TYPE_LABELS, type DesignProjectVersion, type JobProgressEvent, type StyleId } from '@interiores/shared-types';
import type { Subscription } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { ProgressService } from '../../core/realtime/progress.service';
import { downloadBlob, fileSlug } from '../../core/ui/download';
import { ToastService } from '../../core/ui/toast.service';
import { DialogComponent } from '../../shared/ui/dialog.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { StyleGalleryComponent } from '../style-gallery/style-gallery.component';
import { EditorComponent } from '../viewport-3d/editor.component';
import { RecommendService } from '../brief/recommend.service';
import { DesignProjectStore } from './design-project.store';
import { ProcessingPanelComponent } from './processing-panel.component';
import { ProjectFactsComponent } from './project-facts.component';
import { VersionCompareComponent } from './version-compare.component';
import { TooltipDirective } from '../../shared/ui/tooltip.directive';

type View = 'estilos' | '3d';

@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DesignProjectStore, RecommendService],
  imports: [RouterLink, DatePipe, ProcessingPanelComponent, ProjectFactsComponent, VersionCompareComponent, StyleGalleryComponent, EditorComponent, IconComponent, DialogComponent, TooltipDirective],
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
            <a routerLink="/proyectos" class="back" aria-label="Volver a mis proyectos"><app-icon name="back" /></a>
            <div>
              <h1>{{ p.name }}</h1>
              <p class="muted meta">
                {{ roomLabels[p.roomType] }}
                @if (p.saved) {
                  · <span class="badge badge-success">Guardado</span>
                } @else {
                  · <span class="badge badge-warning" appTooltip="Guarda una versión o compártelo para conservarlo">Se borra en 24 h si no lo guardas</span>
                }
                @if (p.visibility === 'shared-link') {
                  · <span class="badge badge-primary">Compartido</span>
                }
              </p>
            </div>
          </div>
          @if (p.status === 'ready') {
            <div class="row">
              <button type="button" class="btn" (click)="saveVersion()" [disabled]="working()"><app-icon name="save" /> Guardar versión</button>
              <button type="button" class="btn" (click)="openVersions()"><app-icon name="history" /> Versiones ({{ p.versions.length }})</button>
              <button type="button" class="btn" (click)="share()" [disabled]="working()"><app-icon name="share" /> Compartir</button>
              <button type="button" class="btn" (click)="downloadPdf()" [disabled]="working()"><app-icon name="receipt" /> Lista de compras</button>
              <button type="button" class="btn" (click)="downloadDossier()" [disabled]="working()" appTooltip="Ficha del cuarto, plano acotado con los muebles y lista de compras"><app-icon name="download" /> Proyecto en PDF</button>
            </div>
          }
        </header>

        @if (p.home; as home) {
          <nav class="home row" [attr.aria-label]="'Cuartos de la vivienda ' + home.name">
            <span class="home-name"><app-icon name="layers" /> {{ home.name }}</span>
            @for (room of home.rooms; track room.id) {
              <!-- Enlace normal: cada cuarto se abre con su propio editor, desde cero. -->
              <a class="chip" [href]="'/proyectos/' + room.id + '?vista=3d'" [attr.aria-current]="room.id === p.id ? 'page' : null">{{ room.name }}</a>
            }
            <a class="chip add" routerLink="/proyectos/nuevo" [queryParams]="{ vivienda: home.id }"><app-icon name="plus" /> Añadir cuarto</a>
            <a class="chip add" [routerLink]="['/viviendas', home.id]"><app-icon name="plan" /> Planta de la vivienda</a>
          </nav>
        } @else if (p.status === 'ready') {
          <p class="home-start">
            <button type="button" class="btn btn-sm btn-ghost" (click)="startHome()" [disabled]="working()" appTooltip="Crea una vivienda con este cuarto para ir sumando los demás: se ven juntos y con sus totales">
              <app-icon name="plus" /> Añadir otro cuarto a esta vivienda
            </button>
          </p>
        }

        @if (p.status === 'ready') {
          <app-project-facts class="facts" />
        }

        @if (p.status === 'failed') {
          <div class="card" role="alert">
            <h2>{{ p.sourcePhotoUrl ? 'No pudimos procesar la foto' : 'No pudimos amueblar tu cuarto' }}</h2>
            <p class="muted">{{ p.lastError ?? 'Ocurrió un error inesperado.' }}</p>
            <div class="row">
              <button type="button" class="btn btn-primary" (click)="retry()" [disabled]="working()">Reintentar</button>
              <a routerLink="/proyectos/nuevo" class="btn">{{ p.sourcePhotoUrl ? 'Probar con otra foto' : 'Empezar de nuevo' }}</a>
            </div>
          </div>
        } @else if (p.status !== 'ready' || (job() && job()!.kind === 'analyze-room')) {
          <app-processing-panel [event]="job()" [furnishingOnly]="!p.sourcePhotoUrl" />
        } @else {
          <!-- Las propuestas 2D se generan sobre la foto: un cuarto creado sin foto va directo al 3D. -->
          @if (p.sourcePhotoUrl) {
            <div class="tabs" role="tablist" aria-label="Vistas del proyecto">
              <button role="tab" type="button" class="tab" [attr.aria-selected]="view() === 'estilos'" (click)="setView('estilos')"><app-icon name="palette" /> Propuestas 2D</button>
              <button role="tab" type="button" class="tab" [attr.aria-selected]="view() === '3d'" (click)="setView('3d')"><app-icon name="cube" /> Editor 3D</button>
            </div>
          }
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

        <app-dialog #versionsDialog heading="Versiones guardadas">
          <div class="modal-body stack">
            <p class="muted">Cada versión es una copia fija: restaurar no borra las demás.</p>
            @for (v of p.versions; track v.id) {
              <div class="row version">
                <div class="grow">
                  <strong>Versión {{ v.number }}</strong> {{ v.note ? '— ' + v.note : '' }}
                  <div class="muted small">{{ v.createdAt | date: 'd MMM y, HH:mm' }} · {{ v.itemCount }} muebles</div>
                </div>
                <button type="button" class="btn btn-sm" (click)="compare(v.id)" [disabled]="working()" [attr.aria-expanded]="compared()?.id === v.id">
                  {{ compared()?.id === v.id ? 'Ocultar' : 'Comparar' }}
                </button>
                <button type="button" class="btn btn-sm" (click)="restore(v.id)" [disabled]="working()">Restaurar</button>
              </div>
              @if (compared(); as shown) {
                @if (shown.id === v.id) {
                  <app-version-compare class="compare" [version]="shown" />
                }
              }
            } @empty {
              <p class="muted">Todavía no guardaste ninguna versión.</p>
            }
          </div>
        </app-dialog>

        <app-dialog #shareDialog heading="Compartir proyecto">
          <div class="modal-body stack">
            <p class="muted">Cualquiera con este enlace puede ver el diseño (solo lectura). Puedes revocarlo cuando quieras.</p>
            <div class="row">
              <input class="input grow" readonly [value]="shareUrl()" aria-label="Enlace para compartir" (focus)="$any($event.target).select()" />
              <button type="button" class="btn btn-primary" (click)="copyShare()">Copiar</button>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-danger" (click)="unshare()">Dejar de compartir</button>
          </div>
        </app-dialog>
      } @else {
        <div class="skeleton" style="height: 60vh; margin-top: 24px" aria-busy="true" aria-label="Cargando proyecto"></div>
      }
    </section>
  `,
  styles: `
    .page {
      padding: 24px 0 64px;
    }
    .compare {
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .home {
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--rule);
    }
    .home-name {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-right: var(--space-2);
      font-family: var(--font-display);
      font-size: var(--text-lg);
    }
    .home .chip {
      text-decoration: none;
    }
    .home .chip[aria-current='page'] {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--on-primary);
    }
    .home .add {
      color: var(--primary);
    }
    .home-start {
      margin: -4px 0 12px;
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
    .facts {
      display: block;
      margin-bottom: 16px;
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
  private readonly recommender = inject(RecommendService);
  /** Versión que se está comparando con el diseño actual. */
  protected readonly compared = signal<DesignProjectVersion | null>(null);
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
  protected readonly view = computed<View>(() => {
    const project = this.store.project();
    if (project && !project.sourcePhotoUrl) return '3d';
    return this.localView() ?? this.vista() ?? 'estilos';
  });

  private readonly versionsDialog = viewChild<DialogComponent>('versionsDialog');
  private readonly shareDialog = viewChild<DialogComponent>('shareDialog');
  private sub: Subscription | null = null;

  ngOnInit(): void {
    void this.store.load(this.id());
    this.sub = this.progress.watch(this.id()).subscribe((e) => this.onProgress(e));
    this.destroyRef.onDestroy(() => this.sub?.unsubscribe());
  }

  /** Hora del último fin visto de cada job (los de un mismo proyecto comparten id entre ejecuciones). */
  private readonly finishedAt = new Map<string, string>();

  private onProgress(e: JobProgressEvent): void {
    // El historial repite eventos viejos: lo que no es posterior al último fin visto ya se atendió.
    const lastEnd = this.finishedAt.get(e.jobId);
    if (lastEnd !== undefined && e.at <= lastEnd) return;
    if (e.status === 'active') {
      this.job.set(e);
      return;
    }
    // Solo es "en vivo" si se vio trabajar al job en esta visita (no un fin repetido del historial).
    const live = this.job()?.jobId === e.jobId;
    this.finishedAt.set(e.jobId, e.at);
    this.job.set(null);
    const relayout = live && e.status === 'completed' && e.kind === 'build-scene';
    // La distribución de una recomendación va al historial con ella (un solo Ctrl+Z la deshace).
    const recommended = e.kind === 'build-scene' ? this.recommender.claimJob(e.jobId) : undefined;
    // Una distribución nueva se puede deshacer; el resto de jobs solo refrescan el proyecto.
    void this.store.reload(relayout ? (recommended ?? 'Otra distribución') : recommended);
    if (e.status === 'failed') this.toast.error(e.error ?? e.message);
    if (relayout && !recommended) this.toast.success('Lista otra distribución');
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
      // Cada vez una semilla nueva: el motor devuelve otra distribución igual de válida.
      await this.api.autoLayout(project.id, { keepLocked: true, seed: Math.floor(Math.random() * 2_147_483_647) });
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
    this.versionsDialog()?.open();
  }

  async restore(versionId: string): Promise<void> {
    await this.run(async (id) => {
      this.store.saveState.set('saved');
      this.store.replaceFromServer(await this.api.restoreVersion(id, versionId, this.store.project()?.revision));
      this.versionsDialog()?.close();
      this.toast.success('Versión restaurada');
    });
  }

  async share(): Promise<void> {
    await this.run(async (id) => {
      const link = await this.api.share(id);
      this.shareUrl.set(new URL(link.path, location.origin).href);
      await this.store.reload();
      this.shareDialog()?.open();
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
      this.shareDialog()?.close();
      this.toast.success('El enlace dejó de funcionar');
    });
  }

  async downloadPdf(): Promise<void> {
    await this.run(async (id) => {
      await this.store.flush();
      downloadBlob(await this.api.shoppingListPdf(id), `lista-de-compras-${fileSlug(this.store.project()?.name ?? 'proyecto')}.pdf`);
    });
  }

  /** El proyecto entero en un PDF: ficha, plano acotado y lista de compras. */
  async downloadDossier(): Promise<void> {
    await this.run(async (id) => {
      await this.store.flush();
      downloadBlob(await this.api.dossierPdf(id), `${fileSlug(this.store.project()?.name ?? 'proyecto')}.pdf`);
    });
  }

  /** Funda una vivienda con este cuarto y lleva al asistente para crear el siguiente dentro de ella. */
  async startHome(): Promise<void> {
    await this.run(async (id) => {
      const name = this.store.project()?.name ?? 'cuarto';
      const updated = await this.api.setHome(id, { homeName: `Vivienda de ${name}`.slice(0, 80) });
      this.store.patchProject(updated);
      if (updated.home) await this.router.navigate(['/proyectos/nuevo'], { queryParams: { vivienda: updated.home.id } });
    });
  }

  /** Trae la versión entera y la enseña junto al diseño actual (o la oculta si ya estaba abierta). */
  async compare(versionId: string): Promise<void> {
    if (this.compared()?.id === versionId) {
      this.compared.set(null);
      return;
    }
    await this.run(async (id) => this.compared.set(await this.api.version(id, versionId)));
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
