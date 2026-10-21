import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { IconComponent } from '../../shared/ui/icon.component';
import { ArViewerComponent } from '../ar-view/ar-viewer.component';
import { CalibrationDialogComponent } from '../calibration/calibration-dialog.component';
import { PlanEditorComponent } from '../floor-plan/plan-editor.component';
import { RoomDimensionsDialogComponent } from '../room-dimensions/room-dimensions-dialog.component';
import { DesignChatService } from '../chat/design-chat.service';
import { DesignProjectStore } from '../project/design-project.store';
import { agoLabel } from '../project/save-resilience';
import { SceneEditsService } from '../project/scene-edits.service';
import { SceneService } from './scene.service';
import { EditorPanelComponent } from './editor-panel.component';
import { EditorToolbarComponent, type ViewMode } from './editor-toolbar.component';
import { ShortcutsDialogComponent } from './shortcuts-dialog.component';
import { RecommendationCardComponent } from '../brief/recommendation-card.component';
import { EditorTourComponent } from '../onboarding/editor-tour.component';
import { PresentationOverlayComponent } from '../presentation/presentation-overlay.component';
import { ThreeViewportComponent } from './three-viewport.component';

export type { ViewMode };

const VIEW_KEY = 'interiores.editor.vista';

/** La última vista usada; la primera vez, dividida si la pantalla es ancha. */
function initialView(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === '3d' || saved === 'split' || saved === 'plan') return saved;
  } catch {
    // Sin almacenamiento: se decide por el ancho.
  }
  return typeof window !== 'undefined' && window.innerWidth >= 1180 ? 'split' : '3d';
}

/**
 * Paso 5 del flujo: edición 3D. SceneService se provee AQUÍ, así su ciclo de vida (y la
 * memoria GPU) coincide exactamente con el del editor: al salir del 3D se libera todo.
 */
