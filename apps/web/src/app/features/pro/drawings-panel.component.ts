import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  availableSheets,
  polygonBounds,
  renderDxf,
  renderSvg,
  roomPolygon,
  SHEET_TITLES,
  sheetFor,
  viewFor,
  type DrawingSetInput,
  type SectionLine,
  type SheetId,
} from '@interiores/shared-types';
import { ProjectsApi } from '../../core/api/projects.api';
import { downloadBlob, fileSlug } from '../../core/ui/download';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { DesignProjectStore } from '../project/design-project.store';

type Axis = 'x' | 'z';

/** Línea de corte que cruza todo el cuarto a lo largo de un eje, mirando hacia un lado. */
export function sectionAcross(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, axis: Axis, at: number, flip: boolean): SectionLine {
  const pad = 1;
  // Corte horizontal (z fija): de oeste a este mira hacia el fondo (z menor); al revés, hacia el frente.
  const line: SectionLine =
    axis === 'z'
      ? { a: { x: bounds.minX - pad, z: at }, b: { x: bounds.maxX + pad, z: at } }
      : { a: { x: at, z: bounds.maxZ + pad }, b: { x: at, z: bounds.minZ - pad } };
  return flip ? { a: line.b, b: line.a } : line;
}

/**
 * Planos técnicos del cuarto: vista previa de cada lámina (dibujada aquí mismo con la planta y los
 * muebles tal como están ahora), el corte A–A' y las descargas. SVG y DXF se generan en el
 * navegador; el juego de planos en PDF lo arma el servidor.
 */
