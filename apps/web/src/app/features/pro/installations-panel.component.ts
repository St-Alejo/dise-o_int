import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  assignCircuits,
  clearProposed,
  elevationLabel,
  INSTALLATION_INFO,
  INSTALLATION_KINDS,
  isElectrical,
  loadSchedule,
  proposeInstallations,
  type InstallationKind,
  type InstallationPoint,
  type InstallationsSpec,
  type RoomShell,
} from '@interiores/shared-types';
import { ToastService } from '../../core/ui/toast.service';
import { DesignProjectStore } from '../project/design-project.store';

export interface PointRow {
  id: string;
  kind: InstallationKind;
  label: string;
  where: string;
  height: string;
  circuit: string;
  auto: boolean;
}

const m = (v: number) => v.toFixed(2).replace('.', ',');

/** Filas de la tabla de puntos de una familia, en el orden de la ficha. */
export function pointRows(shell: Pick<RoomShell, 'walls'>, spec: InstallationsSpec, family: 'electrical' | 'plumbing'): PointRow[] {
  return spec.points
    .filter((p) => isElectrical(p.kind) === (family === 'electrical'))
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      label: INSTALLATION_INFO[p.kind].label,
      where: p.wallId ? `${elevationLabel(shell, p.wallId)} · a ${m(p.offsetM ?? 0)} m` : p.at ? `en planta (${m(p.at.x)}; ${m(p.at.z)})` : '—',
      height: `${m(p.heightM)} m`,
      circuit: p.circuitId ?? '',
      auto: !!p.auto,
    }));
}

/** Quita un punto (y lo que lo nombra en los interruptores) y vuelve a repartir circuitos. */
export function removePoint(spec: InstallationsSpec, id: string): InstallationsSpec {
  const points = spec.points
    .filter((p) => p.id !== id)
    .map((p) => (p.controls?.includes(id) ? { ...p, controls: p.controls.filter((c) => c !== id) } : p));
  return assignCircuits({ ...spec, points });
}

/** Añade un punto puesto a mano en una pared, con la altura típica de su tipo si no se da. */
export function addPoint(spec: InstallationsSpec, point: Omit<InstallationPoint, 'id'>): InstallationsSpec {
  let n = spec.points.length + 1;
  while (spec.points.some((p) => p.id === `p-${n}`)) n++;
  return assignCircuits({ ...spec, points: [...spec.points, { ...point, id: `p-${n}` }] });
}

/**
 * Instalaciones eléctricas e hidrosanitarias: propuesta automática según los muebles, puntos por
 * familia (borrar o añadir a mano), circuitos y cuadro de cargas. Los planos salen en "Planos técnicos".
 */
