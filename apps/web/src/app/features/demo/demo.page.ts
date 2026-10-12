import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ROOM_TYPE_LABELS, STYLES } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { DesignProjectStore } from '../project/design-project.store';
import { ProjectFactsComponent } from '../project/project-facts.component';
import { ProjectPersistence } from '../project/project-persistence';
import { EditorComponent } from '../viewport-3d/editor.component';
import { DEMO_PREFIX, LocalPersistence } from './local-persistence';

/**
 * El editor completo sin crear cuenta: se abre una plantilla amueblada y lo que se cambia se
 * guarda en este navegador. Con un clic pasa a ser un proyecto propio (tras registrarse).
 */
@Component({
  selector: 'app-demo-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LocalPersistence, { provide: ProjectPersistence, useExisting: LocalPersistence }, DesignProjectStore],
  imports: [RouterLink, EditorComponent, ProjectFactsComponent, IconComponent],
  template: `
    <section class="container page">
      @if (store.loadError(); as err) {
        <div class="card" role="alert">
          <h1>No pudimos abrir la demostración</h1>
          <p class="muted">{{ err }}</p>
          <a routerLink="/plantillas" class="btn">Ver las plantillas</a>
        </div>
      } @else if (store.project(); as p) {
        <header class="head">
          <div class="title">
            <a routerLink="/plantillas" class="back" aria-label="Volver a las plantillas"><app-icon name="back" /></a>
            <div>
              <h1>{{ p.name }}</h1>
              <p class="muted meta">
                {{ roomLabels[p.roomType] }}@if (styleName(); as style) { · {{ style }} }
                · <span class="badge badge-accent">Demostración</span>
              </p>
            </div>
          </div>
          <div class="row actions">
            <button type="button" class="btn" (click)="restart()" title="Vuelve a la plantilla tal como viene">Empezar de nuevo</button>
            <button type="button" class="btn btn-primary" (click)="keep()" [disabled]="saving()">
              <app-icon name="check" /> {{ saving() ? 'Guardando…' : 'Guardar en mi cuenta' }}
            </button>
          </div>
        </header>
        <p class="note" role="note">
          <app-icon name="info" />
          Estás probando sin cuenta: los cambios se quedan en este navegador. Para conservarlos, compartirlos o pedir otra distribución, guárdalo en tu cuenta.
        </p>
        <app-project-facts class="facts" />
        <app-editor [demo]="true" />
      } @else {
        <div class="skeleton frame" aria-hidden="true"></div>
        <p class="visually-hidden" role="status">Abriendo la plantilla…</p>
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
      margin-bottom: 12px;
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
    .actions {
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .note {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin: 0 0 16px;
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      background: var(--accent-soft);
      color: var(--text);
      font-size: var(--text-sm);
    }
    .note app-icon {
      flex: none;
      margin-top: 2px;
      color: var(--accent-strong);
    }
    .facts {
      display: block;
      margin-bottom: 16px;
    }
    .frame {
      height: 60vh;
      border-radius: var(--radius);
    }
  `,
})
export class DemoPage implements OnInit {
  /** Plantilla que se abre (parámetro de la ruta). */
  readonly plantilla = input.required<string>();
  /** `?guardar=1`: se vuelve de registrarse con la intención de guardar. */
  readonly guardar = input<string | undefined>();

  protected readonly store = inject(DesignProjectStore);
  private readonly local = inject(LocalPersistence);
  private readonly api = inject(ProjectsApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly roomLabels = ROOM_TYPE_LABELS;
  protected readonly saving = signal(false);
  protected readonly styleName = computed(() => {
    const id = this.store.project()?.selectedStyleId;
    return id ? STYLES[id].label : null;
  });
  private readonly projectId = computed(() => `${DEMO_PREFIX}${this.plantilla()}`);

  async ngOnInit(): Promise<void> {
    await this.store.load(this.projectId());
    if (this.guardar() && this.auth.isAuthenticated() && this.store.project()) await this.keep();
  }

  /** Olvida los cambios y vuelve a abrir la plantilla tal como viene. */
  protected restart(): void {
    this.local.reset(this.projectId());
    location.reload();
  }

  /** Convierte la demo en un proyecto propio; sin sesión, primero se crea la cuenta y se vuelve aquí. */
  protected async keep(): Promise<void> {
    const project = this.store.project();
    const shell = this.store.shell();
    if (!project || !shell || this.saving()) return;
    if (!this.auth.isAuthenticated()) {
      await this.store.flush();
      await this.router.navigate(['/registro'], { queryParams: { volver: `/demo/${this.plantilla()}?guardar=1` } });
      return;
    }
    this.saving.set(true);
    try {
      await this.store.flush();
      const created = await this.api.importScene({
        name: project.name,
        roomType: project.roomType,
        roomShell: shell,
        furniturePlacements: [...this.store.placements()],
        finishes: this.store.finishes(),
        selectedStyleId: project.selectedStyleId,
        budgetCap: this.store.budgetCap(),
      });
      this.local.reset(this.projectId());
      this.toast.success('Guardado en tu cuenta.');
      await this.router.navigate(['/proyectos', created.id], { queryParams: { vista: '3d' } });
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    } finally {
      this.saving.set(false);
    }
  }
}
