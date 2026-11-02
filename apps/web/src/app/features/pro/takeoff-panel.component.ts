import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BASE_ACTIVITIES, computeTakeoff, PHASE_LABELS, takeoffCsv, WORK_PHASES, type TechnicalSpec, type Takeoff } from '@interiores/shared-types';
import { ProjectsApi } from '../../core/api/projects.api';
import { downloadBlob, fileSlug } from '../../core/ui/download';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { DesignProjectStore } from '../project/design-project.store';

/** Barras del cronograma en % del total de días (para pintarlas con CSS). */
export function ganttBars(t: Pick<Takeoff, 'schedule' | 'days'>): { label: string; left: number; width: number; days: number }[] {
  return t.schedule.map((s) => ({
    label: s.label,
    left: t.days ? (s.startDay / t.days) * 100 : 0,
    width: t.days ? Math.max(2, (s.days / t.days) * 100) : 0,
    days: s.days,
  }));
}

/**
 * Cantidades y presupuesto de obra: cómputo métrico del cuarto tal como está, líneas de APU por
 * fase con precios editables, AIU, total con el mobiliario, cronograma y lo que hay que comprar.
 */
@Component({
  selector: 'app-takeoff-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (takeoff(); as t) {
      <div class="stack">
        <dl class="totals">
          <div><dt>Obra (con AIU)</dt><dd>{{ money(t.works) }}</dd></div>
          <div><dt>Mobiliario</dt><dd>{{ money(t.furniture) }}</dd></div>
          <div class="grand"><dt>Total</dt><dd>{{ money(t.total) }}</dd></div>
        </dl>
        @if (t.budget.level !== 'none') {
          <p class="fine" [class.over]="t.budget.remaining < 0" role="status">
            {{ t.budget.remaining < 0 ? 'Se pasa del tope en ' + money(-t.budget.remaining) : 'Queda ' + money(t.budget.remaining) + ' del tope' }}
          </p>
        }
        @if (t.fx) {
          <p class="fine muted">{{ t.fx.rate ? 'Mobiliario en ' + t.fx.from + ' convertido a 1 ' + t.fx.from + ' = ' + t.fx.rate + ' ' + t.currency + '.' : 'No hay tasa para ' + t.fx.from + ': el mobiliario no se suma.' }}</p>
        }

        <details>
          <summary>Cómputo métrico</summary>
          <table class="q">
            <tbody>
              <tr><th>Piso</th><td>{{ n(t.quantities.floorM2) }} m²</td></tr>
              <tr><th>Muros netos (sin vanos)</th><td>{{ n(netWalls()) }} m²</td></tr>
              <tr><th>Cielo raso</th><td>{{ n(t.quantities.ceilingM2) }} m²</td></tr>
              <tr><th>Guardaescoba</th><td>{{ n(t.quantities.skirtingM) }} ml</td></tr>
              @if (t.quantities.partitionM2) {
                <tr><th>Tabiques nuevos</th><td>{{ n(t.quantities.partitionM2) }} m²</td></tr>
              }
              <tr><th>Ventanas</th><td>{{ t.quantities.windows.count }} · {{ n(t.quantities.windows.areaM2) }} m²</td></tr>
              @for (s of t.quantities.surfaces; track s.surface + s.materialId) {
                <tr><th>{{ surfaceLabel[s.surface] }}: {{ s.material.name }}</th><td>{{ n(s.areaM2) }} m²</td></tr>
              }
            </tbody>
          </table>
        </details>

        <section aria-label="Actividades de obra">
          @for (g of groups(); track g.phase) {
            <h4>{{ g.label }}</h4>
            <ul role="list">
              @for (l of g.lines; track l.code + (l.detail ?? '')) {
                <li class="line">
                  <span class="name">{{ l.name }}@if (l.detail) {<span class="muted"> · {{ l.detail }}</span>}</span>
                  <span class="calc">{{ n(l.quantity) }} {{ l.unit }} × {{ money(l.unitMaterial + l.unitLabor) }}{{ l.waste ? ' (+' + pct(l.waste) + ' desp.)' : '' }}</span>
                  <strong class="amount">{{ money(l.total) }}</strong>
                </li>
              }
            </ul>
          }
          <dl class="aiu">
            <div><dt>Costo directo</dt><dd>{{ money(t.direct) }}</dd></div>
            <div><dt>Administración</dt><dd>{{ money(t.aiu.administration) }}</dd></div>
            <div><dt>Imprevistos</dt><dd>{{ money(t.aiu.contingency) }}</dd></div>
            <div><dt>Utilidad</dt><dd>{{ money(t.aiu.profit) }}</dd></div>
          </dl>
        </section>

        <fieldset>
          <legend>Cronograma · {{ n(t.days) }} días</legend>
          @for (b of bars(); track b.label) {
            <div class="gantt">
              <span>{{ b.label }}</span>
              <div class="track"><i [style.left.%]="b.left" [style.width.%]="b.width" [attr.title]="b.days + ' días'"></i></div>
            </div>
          }
        </fieldset>

        <details>
          <summary>Materiales a comprar</summary>
          <ul role="list" class="buy">
            @for (p of t.purchases; track $index) {
              <li><span>{{ p.name }}</span><span class="muted">{{ p.packs }}</span></li>
            }
          </ul>
        </details>

        <details>
          <summary>Precios y AIU del proyecto</summary>
          <div class="grid3">
            <label class="field"><span>Administración %</span><input class="input" type="number" min="0" max="100" step="1" [value]="round(spec().rates.aiu.administration * 100)" (change)="setAiu('administration', $any($event.target).value)" /></label>
            <label class="field"><span>Imprevistos %</span><input class="input" type="number" min="0" max="100" step="1" [value]="round(spec().rates.aiu.contingency * 100)" (change)="setAiu('contingency', $any($event.target).value)" /></label>
            <label class="field"><span>Utilidad %</span><input class="input" type="number" min="0" max="100" step="1" [value]="round(spec().rates.aiu.profit * 100)" (change)="setAiu('profit', $any($event.target).value)" /></label>
          </div>
          <label class="field"><span>1 USD en {{ spec().rates.currency }}</span><input class="input" type="number" min="1" step="50" [value]="spec().rates.fx['USD'] ?? ''" (change)="setFx($any($event.target).value)" /></label>
          <p class="fine muted">Precio unitario de cada actividad (material / mano de obra). Vacío = el de referencia.</p>
          @for (code of codes(); track code) {
            <div class="rate">
              <span>{{ activities[code]!.name }} <span class="muted">({{ activities[code]!.unit }})</span></span>
              <input class="input" type="number" min="0" step="500" [attr.aria-label]="'Material de ' + activities[code]!.name" [value]="spec().rates.overrides[code]?.material ?? ''" [placeholder]="activities[code]!.rate.material" (change)="setRate(code, 'material', $any($event.target).value)" />
              <input class="input" type="number" min="0" step="500" [attr.aria-label]="'Mano de obra de ' + activities[code]!.name" [value]="spec().rates.overrides[code]?.labor ?? ''" [placeholder]="activities[code]!.rate.labor" (change)="setRate(code, 'labor', $any($event.target).value)" />
            </div>
          }
        </details>

        <div class="downloads">
          <button type="button" class="btn btn-primary btn-sm" (click)="downloadPdf()" [disabled]="busy()"><app-icon name="download" /> Presupuesto (PDF)</button>
          <button type="button" class="btn btn-sm" (click)="downloadCsv()"><app-icon name="download" /> Excel (CSV)</button>
        </div>
        <p class="fine muted">Precios de referencia en {{ t.currency }}, orientativos: ajústalos a tu zona. Cantidades con el desperdicio de cada dibujo.</p>
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
    .over {
      color: var(--danger);
      font-weight: 600;
    }
    dl {
      margin: 0;
      display: grid;
      gap: 2px;
    }
    dl div {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: var(--text-sm);
    }
    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
    .totals .grand {
      font-weight: 700;
      font-size: 1rem;
      border-top: 1px solid var(--border);
      padding-top: 4px;
    }
    .aiu {
      margin-top: 6px;
      color: var(--text-muted);
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      font-size: var(--text-sm);
      padding: 4px 0;
    }
    .q {
      width: 100%;
      font-size: var(--text-sm);
      border-collapse: collapse;
    }
    .q th {
      text-align: left;
      font-weight: 400;
      color: var(--text-muted);
    }
    .q td {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    h4 {
      margin: 8px 0 4px;
      font-size: var(--text-sm);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 4px;
    }
    .line {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0 8px;
      font-size: 0.84rem;
      padding: 4px 0;
      border-bottom: 1px dashed var(--border);
    }
    .line .calc {
      grid-column: 1;
      font-size: 0.78rem;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .line .amount {
      grid-column: 2;
      grid-row: 1 / span 2;
      align-self: center;
      font-variant-numeric: tabular-nums;
    }
    .muted {
      color: var(--text-muted);
    }
    fieldset {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: var(--space-2) var(--space-3) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius, 10px);
    }
    legend {
      font-weight: 600;
      padding: 0 4px;
    }
    .gantt {
      display: grid;
      grid-template-columns: 96px 1fr;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
    }
    .track {
      position: relative;
      height: 12px;
      background: var(--surface-2);
      border-radius: 6px;
    }
    .track i {
      position: absolute;
      top: 0;
      bottom: 0;
      border-radius: 6px;
      background: var(--primary);
    }
    .buy li {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.82rem;
    }
    .grid3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }
    .field {
      display: grid;
      gap: 4px;
      font-size: var(--text-xs, 0.8rem);
      margin-bottom: 6px;
    }
    .rate {
      display: grid;
      grid-template-columns: 1fr 84px 84px;
      gap: 6px;
      align-items: center;
      font-size: 0.8rem;
      margin-bottom: 4px;
    }
    .downloads {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class TakeoffPanelComponent {
  private readonly store = inject(DesignProjectStore);
  private readonly api = inject(ProjectsApi);
  private readonly toast = inject(ToastService);

  protected readonly activities = BASE_ACTIVITIES;
  protected readonly surfaceLabel = { floor: 'Piso', wall: 'Muros', ceiling: 'Cielo raso' } as const;
  protected readonly busy = signal(false);
  protected readonly spec = this.store.technical;

  protected readonly takeoff = computed<Takeoff | null>(() => {
    const shell = this.store.shell();
    if (!shell) return null;
    const catalog = this.store.catalog();
    const placements = this.store.placements();
    const priced = placements.map((p) => catalog.get(p.catalogItemId)).filter((i) => i?.price);
    return computeTakeoff({
      shell,
      finishes: this.store.finishes(),
      spec: this.spec(),
      furniture: { total: this.store.totalPrice(), pieces: placements.length, currency: priced[0]?.currency ?? 'USD' },
      budgetCap: this.store.budgetCap(),
    });
  });

  protected readonly netWalls = computed(() => this.takeoff()?.quantities.walls.reduce((s, w) => s + w.netM2, 0) ?? 0);
  protected readonly groups = computed(() => {
    const lines = this.takeoff()?.lines ?? [];
    return WORK_PHASES.map((phase) => ({ phase, label: PHASE_LABELS[phase], lines: lines.filter((l) => l.phase === phase) })).filter((g) => g.lines.length);
  });
  protected readonly bars = computed(() => {
    const t = this.takeoff();
    return t ? ganttBars(t) : [];
  });
  /** Actividades que aparecen en este cuarto (las únicas cuyo precio tiene sentido editar aquí). */
  protected readonly codes = computed(() => [...new Set((this.takeoff()?.lines ?? []).map((l) => l.code))]);

  protected money(v: number): string {
    const currency = this.takeoff()?.currency ?? 'COP';
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  }
  protected n(v: number): string {
    return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v);
  }
  protected pct(v: number): string {
    return `${Math.round(v * 100)} %`;
  }
  protected round(v: number): number {
    return Math.round(v * 10) / 10;
  }

  protected setAiu(key: keyof TechnicalSpec['rates']['aiu'], raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    const rates = this.spec().rates;
    void this.save({ ...this.spec(), rates: { ...rates, aiu: { ...rates.aiu, [key]: value / 100 } } });
  }

  protected setFx(raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    const rates = this.spec().rates;
    void this.save({ ...this.spec(), rates: { ...rates, fx: { ...rates.fx, USD: value } } });
  }

  protected setRate(code: string, part: 'material' | 'labor', raw: string): void {
    const rates = this.spec().rates;
    const base = BASE_ACTIVITIES[code]!.rate;
    const current = rates.overrides[code] ?? base;
    const overrides = { ...rates.overrides };
    const value = raw === '' ? base[part] : Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    const next = { ...current, [part]: value };
    if (next.material === base.material && next.labor === base.labor) delete overrides[code];
    else overrides[code] = next;
    void this.save({ ...this.spec(), rates: { ...rates, overrides } });
  }

  private async save(next: TechnicalSpec): Promise<void> {
    try {
      await this.store.setTechnical(next);
    } catch {
      this.toast.error('No se pudieron guardar los precios.');
    }
  }

  protected downloadCsv(): void {
    const t = this.takeoff();
    if (t) downloadBlob(new Blob([takeoffCsv(t)], { type: 'text/csv;charset=utf-8' }), `presupuesto-obra-${fileSlug(this.store.project()?.name ?? 'cuarto')}.csv`);
  }

  protected async downloadPdf(): Promise<void> {
    const project = this.store.project();
    if (!project) return;
    this.busy.set(true);
    try {
      downloadBlob(await this.api.takeoffPdf(project.id), `presupuesto-obra-${fileSlug(project.name)}.pdf`);
    } catch {
      this.toast.error('No se pudo generar el presupuesto. Inténtalo de nuevo.');
    } finally {
      this.busy.set(false);
    }
  }
}