@Component({
  selector: 'app-installations-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shell(); as s) {
      <div class="stack">
        <div class="actions">
          <button type="button" class="btn btn-primary btn-sm" (click)="propose()" [disabled]="busy()">Proponer instalaciones</button>
          @if (autoCount()) {
            <button type="button" class="btn btn-sm" (click)="clear()" [disabled]="busy()">Quitar propuestas ({{ autoCount() }})</button>
          }
        </div>
        <p class="fine muted">Tomas por el perímetro y junto a los muebles, GFCI cerca del agua, interruptor junto a la puerta y los puntos de agua de cada aparato. Lo que pongas a mano se respeta.</p>

        @for (f of families; track f.id) {
          <section [attr.aria-label]="f.title">
            <h4>{{ f.title }} · {{ rows()[f.id].length }}</h4>
            @if (rows()[f.id].length) {
              <ul role="list">
                @for (r of rows()[f.id]; track r.id) {
                  <li class="pt">
                    <span class="name">{{ r.label }}@if (r.circuit) {<span class="muted"> · {{ r.circuit }}</span>}@if (!r.auto) {<span class="tag">a mano</span>}</span>
                    <span class="muted where">{{ r.where }} · h {{ r.height }}</span>
                    <button type="button" class="btn btn-ghost btn-sm del" [attr.aria-label]="'Quitar ' + r.label + ' ' + r.where" (click)="remove(r.id)" [disabled]="busy()">✕</button>
                  </li>
                }
              </ul>
            } @else {
              <p class="fine muted">Sin puntos.</p>
            }
          </section>
        }

        <details>
          <summary>Añadir un punto a mano</summary>
          <div class="add">
            <label class="field"><span>Tipo</span>
              <select class="input" [value]="newKind()" (change)="newKind.set($any($event.target).value)" aria-label="Tipo de punto">
                @for (k of kinds; track k) {
                  <option [value]="k">{{ info[k].label }}</option>
                }
              </select>
            </label>
            <label class="field"><span>Pared</span>
              <select class="input" [value]="newWall()" (change)="newWall.set($any($event.target).value)" aria-label="Pared del punto">
                @for (w of s.walls; track w.id) {
                  <option [value]="w.id">{{ wallName(s, w.id) }}</option>
                }
              </select>
            </label>
            <label class="field"><span>Desde el inicio (m)</span><input class="input" type="number" min="0" step="0.05" [value]="newOffset()" (change)="newOffset.set(+$any($event.target).value)" /></label>
            <label class="field"><span>Altura (m)</span><input class="input" type="number" min="0" step="0.05" [value]="newHeight() ?? info[newKind()].heightM" (change)="newHeight.set(+$any($event.target).value)" /></label>
          </div>
          <button type="button" class="btn btn-sm" (click)="add()" [disabled]="busy()">Añadir punto</button>
        </details>

        @if (schedule(); as sc) {
          @if (sc.rows.length) {
            <fieldset>
              <legend>Cuadro de cargas · {{ sc.voltage }} V</legend>
              <table class="q">
                <thead><tr><th>Circuito</th><th>Salidas</th><th>VA</th><th>Uso</th><th>Prot.</th><th>AWG</th></tr></thead>
                <tbody>
                  @for (r of sc.rows; track r.circuit.id) {
                    <tr [class.bad]="!r.ok">
                      <th>{{ r.circuit.id }} {{ r.circuit.name }}</th>
                      <td>{{ r.points }}</td>
                      <td>{{ round(r.va) }}</td>
                      <td>{{ round(r.usage * 100) }} %</td>
                      <td>{{ r.circuit.breakerA }} A</td>
                      <td>{{ r.awg }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <dl>
                <div><dt>Carga instalada</dt><dd>{{ round(sc.installedVa) }} VA</dd></div>
                <div><dt>Demanda (NTC 2050)</dt><dd>{{ round(sc.demandVa) }} VA · {{ sc.demandAmps.toFixed(1).replace('.', ',') }} A</dd></div>
                <div class="grand"><dt>Totalizador sugerido</dt><dd>{{ sc.mainBreakerA }} A</dd></div>
              </dl>
            </fieldset>
          }
        }
        <p class="fine muted">Orientativo: el diseño eléctrico definitivo lo firma un profesional con matrícula (RETIE).</p>
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
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .fine {
      margin: 0;
      font-size: var(--text-xs, 0.8rem);
    }
    .muted {
      color: var(--text-muted);
    }
    h4 {
      margin: 0 0 4px;
      font-size: var(--text-sm);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 2px;
    }
    .pt {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0 8px;
      font-size: 0.82rem;
      padding: 3px 0;
      border-bottom: 1px dashed var(--border);
    }
    .pt .where {
      grid-column: 1;
      font-size: 0.76rem;
    }
    .pt .del {
      grid-column: 2;
      grid-row: 1 / span 2;
      align-self: center;
    }
    .tag {
      margin-left: 6px;
      font-size: 0.7rem;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--surface-2);
    }
    .add {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin: 6px 0;
    }
    .field {
      display: grid;
      gap: 4px;
      font-size: var(--text-xs, 0.8rem);
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      font-size: var(--text-sm);
      padding: 4px 0;
    }
    fieldset {
      margin: 0;
      padding: var(--space-2) var(--space-3) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius, 10px);
    }
    legend {
      font-weight: 600;
      padding: 0 4px;
    }
    .q {
      width: 100%;
      font-size: 0.78rem;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    .q th,
    .q td {
      text-align: right;
      padding: 2px 4px;
    }
    .q th:first-child,
    .q thead th:first-child {
      text-align: left;
      font-weight: 400;
    }
    .q .bad {
      color: var(--danger);
      font-weight: 600;
    }
    dl {
      margin: 8px 0 0;
      display: grid;
      gap: 2px;
    }
    dl div {
      display: flex;
      justify-content: space-between;
      font-size: var(--text-sm);
    }
    dd {
      margin: 0;
    }
    .grand {
      font-weight: 700;
    }
  `,
})
export class InstallationsPanelComponent {
  private readonly store = inject(DesignProjectStore);
  private readonly toast = inject(ToastService);

  protected readonly info = INSTALLATION_INFO;
  protected readonly kinds = INSTALLATION_KINDS;
  protected readonly families = [
    { id: 'electrical', title: 'Eléctricas' },
    { id: 'plumbing', title: 'Hidrosanitarias' },
  ] as const;
  protected readonly busy = signal(false);
  protected readonly shell = this.store.shell;
  private readonly spec = computed(() => this.store.technical().installations);

  protected readonly newKind = signal<InstallationKind>('outlet');
  protected readonly newWall = signal('');
  protected readonly newOffset = signal(0.5);
  protected readonly newHeight = signal<number | null>(null);

  protected readonly rows = computed(() => {
    const shell = this.shell();
    const spec = this.spec();
    return shell ? { electrical: pointRows(shell, spec, 'electrical'), plumbing: pointRows(shell, spec, 'plumbing') } : { electrical: [], plumbing: [] };
  });
  protected readonly autoCount = computed(() => this.spec().points.filter((p) => p.auto).length);
  protected readonly schedule = computed(() => loadSchedule(this.spec()));

  protected readonly wallName = elevationLabel;
  protected readonly round = Math.round;

  protected propose(): void {
    const shell = this.shell();
    const project = this.store.project();
    if (!shell || !project) return;
    const next = proposeInstallations({ shell, pieces: this.store.designPieces(), roomType: project.roomType, installations: this.spec() });
    void this.save(next, `${next.points.filter((p) => p.auto).length} puntos propuestos.`);
  }

  protected clear(): void {
    void this.save(clearProposed(this.spec()), 'Propuesta quitada.');
  }

  protected remove(id: string): void {
    void this.save(removePoint(this.spec(), id));
  }

  protected add(): void {
    const shell = this.shell();
    if (!shell) return;
    const wallId = this.newWall() || shell.walls[0]?.id;
    if (!wallId) return;
    const kind = this.newKind();
    void this.save(addPoint(this.spec(), { kind, wallId, offsetM: Math.max(0, this.newOffset()), heightM: this.newHeight() ?? INSTALLATION_INFO[kind].heightM }), 'Punto añadido.');
  }

  private async save(installations: InstallationsSpec, done?: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.store.setTechnical({ ...this.store.technical(), installations });
      if (done) this.toast.success(done);
    } catch {
      this.toast.error('No se pudieron guardar las instalaciones. Inténtalo de nuevo.');
    } finally {
      this.busy.set(false);
    }
  }
}
