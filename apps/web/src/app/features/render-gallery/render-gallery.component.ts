import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import type { JobProgressEvent, Render } from '@interiores/shared-types';
import type { Subscription } from 'rxjs';
import { RendersApi } from '../../core/api/renders.api';
import { ProgressService } from '../../core/realtime/progress.service';
import { downloadUrl } from '../../core/ui/download';
import { ToastService } from '../../core/ui/toast.service';
import { DialogComponent } from '../../shared/ui/dialog.component';
import { DesignProjectStore } from '../project/design-project.store';
import { applyRenderProgress, comparisonFor, downloadName, engineLabel, isBlendExport, specLabel, type PendingProgress } from './gallery';

const DATE = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Galería de renders del proyecto: lo que se guardó desde el estudio y lo que se mandó a Blender.
 * Los renders en Blender aparecen enseguida como pendientes y avanzan en vivo por el socket; al
 * terminar avisa aunque la galería esté cerrada, para que se pueda seguir diseñando mientras tanto.
 */
@Component({
  selector: 'app-render-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent],
  template: `
    <app-dialog #dialog heading="Galería de renders" [wide]="true" (closed)="selected.set(null)">
      <div class="modal-body">
        @if (selected(); as r) {
          <figure class="full">
            @if (comparison(); as c) {
              <!-- Antes y después: el render del navegador encima, recortado hasta el deslizador. -->
              <div class="compare" [style.--split]="split() + '%'">
                <img [src]="c.blender.url" alt="Render en Blender" />
                <img class="before" [src]="c.browser.url" [alt]="'Render del navegador (' + engineLabel(c.browser) + ')'" />
                <span class="tag left">{{ engineLabel(c.browser) }}</span>
                <span class="tag right">Blender</span>
              </div>
              <label class="slider">
                <span>Navegador</span>
                <input type="range" min="0" max="100" [value]="split()" (input)="split.set(+$any($event.target).value)" aria-label="Antes y después: navegador o Blender" />
                <span>Blender</span>
              </label>
            } @else if (r.mediaType?.startsWith('video/')) {
              <video [src]="r.url" controls autoplay></video>
            } @else {
              <img [src]="r.url" [alt]="'Render ' + engineLabel(r)" />
            }
            <figcaption>
              {{ engineLabel(r) }} · {{ specLabel(r.spec) }}
              @if (!comparison() && r.provider === 'cycles') {
                · Guarda en el estudio un render del navegador desde esta misma vista para compararlos.
              }
            </figcaption>
          </figure>
        } @else if (loading()) {
          <p class="muted">Cargando la galería…</p>
        } @else if (failed()) {
          <p role="alert">No se pudo cargar la galería. <button type="button" class="btn btn-sm" (click)="load()">Reintentar</button></p>
        } @else {
          <ul class="grid">
            @for (r of renders(); track r.id) {
              <li class="card" [attr.data-status]="r.status">
                <button type="button" class="thumb" (click)="selected.set(r)" [disabled]="r.status !== 'ready'" [attr.aria-label]="'Ver en grande: ' + engineLabel(r)">
                  @switch (r.status) {
                    @case ('ready') {
                      @if (r.mediaType?.startsWith('video/')) {
                        <video [src]="r.url" muted preload="metadata"></video>
                      } @else {
                        <img [src]="r.url" alt="" loading="lazy" />
                      }
                    }
                    @case ('pending') {
                      <span class="state">
                        @if (pending().get(r.id); as p) {
                          <progress [value]="p.pct" max="100"></progress>
                          Renderizando… {{ p.pct }}%
                        } @else {
                          <progress></progress>
                          {{ r.provider === 'cycles' ? 'En cola para Blender…' : 'Procesando…' }}
                        }
                      </span>
                    }
                    @default {
                      <span class="state error">{{ r.error ?? 'No se pudo hacer este render.' }}</span>
                    }
                  }
                </button>
                <div class="meta">
                  <strong>{{ engineLabel(r) }}</strong>
                  <span>{{ specLabel(r.spec) }}</span>
                  <time [attr.datetime]="r.createdAt">{{ when(r.createdAt) }}</time>
                </div>
                <div class="actions">
                  @if (r.status === 'ready' && r.url) {
                    @if (r.downloads; as files) {
                      @if (isBlendExport(r)) {
                        <a class="btn btn-sm btn-primary" [href]="files.blend" [attr.download]="fileName(r, 'blend')" title="Ábrelo en Blender y pulsa F12 para el render final">Descargar .blend</a>
                      } @else {
                        <a class="btn btn-sm" [href]="files.png" [attr.download]="fileName(r, 'png')">PNG</a>
                        <a class="btn btn-sm" [href]="files.blend" [attr.download]="fileName(r, 'blend')" title="La escena para abrirla y retocarla en Blender">.blend</a>
                      }
                    } @else {
                      <a class="btn btn-sm" [href]="r.url" [attr.download]="fileName(r, extension(r))">Descargar</a>
                    }
                    <label class="check" title="Sale en el enlace público del proyecto">
                      <input type="checkbox" [checked]="r.shared" (change)="share(r, $any($event.target).checked)" /> Compartir
                    </label>
                  }
                  <span class="spacer"></span>
                  @if (confirming() === r.id) {
                    <button type="button" class="btn btn-sm" (click)="confirming.set(null)">No</button>
                    <button type="button" class="btn btn-sm btn-danger" (click)="remove(r)" [disabled]="deleting() === r.id">
                      {{ deleting() === r.id ? 'Borrando…' : r.status === 'pending' ? 'Sí, cancelar' : 'Sí, borrar' }}
                    </button>
                  } @else {
                    <button type="button" class="btn btn-sm btn-ghost btn-danger" (click)="confirming.set(r.id)">
                      {{ r.status === 'pending' ? 'Cancelar' : 'Borrar' }}
                    </button>
                  }
                </div>
              </li>
            } @empty {
              <li class="none muted">Aún no hay renders. Abre el estudio con «Render realista» y guarda o manda a Blender el primero.</li>
            }
          </ul>
        }
      </div>
      @if (selected()) {
        <div class="modal-actions">
          <button type="button" class="btn" (click)="selected.set(null)">Volver a la galería</button>
        </div>
      }
    </app-dialog>
  `,
  styles: `
    .grid {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
    }
    .card {
      display: grid;
      gap: var(--space-2);
      align-content: start;
    }
    .thumb {
      aspect-ratio: 16 / 10;
      width: 100%;
      padding: 0;
      border: 1px solid var(--rule);
      background: var(--surface-2);
      overflow: hidden;
      display: grid;
      place-items: center;
      cursor: zoom-in;
      font: inherit;
      color: inherit;
    }
    .thumb:disabled {
      cursor: default;
    }
    .thumb img,
    .thumb video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .state {
      display: grid;
      gap: var(--space-2);
      justify-items: center;
      padding: var(--space-3);
      text-align: center;
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .state progress {
      width: 80%;
    }
    .state.error {
      color: var(--danger, #b42318);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-2);
      font-size: var(--text-sm);
    }
    .meta span,
    .meta time {
      color: var(--text-muted);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
    }
    .spacer {
      flex: 1;
    }
    .check {
      display: inline-flex;
      gap: var(--space-1);
      align-items: center;
      font-size: var(--text-sm);
    }
    .none {
      grid-column: 1 / -1;
    }
    .full {
      margin: 0;
      display: grid;
      gap: var(--space-2);
    }
    .full img,
    .full video {
      width: 100%;
      max-height: 70vh;
      object-fit: contain;
      background: var(--surface-2);
    }
    .compare {
      position: relative;
      display: grid;
      background: var(--surface-2);
    }
    .compare img {
      grid-area: 1 / 1;
    }
    .compare .before {
      clip-path: inset(0 calc(100% - var(--split, 50%)) 0 0);
    }
    .compare::after {
      content: '';
      position: absolute;
      inset: 0 auto 0 var(--split, 50%);
      width: 2px;
      translate: -1px 0;
      background: var(--surface);
      box-shadow: 0 0 0 1px rgb(0 0 0 / 0.25);
      pointer-events: none;
    }
    .tag {
      position: absolute;
      top: var(--space-2);
      padding: 2px var(--space-2);
      font-size: var(--text-sm);
      background: rgb(0 0 0 / 0.55);
      color: #fff;
    }
    .tag.left {
      left: var(--space-2);
    }
    .tag.right {
      right: var(--space-2);
    }
    .slider {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .slider input {
      flex: 1;
    }
    .full figcaption {
      color: var(--text-muted);
    }
  `,
})
export class RenderGalleryComponent {
  private readonly api = inject(RendersApi);
  private readonly progress = inject(ProgressService);
  private readonly toast = inject(ToastService);
  private readonly store = inject(DesignProjectStore);

