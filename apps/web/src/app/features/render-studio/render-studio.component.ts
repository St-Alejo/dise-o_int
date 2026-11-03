import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import {
  CYCLES_SAMPLES,
  FOCAL_PRESETS_MM,
  RENDER_QUALITIES,
  renderSize,
  topDownCamera,
  type RenderAspect,
  type RenderCamera,
  type Render,
  type RenderNodeStatus,
  type RenderQuality,
  type RenderResolution,
  type RenderSpec,
  type RenderTime,
} from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { RendersApi } from '../../core/api/renders.api';
import { downloadBlob, fileSlug } from '../../core/ui/download';
import { ToastService } from '../../core/ui/toast.service';
import { DialogComponent } from '../../shared/ui/dialog.component';
import { SegmentedComponent, type SegmentOption } from '../../shared/ui/segmented.component';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneService } from '../viewport-3d/scene.service';
import { RenderStudioService, canvasBlob } from './render-studio.service';
import { cameraFromViewer } from './studio-camera';

type CameraChoice = 'current' | 'top';
/** Dónde se hace la imagen: aquí mismo, o en el nodo con Blender (Cycles) si está encendido. */
type EngineChoice = 'browser' | 'blender';

const CAMERAS: readonly { id: CameraChoice; label: string }[] = [
  { id: 'current', label: 'Lo que ves ahora' },
  { id: 'top', label: 'Desde arriba' },
];
const TIMES: readonly { id: RenderTime; label: string }[] = [
  { id: 'day', label: 'Día' },
  { id: 'evening', label: 'Tarde' },
  { id: 'night', label: 'Noche' },
];
const ASPECTS: readonly { id: RenderAspect; label: string }[] = [
  { id: '16:9', label: '16:9' },
  { id: '4:3', label: '4:3' },
  { id: '1:1', label: '1:1' },
  { id: '9:16', label: 'Vertical' },
];
const RESOLUTIONS: readonly { id: RenderResolution; label: string }[] = [
  { id: '1080p', label: '1080p' },
  { id: '2k', label: '2K' },
  { id: '4k', label: '4K' },
];
const QUALITIES: readonly { id: RenderQuality; label: string; hint: string }[] = [
  { id: 'draft', label: 'Borrador', hint: 'Unos segundos, con algo de grano' },
  { id: 'good', label: 'Buena', hint: 'El equilibrio para compartir' },
  { id: 'final', label: 'Final', hint: 'La más limpia; tarda varios minutos' },
];

/**
 * Estudio de render: una imagen realista del cuarto, con luz rebotada, sombras suaves y el cielo
 * entrando por las ventanas. Se elige la cámara, el objetivo, la hora, el formato y la calidad; se
 * ve cómo se va limpiando la imagen y al final se descarga o se guarda en la galería del proyecto.
 */
