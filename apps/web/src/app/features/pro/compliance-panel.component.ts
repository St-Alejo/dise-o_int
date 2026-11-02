import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  COMPLIANCE_GROUPS,
  footprint,
  GROUP_TITLES,
  luxColor,
  polygonBounds,
  roomPolygon,
  type ComplianceFinding,
  type ComplianceStatus,
  type IlluminanceGrid,
} from '@interiores/shared-types';
import { ProjectsApi } from '../../core/api/projects.api';
import { downloadBlob, fileSlug } from '../../core/ui/download';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { DesignProjectStore } from '../project/design-project.store';
import { ComplianceService } from './compliance.service';

const STATUS_LABELS: Record<ComplianceStatus, string> = { fail: 'No cumple', warn: 'Aviso', pass: 'Cumple', na: 'No aplica' };

type LightMode = 'artificial' | 'daylight';

/** Mapa de calor de una rejilla de luz, listo para pintar en SVG (coordenadas en metros). */
export function heatmapCells(grid: IlluminanceGrid, targetLux: number): { x: number; y: number; size: number; fill: string; lux: number }[] {
  return grid.cells.map((c) => ({ x: c.x - grid.stepM / 2, y: c.z - grid.stepM / 2, size: grid.stepM, fill: luxColor(c.lux, targetLux), lux: Math.round(c.lux) }));
}

/**
 * Normativa y ergonomía: cada regla del perfil elegido con lo medido y lo exigido, agrupadas, y el
 * mapa de luz del cuarto (de noche con las lámparas, o de día a la hora elegida). Al pulsar un
 * hallazgo se selecciona el mueble implicado.
 */
