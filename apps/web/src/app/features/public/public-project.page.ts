import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ROOM_TYPE_LABELS, STYLES, type DesignProject, type PublicProject, type ShoppingList } from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { DesignProjectStore } from '../project/design-project.store';
import { CompareSliderComponent } from '../style-gallery/compare-slider.component';
import { SceneService } from '../viewport-3d/scene.service';
import { ThreeViewportComponent } from '../viewport-3d/three-viewport.component';

/** Link público de solo lectura para compartir con pareja, familia o cliente (paso 7). */
@Component({
  selector: 'app-public-project',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DesignProjectStore, SceneService],
  imports: [RouterLink, CurrencyPipe, CompareSliderComponent, ThreeViewportComponent],
  template: `
    <section class="container page">
      @if (error()) {
        <div class="card" role="alert">
          <h1>Este enlace ya no está disponible</h1>
          <p class="muted">Puede que el dueño haya dejado de compartir el proyecto.</p>
          <a routerLink="/" class="btn btn-primary">Conocer Interiores IA</a>
        </div>
      } @else if (project(); as p) {
        <p class="badge badge-primary">Proyecto compartido · solo lectura</p>
        <h1>{{ p.name }}</h1>
        <p class="muted">{{ roomLabels[p.roomType] }}{{ p.selectedStyleId ? ' · estilo ' + styles[p.selectedStyleId].label : '' }}</p>

        @if (selectedPreview(); as pr) {
          @if (p.sourcePhotoUrl && pr.imageUrl) {
            <h2>Antes y después</h2>
            <div class="compare"><app-compare-slider [before]="p.sourcePhotoUrl" [after]="pr.imageUrl" [afterLabel]="styles[pr.styleName].label" /></div>
          }
        }

        @if (p.roomShell) {
          <h2>Recorrido 3D</h2>
          <div class="viewport"><app-three-viewport [readOnly]="true" /></div>
          @if (store.selectedItem(); as item) {
            <p class="card selected">
              <strong>{{ item.name }}</strong> · {{ item.price | currency: item.currency : 'symbol' : '1.0-0' }}
              @if (item.productUrl) {
                · <a [href]="item.productUrl" target="_blank" rel="noopener noreferrer">buscar similar</a>
              }
            </p>
          }
        }

        @if (list(); as l) {
          <h2>Lista de compras</h2>
          <table class="card list">
            <thead><tr><th scope="col">Mueble</th><th scope="col">Cant.</th><th scope="col">Subtotal</th></tr></thead>
            <tbody>
              @for (line of l.lines; track line.catalogItemId) {
                <tr>
                  <td>
                    @if (line.productUrl) {
                      <a [href]="line.productUrl" target="_blank" rel="noopener noreferrer">{{ line.name }}</a>
                    } @else {
                      {{ line.name }}
                    }
                  </td>
                  <td>{{ line.quantity }}</td>
                  <td>{{ line.subtotal | currency: line.currency : 'symbol' : '1.0-0' }}</td>
                </tr>
              }
            </tbody>
            <tfoot><tr><th scope="row" colspan="2">Total aprox.</th><td><strong>{{ l.total | currency: l.currency : 'symbol' : '1.0-0' }}</strong></td></tr></tfoot>
          </table>
        }
        <p class="muted cta">¿Quieres rediseñar tu propio cuarto? <a routerLink="/registro">Crea una cuenta gratis</a>.</p>
      } @else {
        <div class="skeleton" style="height: 50vh" aria-busy="true"></div>
      }
    </section>
  `,
  styles: `
    .page {
      padding: 32px 0 64px;
      display: grid;
      gap: 8px;
    }
    h2 {
      margin-top: 24px;
    }
    .page > .badge {
      justify-self: start;
    }
    .compare {
      max-width: 900px;
    }
    .viewport {
      height: 60vh;
    }
    .selected {
      padding: 12px 16px;
    }
    .list {
      width: 100%;
      border-collapse: collapse;
      padding: 0;
    }
    .list th,
    .list td {
      padding: 10px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    .cta {
      margin-top: 24px;
    }
  `,
})
export class PublicProjectPage implements OnInit {
  protected readonly store = inject(DesignProjectStore);
  private readonly api = inject(ProjectsApi);

  readonly token = input.required<string>();

  protected readonly styles = STYLES;
  protected readonly roomLabels = ROOM_TYPE_LABELS;
  protected readonly project = signal<PublicProject | null>(null);
  protected readonly list = signal<ShoppingList | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedPreview = computed(() => {
    const p = this.project();
    if (!p) return null;
    return p.stylePreviews.find((x) => x.styleName === p.selectedStyleId) ?? p.stylePreviews[0] ?? null;
  });

  async ngOnInit(): Promise<void> {
    try {
      const [project, list] = await Promise.all([this.api.publicProject(this.token()), this.api.publicShoppingList(this.token())]);
      this.project.set(project);
      this.list.set(list);
      // El store espera un DesignProject: los campos privados se rellenan con valores neutros.
      const asProject: DesignProject = { ...project, ownerId: '', versions: [], saved: true, lastError: null };
      await this.store.loadReadOnly(asProject);
    } catch (err) {
      this.error.set(ApiError.from(err).userMessage);
    }
  }
}
