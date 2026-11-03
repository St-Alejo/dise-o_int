import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { RENDER_QUALITIES, type BlenderLights, type RenderEngine as RenderEngineId, type RenderSpec } from '@interiores/shared-types';
import { SceneService, type StudioHost } from '../viewport-3d/scene.service';
import { EngineUnsupportedError, createEngine, supportsPathTracing, type RenderEngine } from './engines';
import { exportRoomGlb } from './scene-export';
import { previewSize, remainingLabel, studioViewOf } from './studio-camera';

export type StudioPhase = 'idle' | 'preparing' | 'rendering' | 'done' | 'error';
/** Motores que dibujan aquí mismo (Cycles va al nodo Blender). */
type BrowserEngine = Exclude<RenderEngineId, 'cycles'>;

/** Lo que se le deja a cada cuadro del navegador: el resto del tiempo la página sigue respondiendo. */
const FRAME_BUDGET_MS = 40;
/** Lado máximo de la vista previa en pantalla (la imagen final va aparte, a su tamaño). */
const PREVIEW_MAX = { width: 960, height: 640 };
const PREVIEW_EVERY_MS = 300;
/** Pasadas tras las que se comprueba que el trazado de rayos de verdad da imagen. */
const HEALTH_CHECK_AT = 2;

/**
 * Estudio de render: toma prestada la escena del visor, la dibuja con el motor elegido muestra a
 * muestra (con vista previa y tiempo restante), guarda la imagen final y deja el visor como estaba.
 * Se cancela en cualquier momento.
 */
@Injectable()
export class RenderStudioService {
  private readonly scene = inject(SceneService);
  private readonly zone = inject(NgZone);

  readonly phase = signal<StudioPhase>('idle');
  readonly samples = signal(0);
  readonly target = signal(0);
  readonly prepareProgress = signal(0);
  readonly remaining = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  /** Motor con el que se está dibujando (el trazado de rayos cae a raster si el navegador no puede). */
  readonly engineUsed = signal<RenderEngineId | null>(null);
  /** La imagen terminada, a tamaño completo. */
  readonly result = signal<HTMLCanvasElement | null>(null);
  /** El spec con el que salió la imagen terminada. */
  readonly resultSpec = signal<RenderSpec | null>(null);
  /** Aviso no bloqueante (por ejemplo, que se cambió de motor a mitad). */
  readonly notice = signal<string | null>(null);
  readonly busy = computed(() => this.phase() === 'preparing' || this.phase() === 'rendering');
  readonly percent = computed(() => (this.target() ? Math.min(100, Math.round((this.samples() / this.target()) * 100)) : 0));

  private preview: HTMLCanvasElement | null = null;
  private cancelled = false;

  /** ¿Puede este navegador trazar rayos? (sin visor todavía, se supone que sí). */
  canPathTrace(): boolean {
    const host = this.scene.studioHost;
    return !host || supportsPathTracing(host.renderer);
  }

