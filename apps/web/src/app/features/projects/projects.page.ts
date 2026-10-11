import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { ROOM_TYPE_LABELS, STYLES, type ProjectListItem, type RoomType } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { ToastService } from '../../core/ui/toast.service';
import { filterProjects, oneDecimal, outlineSvg, roomTypesOf, summarize, type ProjectSort } from './projects-filter';

const STATUS: Record<ProjectListItem['status'], { label: string; cls: string }> = {
  uploaded: { label: 'En cola', cls: 'badge' },
  processing: { label: 'Procesando', cls: 'badge badge-warning' },
  ready: { label: 'Listo', cls: 'badge badge-success' },
  failed: { label: 'Con error', cls: 'badge badge-danger' },
};

const ROOM_ICONS: Record<RoomType, IconName> = {
  living: 'sofa',
  bedroom: 'bed',
  dining: 'table',
  office: 'chair',
  kitchen: 'kitchen',
  bathroom: 'bath',
};

const SORTS: readonly { id: ProjectSort; label: string }[] = [
  { id: 'recent', label: 'Más recientes' },
  { id: 'name', label: 'Nombre' },
  { id: 'area', label: 'Más grandes' },
];

@Component({
  selector: 'app-projects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, CurrencyPipe, IconComponent],
  template: `
    <section class="container page">
      <div class="row head">
        <div>
          <h1>Mis proyectos</h1>
          <p class="muted sub">Cada proyecto es un cuarto: su plano, sus muebles y su lista de compras.</p>
        </div>
        <span class="spacer"></span>
        <a routerLink="/proyectos/nuevo" class="btn btn-primary"><app-icon name="plus" /> Nuevo proyecto</a>
      </div>

      @if (loading()) {
        <div class="grid" aria-busy="true">
          @for (i of [1, 2, 3]; track i) {
            <div class="skeleton tall"></div>
          }
        </div>
      } @else if (error()) {
        <p class="alert alert-danger" role="alert">{{ error() }} <button class="btn btn-sm" (click)="load()">Reintentar</button></p>
      } @else if (projects().length === 0) {
        <div class="card empty">
          <span class="icon-tile big"><app-icon name="cube" /></span>
          <h2>Aún no tienes proyectos</h2>
          <p class="muted">Empieza con una foto de tu cuarto o, si no tienes una a mano, con su forma y sus medidas.</p>
          <div class="row ways">
            <a routerLink="/proyectos/nuevo" class="btn btn-primary btn-lg"><app-icon name="camera" /> Subir mi primera foto</a>
            <a routerLink="/proyectos/nuevo" class="btn btn-lg"><app-icon name="ruler" /> Empezar con medidas</a>
          </div>
        </div>
      } @else {
        <dl class="summary">
          <div class="stat">
            <dt class="stat-label">{{ summary().total === 1 ? 'proyecto' : 'proyectos' }}</dt>
            <dd class="stat-value">{{ summary().total }}</dd>
          </div>
          <div class="stat">
            <dt class="stat-label">muebles colocados</dt>
            <dd class="stat-value">{{ summary().pieces }}</dd>
          </div>
          @if (summary().areaM2 > 0) {
            <div class="stat">
              <dt class="stat-label">m² diseñados</dt>
              <dd class="stat-value">{{ oneDecimal(summary().areaM2) }}</dd>
            </div>
          }
          @if (summary().unsaved > 0) {
            <div class="stat warn">
              <dt class="stat-label">sin guardar: se borran a las 24 h</dt>
              <dd class="stat-value">{{ summary().unsaved }}</dd>
            </div>
          }
        </dl>

        <div class="row filters">
          @if (roomTypes().length > 1) {
            <div class="row types" role="group" aria-label="Filtrar por tipo de cuarto">
              <button type="button" class="chip" [attr.aria-pressed]="roomType() === 'all'" (click)="roomType.set('all')">Todos</button>
              @for (r of roomTypes(); track r) {
                <button type="button" class="chip" [attr.aria-pressed]="roomType() === r" (click)="roomType.set(r)">
                  <app-icon [name]="roomIcons[r]" /> {{ roomLabels[r] }}
                </button>
              }
            </div>
          }
          <span class="spacer"></span>
          @if (projects().length > 3) {
            <input
              class="input search"
              type="search"
              placeholder="Buscar por nombre"
              aria-label="Buscar proyectos por nombre"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
            />
          }
          @if (projects().length > 1) {
            <select class="input sort" aria-label="Ordenar proyectos" [value]="sort()" (change)="sort.set($any($event.target).value)">
              @for (s of sorts; track s.id) {
                <option [value]="s.id">{{ s.label }}</option>
              }
            </select>
          }
        </div>
        <p class="visually-hidden" role="status">{{ shown().length }} de {{ projects().length }} proyectos</p>

        <ul class="grid" role="list">
          @for (p of shown(); track p.id) {
            <li class="card card-hover project">
              <a [routerLink]="['/proyectos', p.id]" class="thumb" [attr.aria-label]="'Abrir ' + p.name">
                @if (p.thumbnailUrl) {
                  <img [src]="p.thumbnailUrl" alt="" loading="lazy" />
                } @else if (p.outline; as outline) {
                  <!-- Sin miniatura todavía: la planta del cuarto, a escala. -->
                  <div class="thumb-empty" aria-hidden="true">
                    <svg [attr.viewBox]="outlineSvg(outline).viewBox" preserveAspectRatio="xMidYMid meet"><polygon [attr.points]="outlineSvg(outline).points" /></svg>
                  </div>
                } @else {
                  <div class="thumb-empty" aria-hidden="true"><app-icon [name]="roomIcons[p.roomType]" /></div>
                }
                <span class="room badge"><app-icon [name]="roomIcons[p.roomType]" /> {{ roomLabels[p.roomType] }}</span>
              </a>
              <div class="meta">
                <div class="row title">
                  @if (renaming() === p.id) {
                    <input
                      #nameInput
                      class="input rename"
                      maxlength="120"
                      [value]="p.name"
                      [attr.aria-label]="'Nombre nuevo de ' + p.name"
                      (keydown.enter)="rename(p, nameInput.value)"
                      (keydown.escape)="renaming.set(null)"
                    />
                    <button type="button" class="btn btn-sm btn-primary" (click)="rename(p, nameInput.value)">Guardar</button>
                  } @else {
                    <h2 class="name">{{ p.name }}</h2>
                    <span [class]="status[p.status].cls">{{ status[p.status].label }}</span>
                  }
                </div>
                <ul class="facts" [attr.aria-label]="'Datos de ' + p.name">
                  @if (p.areaM2) {
                    <li><app-icon name="area" /> {{ oneDecimal(p.areaM2) }} m²</li>
                  }
                  <li><app-icon name="sofa" /> {{ p.itemCount }} {{ p.itemCount === 1 ? 'mueble' : 'muebles' }}</li>
                  @if (p.estimatedTotal) {
                    <li><app-icon name="tag" /> {{ p.estimatedTotal | currency: p.currency ?? 'USD' : 'symbol-narrow' : '1.0-0' }}</li>
                  }
                  @if (p.styleId; as style) {
                    <li><app-icon name="palette" /> {{ styles[style].label }}</li>
                  }
                </ul>
                <p class="muted small"><app-icon name="clock" /> {{ p.updatedAt | date: 'd MMM, HH:mm' }}</p>
                @if (!p.saved) {
                  <p class="small warn-text" title="Guarda una versión o compártelo para conservarlo"><app-icon name="info" /> Sin guardar: se borra a las 24 h</p>
                }
                <div class="row actions">
                  <a [routerLink]="['/proyectos', p.id]" class="btn btn-sm">Abrir</a>
                  <button type="button" class="btn btn-sm btn-ghost" (click)="renaming.set(p.id)" [attr.aria-label]="'Renombrar ' + p.name">Renombrar</button>
                  @if (p.status === 'ready') {
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost"
                      (click)="duplicate(p)"
                      [disabled]="duplicating() === p.id"
                      [attr.aria-label]="'Duplicar ' + p.name"
                      title="Copia el cuarto y los muebles en un proyecto nuevo para probar otra variante"
                    >
                      {{ duplicating() === p.id ? 'Copiando…' : 'Duplicar' }}
                    </button>
                  }
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
          } @empty {
            <li class="muted none">{{ query().trim() ? 'Ningún proyecto se llama así.' : 'No hay proyectos de ese tipo.' }}</li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .page {
      padding: var(--space-6) 0 64px;
    }
    .head {
      margin-bottom: var(--space-5);
      align-items: flex-end;
    }
    .head h1 {
      margin: 0;
    }
    .sub {
      margin: var(--space-1) 0 0;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: var(--space-4) var(--space-6);
      margin: 0 0 var(--space-5);
      padding: var(--space-4) var(--space-5);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--tint-1);
    }
    .summary dd {
      margin: 0;
      order: -1;
    }
    .summary .stat-value {
      font-size: var(--text-xl);
    }
    .summary .warn .stat-value {
      color: var(--warning);
    }
    .filters {
      margin-bottom: var(--space-4);
      gap: var(--space-2);
    }
    .types {
      gap: var(--space-2);
    }
    .search {
      width: min(240px, 100%);
    }
    .sort {
      width: auto;
    }
    .rename {
      flex: 1;
      min-width: 0;
    }
    .grid {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: var(--space-5);
    }
    .tall {
      height: 320px;
    }
    .project {
      padding: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .thumb {
      position: relative;
      display: block;
      aspect-ratio: 16 / 10;
      background: var(--surface-2);
    }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .thumb-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      font-size: 3rem;
      color: var(--text-muted);
      background: var(--gradient-brand);
    }
    .thumb-empty svg {
      position: absolute;
      inset: var(--space-5) var(--space-5) var(--space-7);
      width: calc(100% - var(--space-5) * 2);
      height: calc(100% - var(--space-5) - var(--space-7));
    }
    /* El grosor no escala con el cuarto: un baño y una sala se dibujan con la misma línea. */
    .thumb-empty polygon {
      fill: color-mix(in srgb, var(--surface) 70%, transparent);
      stroke: var(--primary);
      stroke-width: 2.5;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    .room {
      position: absolute;
      left: var(--space-3);
      bottom: var(--space-3);
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow-sm);
    }
    .meta {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-4);
      flex: 1;
      align-content: start;
    }
    .title {
      flex-wrap: nowrap;
    }
    .name {
      font-size: var(--text-lg);
      margin: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .facts {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-4);
      font-size: var(--text-sm);
    }
    .facts li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .facts app-icon {
      color: var(--primary);
    }
    .small {
      font-size: var(--text-sm);
      margin: 0;
    }
    .warn-text {
      color: var(--warning);
    }
    .actions {
      gap: var(--space-1);
      margin-top: var(--space-1);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
    }
    .none {
      grid-column: 1 / -1;
      padding: var(--space-5) 0;
    }
    .empty {
      display: grid;
      justify-items: center;
      gap: var(--space-3);
      text-align: center;
      padding: var(--space-7) var(--space-5);
      background: var(--gradient-brand);
    }
    .empty h2,
    .empty p {
      margin: 0;
    }
    .empty p {
      max-width: 48ch;
    }
    .big {
      width: 64px;
      height: 64px;
      font-size: 1.8rem;
    }
    .ways {
      justify-content: center;
      margin-top: var(--space-2);
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
  protected readonly renaming = signal<string | null>(null);
  protected readonly duplicating = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly roomType = signal<RoomType | 'all'>('all');
  protected readonly sort = signal<ProjectSort>('recent');
  /** Lo que pasa el buscador y el filtro, en el orden elegido. */
  protected readonly shown = computed(() => filterProjects(this.projects(), { query: this.query(), roomType: this.roomType(), sort: this.sort() }));
  protected readonly summary = computed(() => summarize(this.projects()));
  protected readonly roomTypes = computed(() => roomTypesOf(this.projects()));
  protected readonly status = STATUS;
  protected readonly roomLabels = ROOM_TYPE_LABELS;
  protected readonly roomIcons = ROOM_ICONS;
  protected readonly styles = STYLES;
  protected readonly sorts = SORTS;
  protected readonly oneDecimal = oneDecimal;
  protected readonly outlineSvg = outlineSvg;

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

  async rename(p: ProjectListItem, value: string): Promise<void> {
    const name = value.trim();
    this.renaming.set(null);
    if (!name || name === p.name) return;
    try {
      await this.api.rename(p.id, name);
      this.projects.update((list) => list.map((x) => (x.id === p.id ? { ...x, name } : x)));
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    }
  }

  async duplicate(p: ProjectListItem): Promise<void> {
    this.duplicating.set(p.id);
    try {
      const copy = await this.api.duplicate(p.id);
      // La lista trae miniatura y recuento ya calculados: se vuelve a pedir en vez de inventarlos.
      this.projects.set(await this.api.list());
      this.toast.success(`"${copy.name}" está lista para editar`);
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    } finally {
      this.duplicating.set(null);
    }
  }

  async remove(p: ProjectListItem): Promise<void> {
    this.deleting.set(p.id);
    try {
      await this.api.remove(p.id);
      this.projects.update((list) => list.filter((x) => x.id !== p.id));
      if (!this.projects().some((x) => x.roomType === this.roomType())) this.roomType.set('all');
      this.toast.success('Proyecto borrado definitivamente');
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    } finally {
      this.deleting.set(null);
      this.confirming.set(null);
    }
  }
}