@Component({
  selector: 'app-drawings-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (input(); as data) {
      <div class="stack">
        <label class="field">
          <span>Lámina</span>
          <select class="input" (change)="sheet.set($any($event.target).value)">
            @for (id of sheets(); track id) {
              <option [value]="id" [selected]="id === sheet()">{{ titles[id] }}</option>
            }
          </select>
        </label>

        @if (preview(); as url) {
          <button type="button" class="preview" (click)="expanded.set(true)" aria-label="Ver la lámina en grande">
            <img [src]="url" [alt]="titles[sheet()] + ' a escala, con cajetín'" />
          </button>
          @if (adjusted()) {
            <p class="muted fine">No cabía a 1:{{ data.spec.sheet.scale }}: se dibujó a 1:{{ adjusted() }}. Cambia el papel en la ficha técnica si la quieres a esa escala.</p>
          }
        }

        <fieldset>
          <legend>Corte A–A'</legend>
          @if (data.spec.section) {
            <p class="fine">Trazado. Aparece en la planta arquitectónica y como lámina propia.</p>
          }
          <div class="row">
            <label class="field">
              <span>Dirección</span>
              <select class="input" #axisSel>
                <option value="z">Horizontal (a lo ancho)</option>
                <option value="x">Vertical (a lo largo)</option>
              </select>
            </label>
            <label class="field">
              <span>A (m)</span>
              <input class="input" type="number" step="0.05" min="0" #atInput [value]="defaultCut()" />
            </label>
          </div>
          <label class="check"><input type="checkbox" #flipBox /> Mirar hacia el otro lado</label>
          <div class="row">
            <button type="button" class="btn btn-sm" (click)="setSection($any(axisSel.value), +atInput.value, flipBox.checked)">Trazar corte</button>
            @if (data.spec.section) {
              <button type="button" class="btn btn-ghost btn-sm" (click)="clearSection()">Quitar</button>
            }
          </div>
        </fieldset>

        <div class="downloads">
          <button type="button" class="btn btn-primary btn-sm" (click)="downloadPdf()" [disabled]="busy()"><app-icon name="download" /> Juego de planos (PDF)</button>
          <button type="button" class="btn btn-sm" (click)="downloadSvg()"><app-icon name="download" /> Lámina (SVG)</button>
          <button type="button" class="btn btn-sm" (click)="downloadDxf()"><app-icon name="download" /> CAD (DXF)</button>
        </div>
        <p class="muted fine">El DXF va en metros, con una capa por familia (muros, puertas, cotas...). Imprime el PDF a "tamaño real" para medir a escala.</p>
      </div>

      @if (expanded() && preview()) {
        <div class="overlay" role="dialog" aria-modal="true" [attr.aria-label]="titles[sheet()]" (click)="expanded.set(false)" (keydown.escape)="expanded.set(false)" tabindex="-1">
          <img [src]="preview()" [alt]="titles[sheet()]" />
          <button type="button" class="btn btn-sm close" (click)="expanded.set(false)">Cerrar</button>
        </div>
      }
    } @else {
      <p class="muted">El cuarto aún se está preparando.</p>
    }
  `,
  styles: `
    .stack {
      display: grid;
      gap: var(--space-3);
    }
    .field {
      display: grid;
      gap: 4px;
      font-size: var(--text-sm);
      flex: 1;
    }
    .row {
      display: flex;
      gap: var(--space-2);
      align-items: end;
    }
    .check {
      display: flex;
      gap: 6px;
      align-items: center;
      font-size: var(--text-sm);
    }
    fieldset {
      display: grid;
      gap: var(--space-2);
      margin: 0;
      padding: var(--space-2) var(--space-3) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius, 10px);
    }
    legend {
      font-weight: 600;
      padding: 0 4px;
    }
    .preview {
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius, 10px);
      background: #fff;
      cursor: zoom-in;
      overflow: hidden;
    }
    .preview img {
      display: block;
      width: 100%;
      height: auto;
    }
    .downloads {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .fine {
      margin: 0;
      font-size: var(--text-xs, 0.8rem);
    }
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgb(0 0 0 / 0.72);
      cursor: zoom-out;
    }
    .overlay img {
      max-width: 100%;
      max-height: 100%;
      background: #fff;
    }
    .overlay .close {
      position: absolute;
      top: 16px;
      right: 16px;
    }
  `,
})
export class DrawingsPanelComponent {
  private readonly store = inject(DesignProjectStore);
  private readonly api = inject(ProjectsApi);
  private readonly toast = inject(ToastService);

  protected readonly titles = SHEET_TITLES;
  protected readonly sheet = signal<SheetId>('architectural');
  protected readonly expanded = signal(false);
  protected readonly busy = signal(false);

  protected readonly input = computed<DrawingSetInput | null>(() => {
    const shell = this.store.shell();
    const project = this.store.project();
    if (!shell || !project) return null;
    return {
      shell,
      spec: this.store.technical(),
      pieces: this.store.designPieces(),
      finishes: this.store.finishes(),
      roomName: project.name,
      date: new Date().toISOString().slice(0, 10),
    };
  });

  protected readonly sheets = computed(() => {
    const input = this.input();
    return input ? availableSheets(input.spec) : [];
  });

  private readonly current = computed(() => {
    const input = this.input();
    if (!input) return null;
    const id = this.sheets().includes(this.sheet()) ? this.sheet() : 'architectural';
    return sheetFor(id, input);
  });

  protected readonly adjusted = computed(() => {
    const s = this.current();
    return s?.scaleAdjusted ? s.scale : null;
  });

  private readonly svg = computed(() => {
    const s = this.current();
    return s ? renderSvg(s) : null;
  });

  protected readonly preview = computed(() => {
    const svg = this.svg();
    return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  });

  protected readonly defaultCut = computed(() => {
    const shell = this.store.shell();
    if (!shell) return 0;
    const b = polygonBounds(roomPolygon(shell));
    return Math.round(((b.minZ + b.maxZ) / 2) * 100) / 100;
  });

  private get baseName(): string {
    return `planos-${fileSlug(this.store.project()?.name ?? 'cuarto')}`;
  }

  protected downloadSvg(): void {
    const svg = this.svg();
    if (svg) downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${this.baseName}-${this.sheet()}.svg`);
  }

  protected downloadDxf(): void {
    const input = this.input();
    if (!input) return;
    const dxf = renderDxf(viewFor(this.sheet(), input), { scale: input.spec.sheet.scale });
    // DXF R12 en Latin-1 (los caracteres de fuera ya vienen escapados).
    const bytes = Uint8Array.from(dxf, (ch) => ch.charCodeAt(0) & 0xff);
    downloadBlob(new Blob([bytes], { type: 'application/dxf' }), `${this.baseName}-${this.sheet()}.dxf`);
  }

  protected async downloadPdf(): Promise<void> {
    const project = this.store.project();
    if (!project) return;
    this.busy.set(true);
    try {
      downloadBlob(await this.api.drawingSetPdf(project.id), `${this.baseName}.pdf`);
    } catch {
      this.toast.error('No se pudo generar el juego de planos. Inténtalo de nuevo.');
    } finally {
      this.busy.set(false);
    }
  }

  protected setSection(axis: Axis, at: number, flip: boolean): void {
    const shell = this.store.shell();
    if (!shell || !Number.isFinite(at)) return;
    const b = polygonBounds(roomPolygon(shell));
    const [lo, hi] = axis === 'z' ? [b.minZ, b.maxZ] : [b.minX, b.maxX];
    if (at <= lo || at >= hi) {
      this.toast.error(`El corte debe pasar por dentro del cuarto (entre ${lo.toFixed(2)} y ${hi.toFixed(2)} m).`);
      return;
    }
    void this.save({ ...this.store.technical(), section: sectionAcross(b, axis, at, flip) }, 'section');
  }

  protected clearSection(): void {
    const { section: _drop, ...rest } = this.store.technical();
    void this.save(rest, 'architectural');
  }

  private async save(next: Parameters<DesignProjectStore['setTechnical']>[0], show: SheetId): Promise<void> {
    try {
      await this.store.setTechnical(next);
      this.sheet.set(show);
    } catch {
      this.toast.error('No se pudo guardar el corte.');
    }
  }
}
