import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { RoomPlan, effectiveDimensions, footprint, type Point2 } from '@interiores/shared-types';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';
import { SceneService } from '../viewport-3d/scene.service';
import { captionFor, clearancesOf, floorPlanOf, metres } from './floor-plan-model';
import { RoomActionsComponent } from './room-actions.component';
import {
  MeasureGesture,
  MoveItemGesture,
  MoveOpeningGesture,
  MoveVertexGesture,
  MoveWallGesture,
  draggableInPlan,
  type PlanGesture,
  type PlanPreview,
} from './plan-gestures';

export type PlanTool = 'select' | 'room' | 'measure';

interface ToolInfo {
  id: PlanTool;
  label: string;
  hint: string;
}

const TOOLS: readonly ToolInfo[] = [
  { id: 'select', label: 'Mover muebles', hint: 'Arrastra un mueble: se alinea con los demás y se pega a las paredes.' },
  { id: 'room', label: 'Editar paredes', hint: 'Arrastra una pared, una esquina, una puerta o una ventana. Ctrl+Z deshace.' },
  { id: 'measure', label: 'Medir', hint: 'Arrastra entre dos puntos para medir la distancia.' },
];

interface PlanPiece {
  id: string;
  name: string;
  points: string;
  corners: readonly Point2[];
  selected: boolean;
  movable: boolean;
  centre: Point2;
  /** Nombre recortado para que quepa dentro de la huella ('' si no cabe). */
  caption: string;
}

/**
 * Plano editable del cuarto: los muebles se arrastran con guías de alineación y cotas hasta las
 * paredes, y las paredes, esquinas y aberturas se mueven con deshacer. Comparte el estado con el
 * visor 3D (mismo store, mismos comandos): lo que se hace aquí se ve allí al instante.
 */
