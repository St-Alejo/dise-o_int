import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { diffScenes, effectiveDimensions, footprint, type DesignProjectVersion, type FurniturePlacement, type RoomShell, type SceneSide } from '@interiores/shared-types';
import { DesignProjectStore } from './design-project.store';

interface MiniPlan {
  viewBox: string;
  outline: string;
  pieces: { id: string; points: string; mark: 'plain' | 'only' | 'moved' }[];
}

/**
 * Una versión guardada junto al diseño actual: las dos plantas lado a lado, con lo que solo está
 * en una resaltado, y la lista de lo que cambia. Para decidir si restaurarla sin tener que hacerlo.
 */
@Component({
  selector: 'app-version-compare',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="plans">
      @for (side of sides(); track side.title) {
        <figure>
          <figcaption>{{ side.title }} <span class="muted">· {{ side.count }} muebles</span></figcaption>
          @if (side.plan; as plan) {
            <svg [attr.viewBox]="plan.viewBox" role="img" [attr.aria-label]="'Planta de ' + side.title">
              <polygon class="room" [attr.points]="plan.outline" />
              @for (piece of plan.pieces; track piece.id) {
                <polygon [attr.points]="piece.points" [class]="'piece ' + piece.mark" />
              }
            </svg>
          } @else {
            <p class="muted">Sin planta.</p>
          }
        </figure>
      }
    </div>
    @if (diff().same) {
      <p class="summary">Esta versión es igual al diseño actual.</p>
    } @else {
      <ul class="summary" aria-label="Qué cambiaría al restaurarla">
        @for (line of lines(); track line) {
          <li>{{ line }}</li>
        }
      </ul>
      <p class="muted fine legend"><span class="key only"></span> solo en ese lado <span class="key moved"></span> en otro sitio</p>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-3);
    }
    .plans {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4);
    }
    figure {
      margin: 0;
      display: grid;
      gap: var(--space-2);
    }
    figcaption {
      font-weight: 600;
    }
    svg {
      width: 100%;
      height: auto;
      max-height: 240px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
    }
    .room {
      fill: var(--surface);
      stroke: var(--text);
      stroke-width: 0.06;
    }
    .piece {
      fill: var(--surface-2);
      stroke: var(--text-muted);
      stroke-width: 0.025;
    }
    .piece.only {
      fill: var(--accent-soft);
      stroke: var(--accent);
      stroke-width: 0.05;
    }
    .piece.moved {
      fill: var(--primary-soft);
      stroke: var(--primary);
      stroke-width: 0.05;
    }
    .summary {
      margin: 0;
      padding-left: 1.1em;
    }
    p.summary {
      padding-left: 0;
    }
    .legend {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
    }
    .key {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 3px;
      border: 1.5px solid;
      margin-left: 8px;
    }
    .key.only {
      background: var(--accent-soft);
      border-color: var(--accent);
    }
    .key.moved {
      background: var(--primary-soft);
      border-color: var(--primary);
    }
    @media (max-width: 560px) {
      .plans {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class VersionCompareComponent {
  readonly version = input.required<DesignProjectVersion>();
  private readonly store = inject(DesignProjectStore);

  private readonly current = computed<SceneSide>(() => ({ roomShell: this.store.shell(), furniturePlacements: this.store.placements(), finishes: this.store.finishes() }));
  /** De la versión al diseño actual: lo "añadido" es lo que hoy hay de más. */
  protected readonly diff = computed(() => diffScenes(this.version(), this.current()));

  protected readonly sides = computed(() => {
    const diff = this.diff();
    const version = this.version();
    const current = this.current();
    const moved = new Set(diff.moved.map((p) => p.id));
    return [
      { title: `Versión ${version.number}`, count: version.furniturePlacements.length, plan: this.plan(version.roomShell, version.furniturePlacements, new Set(diff.removed.map((p) => p.id)), moved) },
      { title: 'Ahora', count: current.furniturePlacements.length, plan: this.plan(current.roomShell, current.furniturePlacements, new Set(diff.added.map((p) => p.id)), moved) },
    ];
  });

  protected readonly lines = computed(() => {
    const diff = this.diff();
    const names = (pieces: readonly FurniturePlacement[]) => {
      const list = pieces.map((p) => this.store.catalog().get(p.catalogItemId)?.name ?? 'un mueble');
      return list.length > 3 ? `${list.slice(0, 3).join(', ')} y ${list.length - 3} más` : list.join(', ');
    };
    const lines: string[] = [];
    // Restaurar lleva de "ahora" a la versión: lo que hoy sobra se va y lo que falta vuelve.
    if (diff.removed.length) lines.push(`Volverían ${diff.removed.length}: ${names(diff.removed)}.`);
    if (diff.added.length) lines.push(`Se irían ${diff.added.length}: ${names(diff.added)}.`);
    if (diff.moved.length) lines.push(`Cambiarían de sitio ${diff.moved.length}: ${names(diff.moved)}.`);
    if (diff.changed.length) lines.push(`Cambiarían de medidas o material ${diff.changed.length}: ${names(diff.changed)}.`);
    if (diff.roomChanged) lines.push('La planta del cuarto es distinta.');
    if (diff.finishesChanged) lines.push('Los acabados (piso, paredes o techo) son distintos.');
    return lines;
  });

  private plan(shell: RoomShell | null, placements: readonly FurniturePlacement[], only: ReadonlySet<string>, moved: ReadonlySet<string>): MiniPlan | null {
    if (!shell) return null;
    const xs = shell.walls.flatMap((w) => [w.start.x, w.end.x]);
    const zs = shell.walls.flatMap((w) => [w.start.z, w.end.z]);
    const pad = 0.2;
    const catalog = this.store.catalog();
    const round = (v: number) => Math.round(v * 1000) / 1000;
    return {
      viewBox: [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...zs) - Math.min(...zs) + pad * 2].map(round).join(' '),
      outline: shell.walls.map((w) => `${round(w.start.x)},${round(w.start.z)}`).join(' '),
      pieces: placements.flatMap((p) => {
        const item = catalog.get(p.catalogItemId);
        if (!item || item.mount !== 'floor' || p.supportId) return [];
        const corners = footprint(p.position, effectiveDimensions(item.dimensionsM, p), p.rotationY).corners;
        const mark = only.has(p.id) ? ('only' as const) : moved.has(p.id) ? ('moved' as const) : ('plain' as const);
        return [{ id: p.id, points: corners.map((c) => `${round(c.x)},${round(c.z)}`).join(' '), mark }];
      }),
    };
  }
}
