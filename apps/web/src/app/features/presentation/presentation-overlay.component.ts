import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { RoomPlan } from '@interiores/shared-types';
import { DesignProjectStore } from '../project/design-project.store';
import type { CameraModeId } from '../viewport-3d/camera/camera-mode';
import type { TimeOfDay } from '../viewport-3d/scene/lighting-rig';
import { SceneService } from '../viewport-3d/scene.service';
import { SLIDES, captionOf, slideAfterKey, type PresentationFacts } from './presentation';

/** Lo que tarda la cámara en volver del recorrido a la vista de órbita. */
const BACK_TO_ORBIT_MS = 1600;

/**
 * Modo presentación: recorre una secuencia de vistas del cuarto (entero, desde arriba, de tarde,
 * de noche, por dentro) con su título, para enseñarlo sin las herramientas del editor. Se maneja
 * con las flechas; al salir, el visor queda como estaba.
 */
@Component({
  selector: 'app-presentation-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)', '(document:fullscreenchange)': 'onFullscreenChange()' },
  template: `
    @if (active()) {
      <div class="bar" role="region" aria-label="Presentación del cuarto">
        <div class="text" aria-live="polite">
          <p class="count">{{ index() + 1 }} / {{ slides.length }}</p>
          <h2>{{ slide().title }}</h2>
          <p class="caption">{{ caption() }}</p>
        </div>
        <div class="nav">
          <button type="button" class="btn btn-sm" (click)="go(index() - 1)" [disabled]="index() === 0">Anterior</button>
          <button type="button" class="btn btn-sm btn-primary" (click)="go(index() + 1)" [disabled]="index() === slides.length - 1">Siguiente</button>
          <button type="button" class="btn btn-sm" (click)="stop()">Salir</button>
        </div>
      </div>
    }
  `,
  styles: `
    /* Fuera del flujo: va dentro de la rejilla del editor y no debe quitarle sitio al visor. */
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .bar {
      position: absolute;
      inset: auto 0 0 0;
      z-index: 8;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-4);
      align-items: flex-end;
      justify-content: space-between;
      padding: var(--space-7) var(--space-5) var(--space-5);
      background: linear-gradient(to top, rgb(12 28 27 / 82%), rgb(12 28 27 / 0%));
      color: #f5f1e8;
      pointer-events: none;
    }
    .text > * {
      margin: 0;
    }
    .count {
      font-size: var(--text-xs);
      letter-spacing: 0.1em;
      opacity: 0.8;
    }
    h2 {
      font-size: var(--text-2xl);
      font-weight: 440;
    }
    .caption {
      opacity: 0.9;
    }
    .nav {
      display: flex;
      gap: var(--space-2);
      pointer-events: auto;
    }
  `,
})
export class PresentationOverlayComponent {
  private readonly scene = inject(SceneService);
  private readonly store = inject(DesignProjectStore);

  /** El editor acomoda su vista (solo 3D, a pantalla completa) al empezar y la devuelve al salir. */
  readonly started = output<void>();
  readonly stopped = output<void>();

  readonly active = signal(false);
  protected readonly slides = SLIDES;
  protected readonly index = signal(0);
  protected readonly slide = computed(() => SLIDES[this.index()]!);
  protected readonly caption = computed(() => captionOf(this.slide(), this.facts()));
  private before: { time: TimeOfDay; mode: CameraModeId; readOnly: boolean } | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;

  private readonly facts = computed<PresentationFacts>(() => {
    const shell = this.store.shell();
    return {
      name: this.store.project()?.name ?? 'Cuarto',
      areaM2: shell ? RoomPlan.from(shell).area() : 0,
      widthM: shell?.widthM ?? 0,
      depthM: shell?.depthM ?? 0,
      pieces: this.store.placements().length,
      total: this.store.totalPrice(),
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.pending) clearTimeout(this.pending);
    });
  }

  start(): void {
    if (this.active() || !this.store.shell()) return;
    this.before = { time: this.scene.timeOfDay(), mode: this.scene.cameraMode(), readOnly: this.scene.readOnly() };
    this.store.select(null);
    // Mientras se presenta no se edita: arrastrar solo mueve la cámara.
    this.scene.readOnly.set(true);
    this.active.set(true);
    this.started.emit();
    this.go(0);
  }

  stop(): void {
    if (!this.active()) return;
    if (this.pending) clearTimeout(this.pending);
    this.active.set(false);
    const before = this.before;
    if (before) {
      this.scene.readOnly.set(before.readOnly);
      this.scene.setTimeOfDay(before.time);
      this.scene.setCameraMode(before.mode);
    }
    this.stopped.emit();
  }

  protected go(to: number): void {
    const index = Math.max(0, Math.min(SLIDES.length - 1, to));
    this.index.set(index);
    const slide = SLIDES[index]!;
    if (this.pending) clearTimeout(this.pending);
    this.scene.setTimeOfDay(slide.light);
    if (slide.view === 'walk') {
      this.scene.setCameraMode('walk');
      return;
    }
    const view = slide.view;
    if (this.scene.cameraMode() === 'walk') {
      // La cámara vuelve sola a la vista de esquina; otra vista se pide cuando ya llegó.
      this.scene.setCameraMode('orbit');
      if (view !== 'corner') this.pending = setTimeout(() => this.scene.viewFrom(view), BACK_TO_ORBIT_MS);
      return;
    }
    this.scene.viewFrom(view);
  }

  protected onKey(event: KeyboardEvent): void {
    if (!this.active()) return;
    const next = slideAfterKey(event.key, this.index());
    if (next === null) return;
    event.preventDefault();
    if (next === 'exit') this.stop();
    else this.go(next);
  }

  /** Salir de pantalla completa con Escape (el navegador se queda con la tecla) cierra la presentación. */
  protected onFullscreenChange(): void {
    if (this.active() && !document.fullscreenElement) this.stop();
  }
}