  attachPreview(canvas: HTMLCanvasElement | null): void {
    this.preview = canvas;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async render(spec: RenderSpec): Promise<void> {
    const host = this.scene.studioHost;
    if (this.busy()) return;
    if (!host || !this.scene.sceneReady()) {
      this.fail('El visor 3D aún no está listo: abre la vista 3D y vuelve a intentarlo.');
      return;
    }
    const wanted: BrowserEngine = spec.engine === 'pathtracer' && supportsPathTracing(host.renderer) ? 'pathtracer' : 'raster';
    this.cancelled = false;
    this.error.set(null);
    this.notice.set(null);
    this.result.set(null);
    this.resultSpec.set(null);
    try {
      await this.run(host, spec, wanted);
    } catch (err) {
      if (!(err instanceof EngineUnsupportedError)) throw err;
      // La GPU compiló el trazador pero no da imagen: se repite en raster, que funciona en todas.
      console.warn('[estudio] el trazado de rayos no da imagen en esta GPU; se usa raster');
      this.notice.set('Tu tarjeta gráfica no pudo trazar rayos: la imagen se hizo con el motor raster.');
      await this.run(host, spec, 'raster');
    }
  }

  private async run(host: StudioHost, spec: RenderSpec, engineId: BrowserEngine): Promise<void> {
    const view = studioViewOf(spec);
    // En raster cada muestra es un cuadro entero: con 32 ya no se nota la diferencia.
    const target = engineId === 'pathtracer' ? RENDER_QUALITIES[spec.quality] : Math.min(32, RENDER_QUALITIES[spec.quality] / 4);
    this.samples.set(0);
    this.target.set(target);
    this.prepareProgress.set(0);
    this.remaining.set(null);
    this.engineUsed.set(engineId);
    this.phase.set('preparing');

    const restoreScene = this.scene.beginStudio(view);
    let engine: RenderEngine | null = null;
    try {
      engine = await createEngine(engineId);
      await engine.prepare({ host, scene: this.scene.scene, camera: this.scene.camera, view }, (p) => this.prepareProgress.set(p));
      if (this.cancelled) return this.reset();
      this.phase.set('rendering');
      const done = await this.accumulate(engine, target);
      if (!done) return this.reset();
      engine.finish();
      const image = engine.snapshot();
      this.result.set(image);
      this.drawPreview(image);
      this.resultSpec.set({ ...spec, engine: engineId });
      this.phase.set('done');
    } catch (err) {
      if (err instanceof EngineUnsupportedError) throw err;
      console.error('[estudio] el render falló', err);
      this.fail(
        engineId === 'pathtracer'
          ? 'Tu tarjeta gráfica no pudo con el trazado de rayos. Prueba con menos resolución o con el motor raster.'
          : 'No se pudo dibujar la imagen. Prueba con menos resolución.',
      );
    } finally {
      engine?.dispose();
      restoreScene();
      host.restore();
    }
  }

  /**
   * El cuarto como GLB y la luz que tenía, vistos desde la cámara del spec (para Blender o para
   * descargarlo). Usa la misma preparación que un render: sin ayudas, sin sombras fingidas y sin
   * paredes recortadas. Null si el visor no está listo.
   */
  async exportScene(spec: RenderSpec): Promise<{ glb: Blob; lights: BlenderLights } | null> {
    if (this.busy() || !this.scene.studioHost || !this.scene.sceneReady()) return null;
    const restoreScene = this.scene.beginStudio(studioViewOf(spec));
    try {
      const glb = await exportRoomGlb(this.scene.scene);
      return { glb: new Blob([glb], { type: 'model/gltf-binary' }), lights: this.scene.lightsForRender() };
    } finally {
      restoreScene();
    }
  }

  /** Suma muestras cuadro a cuadro hasta llegar al objetivo; false si se canceló. */
  private accumulate(engine: RenderEngine, target: number): Promise<boolean> {
    const started = performance.now();
    let lastPreview = 0;
    let scratch: HTMLCanvasElement | undefined;
    let checked = !engine.healthy;
    return new Promise((resolve, reject) => {
      // Fuera de Angular: cada cuadro no dispara detección de cambios; las señales sí avisan.
      this.zone.runOutsideAngular(() => {
        const frame = () => {
          if (this.cancelled) return resolve(false);
          try {
            const t0 = performance.now();
            let samples = this.samples();
            do samples = engine.step();
            while (samples < target && (checked || samples < HEALTH_CHECK_AT) && performance.now() - t0 < FRAME_BUDGET_MS);
            if (!checked && samples >= HEALTH_CHECK_AT) {
              checked = true;
              if (!engine.healthy?.()) throw new EngineUnsupportedError();
            }
            // Leer la imagen entera cuesta: la vista previa se refresca unas tres veces por segundo.
            if (performance.now() - lastPreview > PREVIEW_EVERY_MS) {
              this.drawPreview((scratch = engine.snapshot(scratch)));
              lastPreview = performance.now();
            }
            this.samples.set(Math.min(samples, target));
            this.remaining.set(remainingLabel(samples, target, performance.now() - started));
            if (samples >= target) return resolve(true);
            requestAnimationFrame(frame);
          } catch (err) {
            reject(err);
          }
        };
        requestAnimationFrame(frame);
      });
    });
  }

  /** Copia la imagen, reducida, a la vista previa. */
  private drawPreview(source: HTMLCanvasElement): void {
    const preview = this.preview;
    if (!preview) return;
    const size = previewSize(source.width, source.height, PREVIEW_MAX.width, PREVIEW_MAX.height);
    if (preview.width !== size.width || preview.height !== size.height) Object.assign(preview, size);
    preview.getContext('2d')?.drawImage(source, 0, 0, size.width, size.height);
  }

  private reset(): void {
    this.phase.set('idle');
    this.samples.set(0);
    this.remaining.set(null);
  }

  private fail(message: string): void {
    this.error.set(message);
    this.phase.set('error');
  }
}

/** La imagen terminada como archivo (PNG sin pérdida o JPEG para compartir y subir). */
export function canvasBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('sin imagen'))), type, quality));
}