@Component({
  selector: 'app-plan-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoomActionsComponent],
  template: `
    <div class="bar">
      <div class="tools" role="group" aria-label="Herramientas del plano">
        @for (t of tools; track t.id) {
          <button type="button" class="tool" [attr.aria-pressed]="tool() === t.id" (click)="setTool(t.id)">{{ t.label }}</button>
        }
      </div>
      @if (area(); as a) {
        <span class="area" title="Superficie del piso">{{ a }}</span>
      }
    </div>

    @if (tool() === 'room') {
      <app-room-actions />
    }

    @if (plan(); as plan) {
      <svg
        #svg
        [attr.viewBox]="viewBox()"
        [class]="'tool-' + tool()"
        [class.busy]="active()"
        role="group"
        [attr.aria-label]="plan.summary"
        preserveAspectRatio="xMidYMid meet"
        (pointerdown)="onBackground($event)"
        (pointermove)="onMove($event)"
        (pointerup)="onUp($event)"
        (pointercancel)="onUp($event)"
        (keydown)="onKey($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="ghostAt.set(null)"
        (drop)="onDrop($event)"
      >
        <g [attr.transform]="shiftTransform()" [attr.font-size]="fontM()">
          <polygon class="floor" [attr.points]="plan.outline" />

          @for (piece of pieces(); track piece.id) {
            <polygon
              class="item"
              [class.selected]="piece.selected"
              [class.invalid]="piece.selected && preview().invalid"
              [class.fixed]="!piece.movable"
              [attr.points]="piece.points"
              tabindex="0"
              role="button"
              [attr.aria-label]="piece.name"
              [attr.aria-pressed]="piece.selected"
              (focus)="onFocus(piece.id)"
              (pointerdown)="onItem($event, piece.id)"
            />
            @if (piece.caption) {
              <text class="caption" [attr.x]="piece.centre.x" [attr.y]="piece.centre.z" text-anchor="middle">{{ piece.caption }}</text>
            }
          }

          @for (wall of plan.walls; track wall.id) {
            <line class="wall" [attr.x1]="wall.from.x" [attr.y1]="wall.from.y" [attr.x2]="wall.to.x" [attr.y2]="wall.to.y" />
          }
          @for (o of plan.openings; track o.id) {
            <line [attr.class]="o.type" [attr.x1]="o.from.x" [attr.y1]="o.from.y" [attr.x2]="o.to.x" [attr.y2]="o.to.y" />
            @if (o.swing) {
              <path class="swing" [attr.d]="o.swing" />
            }
          }

          @if (tool() === 'room') {
            @for (wall of plan.walls; track wall.id) {
              <line class="grip wall-grip" [class.chosen]="chosen('wall', wall.id)" [attr.x1]="wall.from.x" [attr.y1]="wall.from.y" [attr.x2]="wall.to.x" [attr.y2]="wall.to.y" (pointerdown)="onWall($event, wall.id)">
                <title>Arrastra para mover esta pared ({{ wall.label.text }})</title>
              </line>
            }
            @for (o of plan.openings; track o.id) {
              <line class="grip opening-grip" [class.chosen]="chosen('opening', o.id)" [attr.x1]="o.from.x" [attr.y1]="o.from.y" [attr.x2]="o.to.x" [attr.y2]="o.to.y" (pointerdown)="onOpening($event, o.id)">
                <title>Arrastra para deslizar esta {{ o.type === 'door' ? 'puerta' : 'ventana' }} por su pared</title>
              </line>
            }
            @for (wall of plan.walls; track wall.id; let i = $index) {
              <circle class="vertex" [class.chosen]="chosen('vertex', i)" [attr.cx]="wall.from.x" [attr.cy]="wall.from.y" [attr.r]="fontM() * 0.55" (pointerdown)="onVertex($event, i)">
                <title>Arrastra para mover esta esquina</title>
              </circle>
            }
          }

          @for (wall of plan.walls; track wall.id) {
            <text class="dim" [attr.x]="wall.label.x" [attr.y]="wall.label.y" [attr.text-anchor]="wall.label.anchor">{{ wall.label.text }}</text>
          }

          @for (c of clearances(); track $index) {
            <line class="clearance" [attr.x1]="c.from.x" [attr.y1]="c.from.y" [attr.x2]="c.to.x" [attr.y2]="c.to.y" />
            <text class="clearance-text" [attr.x]="c.label.x" [attr.y]="c.label.y" text-anchor="middle">{{ c.label.text }}</text>
          }

          @if (ghost(); as points) {
            <polygon class="ghost" [attr.points]="points" />
          }

          @for (g of guides(); track $index) {
            <line class="guide" [attr.x1]="g.x1" [attr.y1]="g.y1" [attr.x2]="g.x2" [attr.y2]="g.y2" />
          }

          @if (ruler(); as r) {
            <line class="ruler" [attr.x1]="r.from.x" [attr.y1]="r.from.z" [attr.x2]="r.to.x" [attr.y2]="r.to.z" />
            <circle class="ruler-end" [attr.cx]="r.from.x" [attr.cy]="r.from.z" [attr.r]="fontM() * 0.25" />
            <circle class="ruler-end" [attr.cx]="r.to.x" [attr.cy]="r.to.z" [attr.r]="fontM() * 0.25" />
            <text class="ruler-text" [attr.x]="r.mid.x" [attr.y]="r.mid.z" text-anchor="middle">{{ r.text }}</text>
          }
        </g>
      </svg>
    }

    <p class="hint" role="status" [class.warn]="!!preview().message">{{ preview().message ?? hint() }}</p>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      min-height: 320px;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .tools {
      display: inline-flex;
      padding: 3px;
      border-radius: 999px;
      background: var(--surface-2);
    }
    .tool {
      border: none;
      border-radius: 999px;
      background: transparent;
      padding: 6px 12px;
      font: inherit;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
    }
    .tool[aria-pressed='true'] {
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow-sm);
    }
    .area {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    svg {
      flex: 1;
      min-height: 0;
      width: 100%;
      touch-action: none;
      user-select: none;
      overflow: visible;
    }
    svg.tool-measure {
      cursor: crosshair;
    }
    .floor {
      fill: var(--surface-2);
    }
    .wall {
      stroke: var(--text);
      stroke-width: 0.1;
      stroke-linecap: square;
    }
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
      fill: color-mix(in srgb, var(--primary) 18%, var(--surface));
      stroke: var(--primary);
      stroke-width: 0.025;
      outline: none;
    }
    .tool-select .item {
      cursor: grab;
    }
    .tool-select .item.fixed {
      cursor: pointer;
    }
    .tool-select.busy .item {
      cursor: grabbing;
    }
    .item.selected {
      fill: color-mix(in srgb, var(--primary) 42%, var(--surface));
      stroke-width: 0.05;
    }
    .item:focus-visible {
      stroke: var(--focus);
      stroke-width: 0.07;
    }
    .item.invalid {
      fill: color-mix(in srgb, var(--danger) 35%, var(--surface));
      stroke: var(--danger);
    }
    .caption {
      fill: var(--text);
      font-size: 0.8em;
      dominant-baseline: middle;
      pointer-events: none;
    }
    .dim {
      fill: var(--text-muted);
      dominant-baseline: middle;
      pointer-events: none;
      font-variant-numeric: tabular-nums;
    }
    .grip {
      stroke: transparent;
      stroke-width: 0.36;
      stroke-linecap: round;
    }
    .wall-grip {
      cursor: move;
    }
    .wall-grip:hover {
      stroke: color-mix(in srgb, var(--primary) 35%, transparent);
    }
    .opening-grip {
      cursor: ew-resize;
    }
    .opening-grip:hover {
      stroke: color-mix(in srgb, var(--accent) 45%, transparent);
    }
    .vertex {
      fill: var(--surface);
      stroke: var(--primary);
      stroke-width: 0.045;
      cursor: move;
    }
    .vertex:hover,
    .vertex.chosen {
      fill: var(--primary);
    }
    .wall-grip.chosen {
      stroke: color-mix(in srgb, var(--primary) 45%, transparent);
    }
    .opening-grip.chosen {
      stroke: color-mix(in srgb, var(--accent) 60%, transparent);
    }
    .clearance {
      stroke: var(--accent);
      stroke-width: 0.02;
      stroke-dasharray: 0.06 0.05;
    }
    .clearance-text {
      fill: var(--accent);
      font-size: 0.8em;
      font-weight: 600;
      dominant-baseline: middle;
      pointer-events: none;
      paint-order: stroke;
      stroke: var(--surface-2);
      stroke-width: 0.06;
    }
    .ghost {
      fill: color-mix(in srgb, var(--accent) 25%, transparent);
      stroke: var(--accent);
      stroke-width: 0.03;
      stroke-dasharray: 0.1 0.06;
      pointer-events: none;
    }
    .guide {
      stroke: var(--focus);
      stroke-width: 0.02;
    }
    .ruler {
      stroke: var(--danger);
      stroke-width: 0.03;
    }
    .ruler-end {
      fill: var(--danger);
    }
    .ruler-text {
      fill: var(--danger);
      font-weight: 700;
      dominant-baseline: middle;
      pointer-events: none;
      paint-order: stroke;
      stroke: var(--surface);
      stroke-width: 0.08;
    }
    .hint {
      margin: 0;
      font-size: 0.8rem;
      color: var(--text-muted);
      min-height: 1.3em;
    }
    .hint.warn {
      color: var(--danger);
    }
  `,
})
export class PlanEditorComponent {
  protected readonly store = inject(DesignProjectStore);
  private readonly scene = inject(SceneService);
  private readonly edits = inject(SceneEditsService);
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');