  private readonly dialog = viewChild.required<DialogComponent>('dialog');

  protected readonly renders = signal<Render[]>([]);
  protected readonly pending = signal<ReadonlyMap<string, PendingProgress>>(new Map());
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly selected = signal<Render | null>(null);
  protected readonly confirming = signal<string | null>(null);
  protected readonly deleting = signal<string | null>(null);
  /** Hasta dónde (%) se ve el render del navegador en el antes/después. */
  protected readonly split = signal(50);
  protected readonly comparison = computed(() => {
    const r = this.selected();
    return r ? comparisonFor(r, this.renders()) : null;
  });
  /** Renders en Blender que aún no terminan (para el contador del botón). */
  readonly inProgress = computed(() => this.renders().filter((r) => r.provider === 'cycles' && r.status === 'pending').length);

  protected readonly engineLabel = engineLabel;
  protected readonly isBlendExport = isBlendExport;
  protected readonly specLabel = specLabel;

  private readonly projectId = computed(() => this.store.project()?.id ?? null);
  private sub: Subscription | null = null;

  constructor() {
    effect(() => {
      const id = this.projectId();
      untracked(() => this.listen(id));
    });
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
  }

  open(): void {
    this.selected.set(null);
    this.confirming.set(null);
    this.dialog().open();
    void this.load();
  }

