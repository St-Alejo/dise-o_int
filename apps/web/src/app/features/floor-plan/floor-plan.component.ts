import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RoomShell } from '@interiores/shared-types';
import { floorPlanOf, type PlanFootprint } from './floor-plan-model';

/**
 * Plano 2D del cuarto en SVG: contorno, paredes con su cota, puertas con su arco de apertura,
 * ventanas y, si se pasan, los muebles. Solo dibuja: toda la geometría sale de `floorPlanOf`.
 */
@Component({
  selector: 'app-floor-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="plan().viewBox" role="img" [attr.aria-label]="plan().summary" preserveAspectRatio="xMidYMid meet">
      <polygon class="floor" [attr.points]="plan().outline" />
      @for (item of plan().items; track item.id) {
        <polygon class="item" [attr.points]="item.points" />
      }
      @for (wall of plan().walls; track wall.id) {
        <line class="wall" [attr.x1]="wall.from.x" [attr.y1]="wall.from.y" [attr.x2]="wall.to.x" [attr.y2]="wall.to.y" />
      }
      @for (o of plan().openings; track o.id) {
        <line [attr.class]="o.type" [attr.x1]="o.from.x" [attr.y1]="o.from.y" [attr.x2]="o.to.x" [attr.y2]="o.to.y" />
        @if (o.swing) {
          <path class="swing" [attr.d]="o.swing" />
        }
      }
      @if (showDimensions()) {
        @for (wall of plan().walls; track wall.id) {
          <text class="dim" [attr.x]="wall.label.x" [attr.y]="wall.label.y" [attr.text-anchor]="wall.label.anchor">{{ wall.label.text }}</text>
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .floor {
      fill: var(--surface-2);
    }
    .wall {
      stroke: var(--text);
      stroke-width: 0.1;
      stroke-linecap: square;
    }
    /* El vano de la puerta "borra" la pared; la ventana la aclara. */
    .door {
      stroke: var(--surface-2);
      stroke-width: 0.12;
    }
    .window {
      stroke: var(--accent);
      stroke-width: 0.06;
    }
    .swing {
      fill: none;
      stroke: var(--text-muted);
      stroke-width: 0.025;
      stroke-dasharray: 0.08 0.06;
    }
    .item {
      fill: color-mix(in srgb, var(--primary) 22%, transparent);
      stroke: var(--primary);
      stroke-width: 0.025;
    }
    .dim {
      fill: var(--text-muted);
      font-size: 0.22px;
      dominant-baseline: middle;
    }
  `,
})
export class FloorPlanComponent {
  readonly shell = input.required<RoomShell>();
  /** Huellas de los muebles a dibujar sobre el plano. */
  readonly footprints = input<readonly PlanFootprint[]>([]);
  readonly showDimensions = input(true);

  protected readonly plan = computed(() => floorPlanOf(this.shell(), this.footprints()));
}