@Component({
  selector: 'app-render-studio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogComponent, SegmentedComponent],
  providers: [RenderStudioService],
  template: `
    <app-dialog #dialog heading="Estudio de render" [wide]="true" (closed)="onClosed()">
      <div class="modal-body studio">
        <figure class="preview" [style.aspect-ratio]="aspectCss()">
          <canvas #preview aria-label="Vista previa del render"></canvas>
          @if (studio.phase() === 'idle' || studio.phase() === 'error') {
            <figcaption class="placeholder">
              @if (studio.error(); as message) {
                <span role="alert">{{ message }}</span>
              } @else if (engine() === 'blender') {
                Blender renderiza aparte, con la GPU del nodo: puedes seguir diseñando y verás el avance en la galería.
              } @else {
                La imagen aparecerá aquí y se irá limpiando mientras se calcula la luz.
              }
            </figcaption>
          }
        </figure>

        <div class="status" aria-live="polite">
          @switch (studio.phase()) {
            @case ('preparing') {
              <p>
                Preparando la escena… {{ round(studio.prepareProgress() * 100) }}%
                @if (studio.engineUsed() === 'pathtracer') { · la primera vez, el trazado de rayos tarda hasta un minuto en arrancar }
              </p>
            }
            @case ('rendering') {
              <progress [value]="studio.samples()" [max]="studio.target()"></progress>
              <p>
                {{ studio.samples() }} de {{ studio.target() }} pasadas
                @if (studio.remaining(); as left) { · faltan {{ left }} }
              </p>
            }
            @case ('done') {
              <p>Listo: {{ size().width }} × {{ size().height }} px.</p>
              @if (studio.notice(); as notice) { <p class="notice">{{ notice }}</p> }
            }
          }
        </div>

        <div class="controls">
          @if (canSave()) {
            <div class="opt"><span class="lbl">Motor</span><app-segmented label="Motor" [options]="engines()" [value]="engine()" (valueChange)="engine.set($event)" /></div>
            <p class="hint">{{ engineHint() }}</p>
          }
          <div class="opt"><span class="lbl">Cámara</span><app-segmented label="Cámara" [options]="cameras" [value]="camera()" (valueChange)="camera.set($event)" /></div>
          @if (camera() === 'current') {
            <label class="field">
              <span>Objetivo</span>
              <select [value]="focal()" (change)="focal.set(+$any($event.target).value)" [disabled]="studio.busy()">
                <option [value]="0">El del visor</option>
                @for (mm of focals; track mm) {
                  <option [value]="mm">{{ mm }} mm{{ mm <= 16 ? ' (gran angular)' : mm === 24 ? ' (interiores)' : mm === 50 ? ' (detalle)' : '' }}</option>
                }
              </select>
            </label>
            <label class="check">
              <input type="checkbox" [checked]="straight()" (change)="straight.set($any($event.target).checked)" [disabled]="studio.busy()" />
              Verticales rectas (como en las fotos de arquitectura)
            </label>
          }
          <div class="opt"><span class="lbl">Hora</span><app-segmented label="Hora" [options]="times" [value]="time()" (valueChange)="time.set($event)" /></div>
          <div class="opt"><span class="lbl">Formato</span><app-segmented label="Formato" [options]="aspects" [value]="aspect()" (valueChange)="aspect.set($event)" /></div>
          <div class="opt"><span class="lbl">Resolución</span><app-segmented label="Resolución" [options]="resolutions" [value]="resolution()" (valueChange)="resolution.set($event)" /></div>
          <div class="opt"><span class="lbl">Calidad</span><app-segmented label="Calidad" [options]="qualities" [value]="quality()" (valueChange)="quality.set($event)" /></div>
          <p class="hint">{{ qualityHint() }}</p>
          @if (engine() === 'browser' && !studio.canPathTrace()) {
            <p class="hint">Tu navegador no permite trazar rayos: la imagen saldrá con el raster de mejor calidad.</p>
          }
        </div>
      </div>

      <div class="modal-actions">
        @if (studio.busy()) {
          <button type="button" class="btn" (click)="studio.cancel()">Cancelar</button>
        } @else {
          @if (studio.phase() === 'done') {
            <button type="button" class="btn" (click)="download('image/png')">Descargar PNG</button>
            <button type="button" class="btn" (click)="download('image/jpeg')">Descargar JPG</button>
            @if (canSave()) {
              <button type="button" class="btn" (click)="save()" [disabled]="saving() || saved()">{{ saved() ? 'Guardado en la galería' : saving() ? 'Guardando…' : 'Guardar en la galería' }}</button>
            }
          }
          <button type="button" class="btn" (click)="downloadScene()" [disabled]="exporting()" title="El cuarto en 3D (.glb) para abrirlo en Blender u otro programa de render">
            {{ exporting() ? 'Exportando…' : 'Descargar escena 3D' }}
          </button>
          @if (engine() === 'blender') {
            <button type="button" class="btn" (click)="sendToBlender('export')" [disabled]="!!sending()" title="Un .blend con materiales, luces, cielo y cámara ya puestos: ábrelo en Blender y pulsa F12">
              {{ sending() === 'export' ? 'Preparando el .blend…' : 'Exportar a Blender (.blend)' }}
            </button>
            <button type="button" class="btn btn-primary" (click)="sendToBlender('render')" [disabled]="!!sending()">{{ sending() === 'render' ? 'Enviando la escena…' : 'Renderizar en Blender' }}</button>
          } @else {
            <button type="button" class="btn btn-primary" (click)="start()">{{ studio.phase() === 'done' ? 'Volver a renderizar' : 'Renderizar' }}</button>
          }
        }
      </div>
    </app-dialog>
  `,
  styles: `
    .studio {
      display: grid;
      gap: var(--space-4);
    }
    .preview {
      position: relative;
      margin: 0;
      width: 100%;
      max-height: 56vh;
      background: var(--surface-2);
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .preview canvas {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .placeholder {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: var(--space-5);
      text-align: center;
      color: var(--text-muted);
    }
    .status p {
      margin: var(--space-1) 0 0;
    }
    .status .notice {
      color: var(--text);
    }
    progress {
      width: 100%;
    }
    .controls {
      display: grid;
      gap: var(--space-3);
      justify-items: start;
    }
    .opt {
      display: grid;
      gap: var(--space-1);
    }
    .lbl,
    .field > span {
      font-weight: 600;
    }
    .field {
      display: grid;
      gap: var(--space-1);
    }
    .check {
      display: flex;
      gap: var(--space-2);
      align-items: center;
    }
    .hint {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
  `,
})
export class RenderStudioComponent {
  protected readonly studio = inject(RenderStudioService);
  private readonly scene = inject(SceneService);
  private readonly store = inject(DesignProjectStore);
  private readonly renders = inject(RendersApi);
  private readonly toast = inject(ToastService);