  /** Un render recién mandado a Blender: aparece ya como pendiente, sin esperar a recargar. */
  track(render: Render): void {
    this.renders.update((list) => [render, ...list.filter((r) => r.id !== render.id)]);
  }

  async load(): Promise<void> {
    const id = this.projectId();
    if (!id) return;
    this.loading.set(this.renders().length === 0);
    this.failed.set(false);
    try {
      this.renders.set(await this.api.list(id));
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected async share(render: Render, shared: boolean): Promise<void> {
    const id = this.projectId();
    if (!id) return;
    try {
      const updated = await this.api.update(id, render.id, { shared });
      this.renders.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
    } catch {
      this.toast.error('No se pudo cambiar si el render se comparte.');
      this.renders.update((list) => [...list]);
    }
  }

  protected async remove(render: Render): Promise<void> {
    const id = this.projectId();
    if (!id) return;
    this.deleting.set(render.id);
    try {
      await this.api.remove(id, render.id);
      this.renders.update((list) => list.filter((r) => r.id !== render.id));
    } catch {
      this.toast.error('No se pudo borrar el render.');
    } finally {
      this.deleting.set(null);
      this.confirming.set(null);
    }
  }

  protected when(iso: string): string {
    return DATE.format(new Date(iso));
  }

  protected extension(render: Render): string {
    return render.mediaType?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  }

  protected fileName(render: Render, ext: string): string {
    return downloadName(this.store.project()?.name ?? 'cuarto', render, ext);
  }

  private listen(projectId: string | null): void {
    this.sub?.unsubscribe();
    this.sub = null;
    this.renders.set([]);
    this.pending.set(new Map());
    if (!projectId) return;
    // Se carga ya la lista: así se sabe qué renders siguen pendientes (los únicos que se anuncian).
    void this.load();
    this.sub = this.progress.watch(projectId).subscribe((e) => this.onProgress(e));
  }

  private onProgress(event: JobProgressEvent): void {
    if (event.kind !== 'blender-render') return;
    this.pending.update((map) => applyRenderProgress(map, event));
    if (event.status === 'active') return;
    // El historial repite finales viejos: solo se anuncia lo que esta galería tenía como pendiente.
    const live = this.renders().find((r) => r.id === event.jobId && r.status === 'pending');
    if (!live) return void this.load();
    if (event.status === 'completed') {
      void this.load().then(() => this.announceReady(live.id));
    } else {
      void this.load();
      this.toast.error(event.error ?? 'El render en Blender no se pudo terminar.', { label: 'Ver', run: () => this.open() });
    }
  }

  /** Aviso de render terminado; un .blend exportado se descarga solo (el aviso permite repetirlo). */
  private announceReady(renderId: string): void {
    const render = this.renders().find((r) => r.id === renderId);
    const blend = render && isBlendExport(render) ? render.downloads?.blend : undefined;
    if (!render || !blend) return void this.toast.show('Tu render en Blender está listo', 'success', 8000, { label: 'Ver', run: () => this.open() });
    const download = () => downloadUrl(blend, this.fileName(render, 'blend'));
    download();
    this.toast.show('Tu archivo de Blender se está descargando: ábrelo y pulsa F12', 'success', 12000, { label: 'Descargar otra vez', run: download });
  }
}