@Component({
  selector: 'app-compliance-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (svc.report(); as report) {
      <div class="stack">
        <p class="fine muted">{{ report.profile.name }}{{ report.accessible ? ' · con accesibilidad' : '' }}. Cámbialo en la ficha técnica.</p>
        <div class="summary" role="status">
          <span class="chip s-fail">{{ report.summary.fail }} no cumplen</span>
          <span class="chip s-warn">{{ report.summary.warn }} avisos</span>
          <span class="chip s-pass">{{ report.summary.pass }} cumplen</span>
        </div>

        <fieldset>
          <legend>Mapa de luz</legend>
          <div class="seg" role="radiogroup" aria-label="Qué luz mostrar">
            <button type="button" role="radio" [attr.aria-checked]="mode() === 'artificial'" [class.on]="mode() === 'artificial'" (click)="mode.set('artificial')">De noche (lámparas)</button>
            <button type="button" role="radio" [attr.aria-checked]="mode() === 'daylight'" [class.on]="mode() === 'daylight'" (click)="mode.set('daylight')">De día</button>
          </div>
          @if (mode() === 'daylight') {
            <label class="field">
              <span>Hora solar: {{ svc.hour() }}:00</span>
              <input type="range" min="6" max="18" step="1" [value]="svc.hour()" (input)="svc.hour.set(+$any($event.target).value)" />
            </label>
          }
          @if (map(); as m) {
            <svg class="heat" [attr.viewBox]="m.viewBox" role="img" [attr.aria-label]="m.label">
              @for (c of m.cells; track $index) {
                <rect [attr.x]="c.x" [attr.y]="c.y" [attr.width]="c.size + 0.005" [attr.height]="c.size + 0.005" [attr.fill]="c.fill"><title>{{ c.lux }} lx</title></rect>
              }
              @for (p of m.furniture; track $index) {
                <polygon [attr.points]="p" class="furn" />
              }
              <polygon [attr.points]="m.outline" class="outline" />
              @for (l of m.lamps; track $index) {
                <circle [attr.cx]="l.x" [attr.cy]="l.z" r="0.09" class="lamp" />
              }
            </svg>
            <p class="fine">Media {{ m.avg }} lx · mínima {{ m.min }} lx · objetivo {{ report.targetLux }} lx{{ mode() === 'daylight' ? ' · factor de luz diurna ' + daylightPct() : '' }}</p>
            <div class="legend" aria-hidden="true"><span>0</span><i [style.background]="legendGradient()"></i><span>{{ report.targetLux }} lx</span></div>
          }
        </fieldset>

        @for (g of groups(); track g.id) {
          <section [attr.aria-label]="g.title">
            <h4>{{ g.title }}</h4>
            <ul role="list">
              @for (f of g.items; track f.id) {
                <li>
                  <button type="button" [class]="'finding s-' + f.status" (click)="open(f)" [disabled]="!f.placementIds.length">
                    <span class="tag">{{ labels[f.status] }}</span>
                    <strong>{{ f.title }}</strong>
                    @if (f.measured || f.required) {
                      <span class="values">
                        @if (f.measured) {
                          <span>Medido: {{ f.measured }}</span>
                        }
                        @if (f.required) {
                          <span>Exigido: {{ f.required }}</span>
                        }
                      </span>
                    }
                    <span class="muted">{{ f.detail }}</span>
                    <span class="ref">{{ f.reference }}</span>
                  </button>
                </li>
              }
            </ul>
          </section>
        }

        <button type="button" class="btn btn-sm" (click)="downloadPdf()" [disabled]="busy()"><app-icon name="download" /> Informe de normativa (PDF)</button>
        <p class="fine muted">{{ report.disclaimer }}</p>
      </div>
    } @else {
      <p class="muted">El cuarto aún se está preparando.</p>
    }
  `,
  styles: `
    .stack {
      display: grid;
      gap: var(--space-3);
    }
    .fine {
      margin: 0;
      font-size: var(--text-xs, 0.8rem);
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      padding: 2px 10px;
      border-radius: 999px;
      font-size: var(--text-xs, 0.8rem);
      font-weight: 600;
      background: var(--surface-2);
    }
    .chip.s-fail {
      color: var(--danger);
    }
    .chip.s-warn {
      color: var(--warning);
    }
    .chip.s-pass {
      color: var(--success);
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
    .seg {
      display: flex;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .seg button {
      flex: 1;
      padding: 6px 8px;
      border: 0;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: var(--text-sm);
      cursor: pointer;
    }
    .seg button.on {
      background: var(--primary-soft);
      color: var(--primary-strong);
      font-weight: 600;
    }
    .field {
      display: grid;
      gap: 4px;
      font-size: var(--text-sm);
    }
    .heat {
      width: 100%;
      height: auto;
      max-height: 260px;
      background: var(--surface-2);
      border-radius: 8px;
    }
    .heat .outline {
      fill: none;
      stroke: #111;
      stroke-width: 0.05;
    }
    .heat .furn {
      fill: rgb(255 255 255 / 0.18);
      stroke: rgb(0 0 0 / 0.55);
      stroke-width: 0.02;
    }
    .heat .lamp {
      fill: #fff;
      stroke: #111;
      stroke-width: 0.02;
    }
    .legend {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: var(--text-xs, 0.8rem);
    }
    .legend i {
      flex: 1;
      height: 8px;
      border-radius: 4px;
    }
    h4 {
      margin: 0 0 6px;
      font-size: var(--text-sm);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .finding {
      width: 100%;
      display: grid;
      gap: 2px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-left-width: 4px;
      border-radius: 10px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      font-size: 0.86rem;
      text-align: left;
      cursor: pointer;
    }
    .finding:disabled {
      cursor: default;
    }
    .finding:hover:not(:disabled) {
      background: var(--surface-2);
    }
    .s-fail {
      border-left-color: var(--danger);
    }
    .s-warn {
      border-left-color: var(--warning);
    }
    .s-pass {
      border-left-color: var(--success);
    }
    .s-na {
      border-left-color: var(--border);
    }
    .tag {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .values {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
    }
    .muted {
      font-size: 0.8rem;
    }
    .ref {
      font-size: 0.72rem;
      color: var(--text-muted);
    }
  `,
})
export class CompliancePanelComponent {
  protected readonly svc = inject(ComplianceService);
  private readonly store = inject(DesignProjectStore);
  private readonly api = inject(ProjectsApi);
  private readonly toast = inject(ToastService);

  protected readonly labels = STATUS_LABELS;
  protected readonly mode = signal<LightMode>('artificial');
  protected readonly busy = signal(false);

  protected readonly groups = computed(() => {
    const findings = this.svc.report()?.findings ?? [];
    return COMPLIANCE_GROUPS.map((id) => ({ id, title: GROUP_TITLES[id], items: findings.filter((f) => f.group === id) })).filter((g) => g.items.length);
  });

  protected readonly daylightPct = computed(() => `${(this.svc.report()?.daylight.factorPct ?? 0).toFixed(1).replace('.', ',')} %`);

  protected readonly legendGradient = computed(() => {
    const target = this.svc.report()?.targetLux ?? 1;
    return `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => luxColor(t * target, target)).join(', ')})`;
  });

  protected readonly map = computed(() => {
    const report = this.svc.report();
    const shell = this.store.shell();
    if (!report || !shell) return null;
    const grid = this.mode() === 'artificial' ? report.lighting : report.daylight.grid;
    const room = roomPolygon(shell);
    const b = polygonBounds(room);
    const pad = 0.15;
    const pts = (ps: readonly { x: number; z: number }[]) => ps.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(' ');
    const pieces = this.store.designPieces();
    return {
      viewBox: `${b.minX - pad} ${b.minZ - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxZ - b.minZ + 2 * pad}`,
      label: `Mapa de luz ${this.mode() === 'artificial' ? 'de las lámparas' : 'natural'}: media ${Math.round(grid.avgLux)} lux`,
      cells: heatmapCells(grid, report.targetLux),
      outline: pts(room),
      furniture: pieces.filter((p) => p.mount === 'floor' && !p.supportId && p.subcategory !== 'rug').map((p) => pts(footprint(p.position, p.dims, p.rotationY).corners)),
      lamps: this.mode() === 'artificial' ? pieces.filter((p) => p.category === 'lighting').map((p) => ({ x: p.position.x, z: p.position.z })) : [],
      avg: Math.round(grid.avgLux),
      min: Math.round(grid.minLux),
    };
  });

  protected open(f: ComplianceFinding): void {
    const id = f.placementIds[0];
    if (id) this.store.select(id);
  }

  protected async downloadPdf(): Promise<void> {
    const project = this.store.project();
    if (!project) return;
    this.busy.set(true);
    try {
      downloadBlob(await this.api.compliancePdf(project.id), `normativa-${fileSlug(project.name)}.pdf`);
    } catch {
      this.toast.error('No se pudo generar el informe. Inténtalo de nuevo.');
    } finally {
      this.busy.set(false);
    }
  }
}
