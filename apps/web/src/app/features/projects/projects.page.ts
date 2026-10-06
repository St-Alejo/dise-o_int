import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ROOM_TYPE_LABELS, type ProjectListItem } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { ToastService } from '../../core/ui/toast.service';

const STATUS: Record<ProjectListItem['status'], { label: string; cls: string }> = {
  uploaded: { label: 'En cola', cls: 'badge' },
  processing: { label: 'Procesando', cls: 'badge badge-warning' },
  ready: { label: 'Listo', cls: 'badge badge-success' },
  failed: { label: 'Con error', cls: 'badge badge-danger' },
};

@Component({
  selector: 'app-projects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe],
  template: `
    <section class="container page">
      <div class="row head">
        <h1>Mis proyectos</h1>
        <span class="spacer"></span>
        <a routerLink="/proyectos/nuevo" class="btn btn-primary">+ Nuevo proyecto</a>
      </div>

      @if (loading()) {
        <div class="grid" aria-busy="true">
          @for (i of [1, 2, 3]; track i) {
            <div class="skeleton" style="height: 260px"></div>
          }
        </div>
      } @else if (error()) {
        <p class="alert alert-danger" role="alert">{{ error() }} <button class="btn btn-sm" (click)="load()">Reintentar</button></p>
      } @else if (projects().length === 0) {
        <div class="card empty">
          <h2>Aún no tienes proyectos</h2>
          <p class="muted">Sube una foto de tu cuarto y en menos de un minuto verás varias propuestas de diseño.</p>
          <a routerLink="/proyectos/nuevo" class="btn btn-primary btn-lg">Subir mi primera foto</a>
        </div>
      } @else {
        <ul class="grid" role="list">
          @for (p of projects(); track p.id) {
            <li class="card project">
              <a [routerLink]="['/proyectos', p.id]" class="thumb" [attr.aria-label]="'Abrir ' + p.name">
                @if (p.thumbnailUrl) {
                  <img [src]="p.thumbnailUrl" alt="" loading="lazy" />
                } @else {
                  <div class="thumb-empty" aria-hidden="true">🛋️</div>
                }
              </a>
              <div class="meta">
                <div class="row">
                  <h2 class="name">{{ p.name }}</h2>
                  <span [class]="status[p.status].cls">{{ status[p.status].label }}</span>
                </div>
                <p class="muted small">
                  {{ roomLabels[p.roomType] }} · {{ p.itemCount }} muebles · {{ p.updatedAt | date: 'd MMM, HH:mm' }}
                </p>
                @if (!p.saved) {
                  <p class="small warn" title="Guarda una versión o compártelo para conservarlo">⏳ Sin guardar: se borra a las 24 h</p>
                }
                <div class="row">
                  <a [routerLink]="['/proyectos', p.id]" class="btn btn-sm">Abrir</a>
                  <span class="spacer"></span>
                  @if (confirming() === p.id) {
                    <span class="small">¿Borrar foto, renders y versiones?</span>
                    <button type="button" class="btn btn-sm" (click)="confirming.set(null)">No</button>
                    <button type="button" class="btn btn-sm btn-danger" (click)="remove(p)" [disabled]="deleting() === p.id">
                      {{ deleting() === p.id ? 'Borrando…' : 'Sí, borrar' }}
                    </button>
                  } @else {
                    <button type="button" class="btn btn-sm btn-ghost btn-danger" (click)="confirming.set(p.id)">Borrar</button>
                  }
                </div>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .page {
      padding: 32px 0 64px;
    }
    .head {
      margin-bottom: 16px;
    }
    .head h1 {
      margin: 0;
    }
    .grid {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
      gap: 20px;
    }
    .project {
      padding: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .thumb {
      display: block;
      aspect-ratio: 4 / 3;
      background: var(--surface-2);
    }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .thumb-empty {
      height: 100%;
      display: grid;
      place-items: center;
      font-size: 3rem;
    }
    .meta {
      padding: 14px 16px 16px;
    }
    .name {
      font-size: 1.1rem;
      margin: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .small {
      font-size: 0.85rem;
      margin: 6px 0;
    }
    .warn {
      color: var(--warning);
    }
    .empty {
      text-align: center;
      padding: 48px 24px;
    }
  `,
})
export class ProjectsPage implements OnInit {
  private readonly api = inject(ProjectsApi);
  private readonly toast = inject(ToastService);

  protected readonly projects = signal<ProjectListItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly deleting = signal<string | null>(null);
  protected readonly confirming = signal<string | null>(null);
  protected readonly status = STATUS;
  protected readonly roomLabels = ROOM_TYPE_LABELS;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.projects.set(await this.api.list());
    } catch (err) {
      this.error.set(ApiError.from(err).userMessage);
    } finally {
      this.loading.set(false);
    }
  }

  async remove(p: ProjectListItem): Promise<void> {
    this.deleting.set(p.id);
    try {
      await this.api.remove(p.id);
      this.projects.update((list) => list.filter((x) => x.id !== p.id));
      this.toast.success('Proyecto borrado definitivamente');
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    } finally {
      this.deleting.set(null);
      this.confirming.set(null);
    }
  }
}