  /** En la demo no hay galería: solo se descarga. */
  readonly demo = input(false);
  /** Se mandó un render a Blender (la galería lo muestra como pendiente). */
  readonly sent = output<Render>();
  /** Abrir la galería del proyecto. */
  readonly gallery = output<void>();

  private readonly dialog = viewChild.required<DialogComponent>('dialog');
  private readonly previewRef = viewChild<ElementRef<HTMLCanvasElement>>('preview');

  protected readonly cameras = CAMERAS;
  protected readonly times = TIMES;
  protected readonly aspects = ASPECTS;
  protected readonly resolutions = RESOLUTIONS;
  protected readonly qualities = QUALITIES;
  protected readonly focals = FOCAL_PRESETS_MM;

  protected readonly camera = signal<CameraChoice>('current');
  /** 0 = la focal que ya tiene el visor. */
  protected readonly focal = signal(0);
  protected readonly straight = signal(true);
  protected readonly time = signal<RenderTime>('day');
  protected readonly aspect = signal<RenderAspect>('16:9');
  protected readonly resolution = signal<RenderResolution>('2k');
  protected readonly quality = signal<RenderQuality>('good');
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly exporting = signal(false);
  protected readonly engine = signal<EngineChoice>('browser');
  protected readonly node = signal<RenderNodeStatus | null>(null);
  /** Qué se está mandando al nodo (para el texto del botón), o null. */
  protected readonly sending = signal<'render' | 'export' | null>(null);
  protected readonly engines = computed((): SegmentOption<EngineChoice>[] => {
    const node = this.node();
    return [
      { id: 'browser', label: 'Navegador', title: 'Se dibuja aquí mismo, con tu tarjeta gráfica' },
      {
        id: 'blender',
        label: 'Blender (fotorrealista)',
        disabled: !node?.available,
        title: node?.available ? 'Cycles en el nodo de render con GPU' : 'El nodo de render con Blender está apagado',
      },
    ];
  });
  protected readonly engineHint = computed(() => {
    const node = this.node();
    if (this.engine() === 'blender') return `Cycles con la GPU del nodo${node?.device ? ` (${node.device})` : ''}. Incluye el PNG y el archivo .blend para retocarlo.`;
    if (!node) return 'Comprobando si el nodo de Blender está encendido…';
    return node.available
      ? 'Para la imagen más realista, elige Blender: se hace aparte y te avisamos al terminar.'
      : 'Blender no está disponible ahora (el nodo de render está apagado): se usa el navegador.';
  });

  protected readonly size = computed(() => renderSize(this.resolution(), this.aspect()));
  protected readonly aspectCss = computed(() => this.aspect().replace(':', ' / '));
  protected readonly qualityHint = computed(() => {
    const q = QUALITIES.find((x) => x.id === this.quality())!;
    if (this.engine() === 'blender') return `Hasta ${CYCLES_SAMPLES[q.id]} muestras por píxel; Blender para antes donde la imagen ya está limpia.`;
    return `${q.hint} (${RENDER_QUALITIES[q.id]} muestras por píxel).`;
  });
  protected readonly canSave = computed(() => !this.demo() && !!this.store.project()?.id);

  constructor() {
    effect(() => this.studio.attachPreview(this.previewRef()?.nativeElement ?? null));
  }

  open(): void {
    this.time.set(this.scene.timeOfDay());
    this.saved.set(false);
    this.dialog().open();
    if (this.canSave()) void this.checkNode();
  }

  /**
   * Exportar a Blender en un clic: la vista del visor a la hora del editor, sin abrir el estudio.
   * El .blend se descarga solo cuando el nodo termina (lo hace la galería).
   */
  async quickExport(): Promise<void> {
    if (!this.canSave() || this.sending()) return;
    const node = await this.renders.renderNode().catch(() => null);
    if (!node?.available) return this.toast.error('Blender está apagado ahora: enciende el nodo de render y vuelve a intentarlo.');
    this.time.set(this.scene.timeOfDay());
    this.camera.set('current');
    this.engine.set('blender');
    await this.sendToBlender('export');
  }

