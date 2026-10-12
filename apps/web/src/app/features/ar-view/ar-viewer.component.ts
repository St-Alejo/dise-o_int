import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
  viewChild,
} from '@angular/core';
import type { CatalogItem } from '@interiores/shared-types';
import { DialogComponent } from '../../shared/ui/dialog.component';

/**
 * "Ver en mi cuarto" (Fase 3, AR): <model-viewer> con WebXR hit-test y respaldo a
 * Scene Viewer (Android) y Quick Look (iOS), sin app nativa. La librería se carga de forma
 * diferida solo cuando el usuario abre este diálogo. `ar-scale="fixed"` mantiene la escala real.
 */
@Component({
  selector: 'app-ar-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [DialogComponent],
  template: `
    <app-dialog #dialog [heading]="item()?.name ?? 'Vista en tu espacio'" [wide]="true" (closed)="item.set(null)">
      <div class="modal-body stack">
        @if (loadError()) {
          <p class="alert alert-danger">No se pudo cargar el visor AR: {{ loadError() }}</p>
        } @else if (ready() && item(); as it) {
          <model-viewer
            [attr.src]="absoluteUrl()"
            [attr.alt]="'Modelo 3D de ' + it.name"
            ar
            ar-modes="webxr scene-viewer quick-look"
            ar-scale="fixed"
            ar-placement="floor"
            camera-controls
            touch-action="pan-y"
            shadow-intensity="1"
            exposure="1"
            environment-image="neutral"
          >
            <button slot="ar-button" class="btn btn-primary ar-btn">Ver en mi cuarto (AR)</button>
          </model-viewer>
          <p class="muted small">
            {{ it.dimensionsM.x.toFixed(2) }} × {{ it.dimensionsM.z.toFixed(2) }} m, {{ it.dimensionsM.y.toFixed(2) }} m de alto.
            En el celular, toca "Ver en mi cuarto" y apunta al piso: el mueble aparece a escala real.
            En computadora puedes rotarlo y hacer zoom.
          </p>
        } @else {
          <div class="skeleton" style="height: 380px"></div>
        }
      </div>
    </app-dialog>
  `,
  styles: `
    model-viewer {
      width: 100%;
      height: min(60vh, 460px);
      background: var(--surface-2);
      border-radius: var(--radius);
    }
    .ar-btn {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
    }
    .small {
      font-size: 0.85rem;
    }
  `,
})
export class ArViewerComponent {
  private readonly dialog = viewChild.required<DialogComponent>('dialog');
  protected readonly item = signal<CatalogItem | null>(null);
  protected readonly ready = signal(false);
  protected readonly loadError = signal<string | null>(null);
  /** Scene Viewer / Quick Look necesitan una URL absoluta. */
  protected readonly absoluteUrl = computed(() => {
    const it = this.item();
    return it ? new URL(it.modelUrl, location.origin).href : '';
  });

  async open(item: CatalogItem): Promise<void> {
    this.item.set(item);
    this.dialog().open();
    if (this.ready()) return;
    try {
      await import('@google/model-viewer');
      this.ready.set(true);
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : String(err));
    }
  }

  close(): void {
    this.dialog().close();
  }
}