  protected readonly tools = TOOLS;
  readonly tool = signal<PlanTool>('select');
  protected readonly preview = signal<PlanPreview>({});
  protected readonly active = signal(false);
  /** Mientras se edita la planta el encuadre no cambia: si no, el plano se movería bajo el cursor. */
  private readonly frozenViewBox = signal<string | null>(null);
  private readonly measured = signal<PlanPreview['measure'] | null>(null);
  private gesture: PlanGesture | null = null;
  private lastShift: Point2 = { x: 0, z: 0 };

  protected readonly hint = computed(() => TOOLS.find((t) => t.id === this.tool())!.hint);

  protected readonly pieces = computed<PlanPiece[]>(() => {
    const catalog = this.store.catalog();
    const moved = this.preview().moved;
    const selectedId = this.store.selectedId();
    const font = this.fontM();
    return [...this.store.placements()]
      .sort((a, b) => a.position.y - b.position.y)
      .flatMap((p) => {
        const item = catalog.get(p.catalogItemId);
        if (!item) return [];
        const pose = moved?.get(p.id) ?? p;
        const corners = footprint(pose.position, effectiveDimensions(item.dimensionsM, p), pose.rotationY).corners;
        const xs = corners.map((c) => c.x);
        const zs = corners.map((c) => c.z);
        // Una alfombra queda debajo de otros muebles: su nombre se pisaría con los de ellos.
        const caption = item.subcategory === 'rug' ? '' : captionFor(item.name, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), font * 0.8);
        return [
          {
            id: p.id,
            name: item.name,
            points: corners.map((c) => `${c.x.toFixed(3)},${c.z.toFixed(3)}`).join(' '),
            corners,
            selected: p.id === selectedId,
            movable: draggableInPlan(p),
            centre: { x: pose.position.x, z: pose.position.z },
            caption,
          },
        ];
      });
  });

  protected readonly plan = computed(() => {
    const shell = this.store.shell();
    return shell ? floorPlanOf(shell) : null;
  });

  protected readonly viewBox = computed(() => this.frozenViewBox() ?? this.plan()?.viewBox ?? '0 0 1 1');

  /** Tamaño del texto en metros del plano: crece con el cuarto para leerse igual en uno grande. */
  protected readonly fontM = computed(() => {
    const shell = this.store.shell();
    const span = shell ? Math.max(shell.widthM, shell.depthM) : 4;
    return Math.min(0.5, Math.max(0.22, span * 0.05));
  });

  protected readonly shiftTransform = computed(() => {
    const s = this.preview().shift;
    return s && (s.x || s.z) ? `translate(${-s.x} ${-s.z})` : null;
  });

  protected readonly area = computed(() => {
    const shell = this.store.shell();
    return shell ? `${RoomPlan.from(shell).area().toFixed(1).replace('.', ',')} m²` : null;
  });

  /** Cotas del mueble seleccionado hasta las paredes (no para lo colgado ni lo apoyado). */
  protected readonly clearances = computed(() => {
    const shell = this.store.shell();
    const piece = this.pieces().find((p) => p.selected);
    const selected = this.store.selected();
    if (!shell || !piece || !selected || selected.wallId || selected.supportId || this.tool() !== 'select') return [];
    return clearancesOf(shell, piece.corners);
  });

  protected readonly guides = computed(() =>
    (this.preview().guides ?? []).map((g) =>
      g.axis === 'x' ? { x1: g.at, y1: g.from, x2: g.at, y2: g.to } : { x1: g.from, y1: g.at, x2: g.to, y2: g.at },
    ),
  );

  protected readonly ruler = computed(() => {
    const m = this.preview().measure ?? this.measured();
    if (!m || this.tool() !== 'measure') return null;
    const length = Math.hypot(m.to.x - m.from.x, m.to.z - m.from.z);
    return { ...m, mid: { x: (m.from.x + m.to.x) / 2, z: (m.from.z + m.to.z) / 2 - this.fontM() * 0.7 }, text: metres(length) };
  });

  /** Dónde caería el mueble que se arrastra desde el catálogo (en metros del plano). */
  protected readonly ghostAt = signal<Point2 | null>(null);
  protected readonly ghost = computed(() => {
    const at = this.ghostAt();
    const item = this.edits.dragged();
    if (!at || !item) return null;
    return footprint({ x: at.x, y: 0, z: at.z }, item.dimensionsM, 0)
      .corners.map((c) => `${c.x.toFixed(3)},${c.z.toFixed(3)}`)
      .join(' ');
  });

  protected onDragOver(event: DragEvent): void {
    if (!this.edits.dragged()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.ghostAt.set(this.pointOf(event));
  }

  protected onDrop(event: DragEvent): void {
    const item = this.edits.dragged();
    if (!item) return;
    event.preventDefault();
    this.ghostAt.set(null);
    this.edits.dragged.set(null);
    this.tool.set('select');
    this.edits.add(item, this.pointOf(event));
  }

  protected setTool(tool: PlanTool): void {
    this.tool.set(tool);
    this.measured.set(null);
    if (tool !== 'select') this.store.select(null);
  }

  // ------------------------------------------------------------------ gestos
  /** Llegar a un mueble con el tabulador lo selecciona: después las flechas lo mueven. */
  protected onFocus(id: string): void {
    if (this.tool() === 'select' && !this.gesture) this.store.select(id);
  }

  protected onItem(event: PointerEvent, id: string): void {
    if (this.tool() !== 'select') return; // el clic sigue hasta el fondo (medir)
    this.store.select(id);
    const placement = this.store.placements().find((p) => p.id === id);
    const item = placement ? this.store.catalog().get(placement.catalogItemId) : null;
    if (!placement || !item || !draggableInPlan(placement)) {
      event.stopPropagation();
      return;
    }
    this.begin(event, new MoveItemGesture(this.store, placement, item, this.pointOf(event)));
  }

  /** ¿Es esta la parte del cuarto elegida? */
  protected chosen(kind: 'wall' | 'opening' | 'vertex', id: string | number): boolean {
    const t = this.store.roomTarget();
    if (!t || t.kind !== kind) return false;
    return t.kind === 'wall' ? t.wallId === id : t.kind === 'opening' ? t.openingId === id : t.index === id;
  }

  protected onWall(event: PointerEvent, wallId: string): void {
    this.store.roomTarget.set({ kind: 'wall', wallId });
    this.begin(event, new MoveWallGesture(this.store, wallId, this.pointOf(event)));
  }

  protected onVertex(event: PointerEvent, index: number): void {
    this.store.roomTarget.set({ kind: 'vertex', index });
    this.begin(event, new MoveVertexGesture(this.store, index, this.pointOf(event)));
  }

  protected onOpening(event: PointerEvent, openingId: string): void {
    this.store.roomTarget.set({ kind: 'opening', openingId });
    this.begin(event, new MoveOpeningGesture(this.store, openingId, this.pointOf(event)));
  }

  protected onBackground(event: PointerEvent): void {
    if (this.tool() === 'measure') {
      this.measured.set(null);
      this.begin(event, new MeasureGesture(this.store, this.pointOf(event)));
    } else if (this.tool() === 'select') {
      this.store.select(null);
    } else {
      this.store.roomTarget.set(null);
    }
  }

  private begin(event: PointerEvent, gesture: PlanGesture): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.gesture = gesture;
    this.lastShift = { x: 0, z: 0 };
    if (gesture.kind !== 'item' && gesture.kind !== 'measure') this.frozenViewBox.set(this.plan()?.viewBox ?? null);
    this.svg()?.nativeElement.setPointerCapture(event.pointerId);
    this.active.set(true);
  }

  protected onMove(event: PointerEvent): void {
    if (!this.gesture) return;
    const next = this.gesture.move(this.pointOf(event));
    this.preview.set(next);
    if (next.moved) this.scene.previewPoses(next.moved);
    const shift = next.shift;
    if (shift && (shift.x !== this.lastShift.x || shift.z !== this.lastShift.z)) {
      // El cuarto vive pegado al origen: si este se corre, la cámara 3D lo acompaña.
      this.scene.panBy(shift.x - this.lastShift.x, shift.z - this.lastShift.z);
      this.lastShift = shift;
    }
  }

  protected onUp(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    const svg = this.svg()?.nativeElement;
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    const kept = gesture.end();
    this.measured.set(kept?.measure ?? null);
    this.preview.set({});
    this.frozenViewBox.set(null);
    this.active.set(false);
    if (gesture.kind === 'item') this.scene.previewPoses(null);
  }

  /** Mismas teclas que en el visor 3D para el mueble seleccionado. */
  protected onKey(event: KeyboardEvent): void {
    const stepM = event.shiftKey ? 0.25 : 0.05;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.scene.nudgeSelected(-stepM, 0),
      ArrowRight: () => this.scene.nudgeSelected(stepM, 0),
      ArrowUp: () => this.scene.nudgeSelected(0, -stepM),
      ArrowDown: () => this.scene.nudgeSelected(0, stepM),
      r: () => this.scene.rotateSelected(Math.PI / 12),
      R: () => this.scene.rotateSelected(-Math.PI / 12),
      Delete: () => this.scene.removeSelected(),
      Backspace: () => this.scene.removeSelected(),
      Escape: () => this.store.select(null),
    };
    const action = actions[event.key];
    if (!action || (!this.store.selected() && event.key !== 'Escape')) return;
    event.preventDefault();
    action();
  }

  /** Punto del cursor en metros del plano (las coordenadas del `viewBox`). */
  private pointOf(event: { clientX: number; clientY: number }): Point2 {
    const svg = this.svg()?.nativeElement;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, z: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, z: p.y };
  }
}