  private async checkNode(): Promise<void> {
    this.node.set(null);
    const node = await this.renders.renderNode();
    this.node.set(node);
    if (!node.available) this.engine.set('browser');
  }

  protected round(n: number): number {
    return Math.round(n);
  }

  protected start(): void {
    this.saved.set(false);
    void this.studio.render(this.spec());
  }

  private spec(): RenderSpec {
    return {
      camera: this.cameraSpec(),
      timeOfDay: this.time(),
      resolution: this.resolution(),
      aspect: this.aspect(),
      quality: this.quality(),
      engine: this.engine() === 'blender' ? 'cycles' : 'pathtracer',
    };
  }

  private cameraSpec(): RenderCamera {
    const shell = this.store.shell();
    if (this.camera() === 'top' && shell) return topDownCamera(shell.widthM, shell.depthM, this.aspect());
    const viewer = this.scene.viewerCamera();
    const camera = cameraFromViewer(viewer.position, viewer.target, viewer.fovDeg, viewer.aspect);
    return { ...camera, focalMm: this.focal() || camera.focalMm, straightVerticals: this.straight() };
  }

  protected async download(type: 'image/png' | 'image/jpeg'): Promise<void> {
    const canvas = this.studio.result();
    if (!canvas) return;
    const name = fileSlug(this.store.project()?.name ?? 'cuarto');
    downloadBlob(await canvasBlob(canvas, type), `${name}-render.${type === 'image/png' ? 'png' : 'jpg'}`);
  }

  /** El cuarto en 3D, con su papel por malla, para abrirlo en Blender (o en otro programa). */
  protected async downloadScene(): Promise<void> {
    this.exporting.set(true);
    try {
      const scene = await this.studio.exportScene(this.spec());
      if (!scene) return this.toast.error('El visor 3D aún no está listo: abre la vista 3D y vuelve a intentarlo.');
      downloadBlob(scene.glb, `${fileSlug(this.store.project()?.name ?? 'cuarto')}-escena.glb`);
    } catch (err) {
      console.error('[estudio] no se pudo exportar la escena', err);
      this.toast.error('No se pudo exportar la escena 3D.');
    } finally {
      this.exporting.set(false);
    }
  }

  /**
   * Exporta la escena tal como se ve y la manda al nodo Blender; el resultado llega a la galería.
   * `export`: lo que se quiere es el .blend listo para abrir (el nodo solo hace una miniatura).
   */
  protected async sendToBlender(purpose: 'render' | 'export'): Promise<void> {
    const projectId = this.store.project()?.id;
    if (!projectId || this.sending()) return;
    this.sending.set(purpose);
    try {
      const spec: RenderSpec = { ...this.spec(), purpose };
      const scene = await this.studio.exportScene(spec);
      if (!scene) return this.toast.error('El visor 3D aún no está listo: abre la vista 3D y vuelve a intentarlo.');
      const render = await this.renders.renderInBlender(projectId, spec, scene.lights, scene.glb);
      this.sent.emit(render);
      this.dialog().close();
      const message = purpose === 'export' ? 'Preparando tu archivo de Blender: se descarga solo en unos segundos.' : 'Render enviado a Blender. Te avisamos cuando esté listo.';
      this.toast.show(message, 'success', 6000, { label: 'Ver galería', run: () => this.gallery.emit() });
    } catch (err) {
      const error = ApiError.from(err);
      // 503: el nodo se apagó entre abrir el estudio y pulsar; se refleja en la opción.
      if (error.status === 503) void this.checkNode();
      this.toast.error(error.status > 0 ? error.userMessage : 'No se pudo mandar la escena a Blender.');
    } finally {
      this.sending.set(null);
    }
  }

  protected async save(): Promise<void> {
    const canvas = this.studio.result();
    const spec = this.studio.resultSpec();
    const projectId = this.store.project()?.id;
    if (!canvas || !spec || !projectId) return;
    this.saving.set(true);
    try {
      await this.renders.upload(projectId, 'path', spec, await canvasBlob(canvas, 'image/jpeg', 0.93));
      this.saved.set(true);
      this.toast.success('Render guardado en la galería del proyecto');
    } catch {
      this.toast.error('No se pudo guardar el render. Puedes descargarlo y volver a intentarlo.');
    } finally {
      this.saving.set(false);
    }
  }

  protected onClosed(): void {
    this.studio.cancel();
  }
}