@Component({
  selector: 'app-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // La conversación del asistente vive con el editor (no se pierde al cambiar de pestaña).
  providers: [SceneService, DesignChatService, SceneEditsService],
  imports: [
    ThreeViewportComponent,
    PlanEditorComponent,
    IconComponent,
    CalibrationDialogComponent,
    RoomDimensionsDialogComponent,
    ShortcutsDialogComponent,
    ArViewerComponent,
    PresentationOverlayComponent,
    EditorTourComponent,
    EditorToolbarComponent,
    EditorPanelComponent,
    RecommendationCardComponent,
  ],
  host: { '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    <app-editor-toolbar
      [viewMode]="viewMode()"
      [busy]="busy()"
      [demo]="demo()"
      (viewChange)="setView($event)"
      (autoLayout)="autoLayout.emit()"
      (roomDims)="roomDims.open()"
      (review)="panel.showReview()"
      (present)="presentation.start()"
      (shortcuts)="shortcuts.open()"
    />

    @if (store.recoverable(); as draft) {
      <div class="alert alert-warning row" role="status">
        <span>Encontramos cambios de tu última visita ({{ ago(draft.savedAt) }}) que no llegaron a guardarse.</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm btn-primary" (click)="store.recoverDraft()">Recuperarlos</button>
        <button type="button" class="btn btn-sm" (click)="store.discardDraft()">Descartar</button>
      </div>
    }
    @if (store.saveState() === 'conflict') {
      <div class="alert alert-warning row" role="alert">
        <span>El proyecto cambió en otra pestaña o el generador lo actualizó. Tus últimos cambios no se guardaron.</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" (click)="store.discardLocalAndReload()">Cargar la versión actual</button>
      </div>
    }
    @if (shell()?.needsCalibration) {
      <div class="alert alert-warning row calib">
        <span><app-icon name="ruler" /> Medidas aproximadas (confianza {{ confidence() }}%). Escribe las reales si quieres precisión al comprar.</span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-sm" (click)="roomDims.open()">Escribir medidas</button>
        <button type="button" class="btn btn-sm" (click)="calibration.open()">Calibrar con una medida</button>
      </div>
    }

    @if (!presenting()) {
      <app-editor-tour [demo]="demo()" />
    }
    <div class="layout">
      <div class="viewport-wrap" #wrap [class.presenting]="presenting()">
        <div class="stage" [class]="'stage stage-' + viewMode()">
          @if (viewMode() !== '3d') {
            <app-plan-editor class="pane" />
          }
          <!-- El visor 3D no se destruye al pasar al plano: solo se oculta (conserva la cámara y la GPU). -->
          <app-three-viewport class="pane" [class.off]="viewMode() === 'plan'" [class.bare]="presenting()" (swap)="panel.startSwap()" />
          @if (!presenting() && !demo()) {
            <app-recommendation-card />
          }
          <app-presentation-overlay #presentation (started)="onPresenting(true)" (stopped)="onPresenting(false)" />
        </div>
        <p class="help muted">En el 3D: arrastra un mueble, gira su aro o estira sus tiradores · Paredes (W), Pintar (B) y Medir (M) cambian de herramienta · clic derecho o dos dedos mueven la cámara</p>
      </div>

      <app-editor-panel #panel [demo]="demo()" (roomDims)="roomDims.open()" (ar)="ar.open($event)" />
    </div>

    <app-room-dimensions-dialog #roomDims (calibrate)="calibration.open()" />
    <app-calibration-dialog #calibration />
    <app-ar-viewer #ar />
    <app-shortcuts-dialog #shortcuts />
  `,
  styles: `
    :host {
      display: block;
    }
    .alert {
      margin-bottom: 12px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 16px;
    }
    .viewport-wrap {
      height: min(72vh, 720px);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .stage {
      flex: 1;
      min-height: 0;
      display: grid;
      gap: 12px;
      grid-template-columns: minmax(0, 1fr);
    }
    .stage-split {
      grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    }
    /* Presentando, el visor ocupa toda la pantalla y lo demás del editor queda debajo. */
    .stage {
      position: relative;
    }
    .viewport-wrap.presenting {
      position: fixed;
      inset: 0;
      z-index: 60;
      height: auto;
      padding: 0;
      background: var(--bg);
    }
    .viewport-wrap.presenting .help {
      display: none;
    }
    .pane {
      min-width: 0;
      min-height: 0;
    }
    .pane.off {
      display: none;
    }
    .help {
      font-size: 0.8rem;
      margin: 0;
    }
    @media (max-width: 960px) {
      .layout {
        grid-template-columns: 1fr;
        /* Hueco para el asa de la hoja inferior del panel. */
        padding-bottom: 64px;
      }
      .viewport-wrap {
        height: 60vh;
      }
      /* En pantallas angostas la vista dividida apila el plano sobre el 3D. */
      .viewport-wrap:has(.stage-split) {
        height: 110vh;
      }
      .stage-split {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
      }
    }
  `,
})
export class EditorComponent {
  protected readonly store = inject(DesignProjectStore);
  protected readonly scene = inject(SceneService);
  protected readonly edits = inject(SceneEditsService);

  readonly busy = input(false);
  /** Demostración sin cuenta: no hay servidor al que pedir otra distribución ni asistente. */
  readonly demo = input(false);
  readonly autoLayout = output<void>();

  private readonly shortcuts = viewChild.required<ShortcutsDialogComponent>('shortcuts');
  private readonly wrap = viewChild.required<ElementRef<HTMLElement>>('wrap');
  /** Se está enseñando el cuarto a pantalla completa: el editor no atiende atajos. */
  protected readonly presenting = signal(false);
  private viewBeforePresenting: ViewMode = '3d';
  /** Vista elegida: solo 3D, plano y 3D lado a lado, o solo plano. Se recuerda entre visitas. */
  protected readonly viewMode = signal<ViewMode>(initialView());
  protected readonly shell = this.store.shell;
  protected readonly confidence = computed(() => Math.round((this.shell()?.scaleConfidence ?? 0) * 100));

  protected ago(savedAt: number): string {
    return agoLabel(savedAt, Date.now());
  }

  protected setView(mode: ViewMode): void {
    this.viewMode.set(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {
      // Sin almacenamiento (modo privado): la vista simplemente no se recuerda.
    }
  }

  /** Al presentar se pasa a solo 3D y a pantalla completa; al salir, vuelve la vista de antes. */
  protected onPresenting(on: boolean): void {
    this.presenting.set(on);
    if (on) {
      this.viewBeforePresenting = this.viewMode();
      this.viewMode.set('3d');
      // Si el navegador no deja (o no puede), la presentación sigue ocupando la ventana.
      void this.wrap().nativeElement.requestFullscreen?.().catch(() => undefined);
    } else {
      this.viewMode.set(this.viewBeforePresenting);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      this.scene.frameRoom();
    }
  }

  onGlobalKey(e: KeyboardEvent): void {
    if (this.presenting()) return; // las teclas son de la presentación
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (e.key === '?') {
      e.preventDefault();
      this.shortcuts().open();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.store.redo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      // Duplicar (si no hay nada seleccionado, el atajo del navegador sigue su curso).
      if (!this.store.selected()) return;
      e.preventDefault();
      if (this.store.selection().length > 1) this.edits.duplicateSelection();
      else this.edits.duplicate();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      // Con texto seleccionado, Ctrl+C sigue copiando el texto.
      if (!window.getSelection()?.toString()) this.edits.copy();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      if (this.edits.paste()) e.preventDefault();
    }
  }
}
