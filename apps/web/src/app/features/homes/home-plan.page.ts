import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  arrangeHome,
  boxesOverlap,
  budgetStatus,
  homeBounds,
  outlineBounds,
  roomBox,
  shareWall,
  snapRoom,
  type PlanPoint,
  type ProjectListItem,
  type RoomBox,
} from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { ProjectsApi } from '../../core/api/projects.api';
import { downloadBlob, fileSlug } from '../../core/ui/download';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { oneDecimal } from '../projects/projects-filter';

/** Un cuarto tal como se dibuja en la planta conjunta. */
interface PlanRoom {
  id: string;
  name: string;
  areaM2: number | null;
  total: number;
  cap: number | null;
  points: string;
  box: RoomBox;
  /** Centro de su caja, donde va el nombre. */
  cx: number;
  cz: number;
  overlaps: boolean;
  neighbours: string[];
}

const MARGIN_M = 1.2;
/** Paso de las flechas del teclado, en metros (con Mayús, diez veces más). */
const STEP_M = 0.1;
const round = (value: number) => Math.round(value * 100) / 100;

/** Lo que la lista sabe de un cuarto, listo para colocarlo en la planta. */
export function planRooms(rooms: readonly ProjectListItem[], positions: ReadonlyMap<string, PlanPoint>): PlanRoom[] {
  const drawn = rooms.flatMap((room) => {
    const at = positions.get(room.id);
    return room.outline?.length && at ? [{ room, at, box: roomBox({ id: room.id, outline: room.outline }, at) }] : [];
  });
  return drawn.map(({ room, at, box }) => {
    const others = drawn.filter((o) => o.room.id !== room.id);
    return {
      id: room.id,
      name: room.name,
      areaM2: room.areaM2 ?? null,
      total: room.estimatedTotal ?? 0,
      cap: room.budgetCap ?? null,
      points: room.outline!.map((p) => `${round(p.x + at.x)},${round(p.z + at.z)}`).join(' '),
      box,
      cx: round(box.x + box.widthM / 2),
      cz: round(box.z + box.depthM / 2),
      overlaps: others.some((o) => boxesOverlap(box, o.box)),
      neighbours: others.filter((o) => shareWall(box, o.box)).map((o) => o.room.name),
    };
  });
}

/**
 * Planta conjunta de una vivienda: todos sus cuartos dibujados a la misma escala, que se arrastran
 * y se pegan entre sí. Cada cuarto sigue siendo un proyecto con su editor; aquí solo se decide
 * dónde va cada uno y se ve lo que suman.
 */
@Component({
  selector: 'app-home-plan-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, CurrencyPipe, IconComponent],
  template: `
    <section class="container page">
      <a class="back" routerLink="/proyectos"><app-icon name="back" /> Mis proyectos</a>

      @if (loading()) {
        <div class="skeleton tall" aria-busy="true"></div>
      } @else if (error()) {
        <p class="alert alert-danger" role="alert">{{ error() }} <button type="button" class="btn btn-sm" (click)="load()">Reintentar</button></p>
      } @else if (!rooms().length) {
        <h1>Esta vivienda no existe</h1>
        <p class="muted">Puede que hayas sacado de ella su último cuarto. Tus proyectos siguen en la lista.</p>
      } @else {
        <header class="head">
          <p class="eyebrow">Vivienda</p>
          <h1>{{ name() }}</h1>
        </header>

        <dl class="facts">
          <div>
            <dt>Cuartos</dt>
            <dd>{{ rooms().length }}</dd>
          </div>
          <div>
            <dt>Superficie</dt>
            <dd>{{ oneDecimal(totals().areaM2) }} m²</dd>
          </div>
          <div>
            <dt>Muebles</dt>
            <dd>{{ totals().pieces }}</dd>
          </div>
          <div>
            <dt>Total estimado</dt>
            <dd>{{ totals().total | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}</dd>
          </div>
          @if (totals().cap; as cap) {
            <div>
              <dt>Presupuesto</dt>
              <dd [class]="'budget-' + budget().level">
                {{ cap | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}
                <span class="note">
                  @if (budget().level === 'over') {
                    te pasas {{ -budget().remaining | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}
                  } @else {
                    quedan {{ budget().remaining | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}
                  }
                </span>
              </dd>
            </div>
          }
        </dl>

        <div class="plan">
          <svg
            #svg
            [attr.viewBox]="viewBox()"
            role="group"
            aria-label="Planta de la vivienda"
            (pointermove)="onMove($event)"
            (pointerup)="drop()"
            (pointercancel)="drop()"
          >
            <defs>
              <pattern id="home-grid" width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 L 0 0 0 1" fill="none" class="grid-line" />
              </pattern>
            </defs>
            <!-- Más grande que el encuadre: si la pantalla es más ancha que la planta, la cuadrícula llega al borde. -->
            <rect class="grid" [attr.x]="frame().x - 60" [attr.y]="frame().z - 60" [attr.width]="frame().widthM + 120" [attr.height]="frame().depthM + 120" fill="url(#home-grid)" />
            @for (r of plan(); track r.id) {
              <g
                class="room"
                [class.dragging]="dragging() === r.id"
                [class.overlaps]="r.overlaps"
                tabindex="0"
                role="button"
                [attr.aria-label]="r.name + (r.areaM2 ? ', ' + oneDecimal(r.areaM2) + ' metros cuadrados' : '') + '. Arrástralo o muévelo con las flechas.'"
                (pointerdown)="grab($event, r.id)"
                (keydown)="onKey($event, r.id)"
                (keyup)="settle(r.id)"
              >
                <polygon [attr.points]="r.points" />
                <text class="name" [attr.x]="r.cx" [attr.y]="r.cz" [attr.font-size]="fontFor(r)">{{ r.name }}</text>
                @if (r.areaM2) {
                  <text class="area" [attr.x]="r.cx" [attr.y]="r.cz + fontFor(r) * 1.3" [attr.font-size]="fontFor(r) * 0.8">{{ oneDecimal(r.areaM2) }} m²</text>
                }
              </g>
            }
          </svg>
        </div>
        <div class="row under">
          <p class="muted hint">
            Arrastra cada cuarto a su sitio: al acercarlo a otro, sus paredes se pegan. Con el teclado, las flechas lo mueven 10 cm (con Mayús, 1 m). La
            cuadrícula es de un metro.
          </p>
          <span class="spacer"></span>
          <button type="button" class="btn btn-sm" (click)="tidy()" [disabled]="saving()">Ordenar en fila</button>
          <button type="button" class="btn btn-sm" (click)="downloadPdf()" [disabled]="exporting() || !plan().length"><app-icon name="download" /> {{ exporting() ? 'Preparando…' : 'Vivienda en PDF' }}</button>
        </div>
        @if (anyOverlap()) {
          <p class="alert alert-warning" role="status">Hay cuartos que se pisan. Sepáralos para que la planta tenga sentido.</p>
        }
        @if (missing(); as n) {
          <p class="muted fine">{{ n === 1 ? 'Un cuarto todavía no tiene' : n + ' cuartos todavía no tienen' }} plano (se está generando) y no aparece en la planta.</p>
        }

        <h2 class="eyebrow list-title">Cuartos</h2>
        <ul class="rooms" role="list">
          @for (r of rooms(); track r.id) {
            <li>
              <div>
                <a class="room-name" [routerLink]="['/proyectos', r.id]" [queryParams]="{ vista: '3d' }">{{ r.name }}</a>
                <span class="muted">
                  @if (r.areaM2) { {{ oneDecimal(r.areaM2) }} m² · }
                  {{ r.itemCount }} {{ r.itemCount === 1 ? 'mueble' : 'muebles' }}
                  @if (neighboursOf(r.id); as near) { · junto a {{ near }} }
                </span>
              </div>
              <div class="money">
                @if (r.estimatedTotal) {
                  <strong>{{ r.estimatedTotal | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}</strong>
                }
                @if (r.budgetCap) {
                  <span class="badge" [class]="'badge ' + capBadge(r)">tope {{ r.budgetCap | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}</span>
                }
              </div>
            </li>
          }
        </ul>
        <a class="btn" routerLink="/proyectos/nuevo" [queryParams]="{ vivienda: id() }"><app-icon name="plus" /> Añadir cuarto</a>
      }
    </section>
  `,
  styles: `
    .page {
      padding: var(--space-6) 0 64px;
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: var(--text-sm);
    }
    .back:hover {
      color: var(--text);
    }
    .head {
      margin: var(--space-4) 0 var(--space-5);
    }
    .head h1 {
      margin: var(--space-2) 0 0;
    }
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-4) var(--space-7);
      margin: 0 0 var(--space-5);
      padding: var(--space-4) 0;
      border-block: 1px solid var(--rule);
    }
    .facts dt {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .facts dd {
      margin: 2px 0 0;
      font-family: var(--font-display);
      font-size: var(--text-xl);
      font-variant-numeric: tabular-nums;
    }
    .note {
      font-family: var(--font);
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .budget-over .note {
      color: var(--danger);
    }
    .budget-near .note {
      color: var(--warning);
    }
    .plan {
      border: 1px solid var(--rule);
      border-radius: var(--radius);
      background: var(--surface);
      overflow: hidden;
    }
    svg {
      display: block;
      width: 100%;
      height: min(62vh, 620px);
      touch-action: none;
    }
    .grid-line {
      stroke: var(--rule);
      stroke-width: 1px;
      vector-effect: non-scaling-stroke;
    }
    .room {
      cursor: grab;
      outline: none;
    }
    .room polygon {
      fill: var(--primary-soft);
      stroke: var(--primary);
      stroke-width: 2px;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    .room:hover polygon,
    .room:focus-visible polygon {
      stroke: var(--accent);
      stroke-width: 3px;
    }
    .room.dragging {
      cursor: grabbing;
    }
    .room.dragging polygon {
      fill: var(--accent-soft);
      stroke: var(--accent);
    }
    .room.overlaps polygon {
      stroke: var(--danger);
      fill: var(--danger-soft);
    }
    text {
      text-anchor: middle;
      pointer-events: none;
      user-select: none;
      fill: var(--text);
    }
    .name {
      font-weight: 600;
    }
    .area {
      fill: var(--text-muted);
    }
    .under {
      align-items: start;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
      margin-top: var(--space-3);
    }
    .hint {
      margin: 0;
      max-width: 70ch;
      font-size: var(--text-sm);
    }
    .alert {
      margin-top: var(--space-3);
    }
    .list-title {
      margin: var(--space-6) 0 0;
    }
    .rooms {
      list-style: none;
      margin: var(--space-2) 0 var(--space-4);
      padding: 0;
      border-top: 1px solid var(--rule);
    }
    .rooms li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-5);
      align-items: center;
      justify-content: space-between;
      padding: var(--space-3) 0;
      border-bottom: 1px solid var(--rule);
    }
    .room-name {
      display: block;
      font-family: var(--font-display);
      font-size: var(--text-lg);
      font-weight: 500;
      color: var(--text);
      text-decoration: none;
    }
    .room-name:hover {
      color: var(--primary);
    }
    .money {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      font-variant-numeric: tabular-nums;
    }
    .tall {
      height: 320px;
      margin-top: var(--space-4);
    }
  `,
})
export class HomePlanPage {
  private readonly api = inject(ProjectsApi);
  private readonly toast = inject(ToastService);

  /** Id de la vivienda (parámetro de la ruta). */
  readonly id = input.required<string>();

  protected readonly oneDecimal = oneDecimal;
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly exporting = signal(false);
  protected readonly rooms = signal<ProjectListItem[]>([]);
  private readonly positions = signal<ReadonlyMap<string, PlanPoint>>(new Map());
  /** Cuartos cuyo sitio ya está guardado en el servidor tal como se ve. */
  private readonly savedAt = new Map<string, PlanPoint>();
  protected readonly dragging = signal<string | null>(null);
  private drag: { id: string; pointer: PlanPoint; start: PlanPoint } | null = null;
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');

  protected readonly name = computed(() => this.rooms()[0]?.homeName ?? 'Vivienda');
  protected readonly plan = computed(() => planRooms(this.rooms(), this.positions()));
  protected readonly anyOverlap = computed(() => this.plan().some((r) => r.overlaps));
  protected readonly missing = computed(() => this.rooms().length - this.plan().length);
  protected readonly totals = computed(() => {
    const rooms = this.rooms();
    const capped = rooms.filter((r) => r.budgetCap);
    return {
      areaM2: rooms.reduce((sum, r) => sum + (r.areaM2 ?? 0), 0),
      pieces: rooms.reduce((sum, r) => sum + r.itemCount, 0),
      total: rooms.reduce((sum, r) => sum + (r.estimatedTotal ?? 0), 0),
      cap: capped.reduce((sum, r) => sum + (r.budgetCap ?? 0), 0),
      // El tope de la vivienda es la suma de los de sus cuartos: se compara con lo que suman esos.
      cappedTotal: capped.reduce((sum, r) => sum + (r.estimatedTotal ?? 0), 0),
    };
  });
  protected readonly budget = computed(() => budgetStatus(this.totals().cappedTotal, this.totals().cap || null));

  /** Lo que abarca el dibujo. Mientras se arrastra no cambia, para que el plano no se mueva bajo el cursor. */
  private readonly frozenFrame = signal<Omit<RoomBox, 'id'> | null>(null);
  protected readonly frame = computed(() => {
    const frozen = this.frozenFrame();
    if (frozen) return frozen;
    const b = homeBounds(this.plan().map((r) => r.box));
    return { x: Math.floor(b.x - MARGIN_M), z: Math.floor(b.z - MARGIN_M), widthM: Math.ceil(b.widthM + MARGIN_M * 2) + 1, depthM: Math.ceil(b.depthM + MARGIN_M * 2) + 1 };
  });
  protected readonly viewBox = computed(() => {
    const f = this.frame();
    return `${f.x} ${f.z} ${f.widthM} ${f.depthM}`;
  });
  /** El nombre se lee igual en una vivienda de dos cuartos que en una de ocho. */
  protected readonly labelSize = computed(() => round(Math.max(0.2, Math.min(0.42, Math.max(this.frame().widthM, this.frame().depthM) / 40))));

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const rooms = (await this.api.list()).filter((p) => p.homeId === this.id());
      this.savedAt.clear();
      for (const room of rooms) if (room.homePosition) this.savedAt.set(room.id, room.homePosition);
      this.rooms.set(rooms);
      this.positions.set(arrangeHome(rooms.flatMap((r) => (r.outline?.length ? [{ id: r.id, outline: r.outline, position: r.homePosition ?? null }] : []))));
    } catch (err) {
      this.error.set(ApiError.from(err).userMessage);
    } finally {
      this.loading.set(false);
    }
  }

  /** Tamaño del nombre de un cuarto: el de la planta, o menos si no cabe a lo ancho. */
  protected fontFor(room: PlanRoom): number {
    return round(Math.max(0.12, Math.min(this.labelSize(), (room.box.widthM * 0.86) / (Math.max(room.name.length, 4) * 0.56))));
  }

  protected neighboursOf(id: string): string {
    return (
      this.plan()
        .find((r) => r.id === id)
        ?.neighbours.join(', ') ?? ''
    );
  }

  protected capBadge(room: ProjectListItem): string {
    const level = budgetStatus(room.estimatedTotal ?? 0, room.budgetCap ?? null).level;
    return level === 'over' ? 'badge-danger' : level === 'near' ? 'badge-warning' : 'badge-success';
  }

  // ------------------------------------------------------------------ arrastrar
  protected grab(event: PointerEvent, id: string): void {
    const start = this.positions().get(id);
    const pointer = this.toPlan(event);
    if (!start || !pointer) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.frozenFrame.set(this.frame());
    this.drag = { id, pointer, start };
    this.dragging.set(id);
  }

  protected onMove(event: PointerEvent): void {
    const drag = this.drag;
    const pointer = drag && this.toPlan(event);
    if (!drag || !pointer) return;
    this.moveTo(drag.id, { x: drag.start.x + pointer.x - drag.pointer.x, z: drag.start.z + pointer.z - drag.pointer.z }, true);
  }

  protected drop(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.dragging.set(null);
    this.frozenFrame.set(null);
    void this.save();
  }

  /** Flechas: mueven el cuarto sin pegarlo a nada, para poder afinar. */
  protected onKey(event: KeyboardEvent, id: string): void {
    const step = event.shiftKey ? STEP_M * 10 : STEP_M;
    const delta: Record<string, PlanPoint> = {
      ArrowLeft: { x: -step, z: 0 },
      ArrowRight: { x: step, z: 0 },
      ArrowUp: { x: 0, z: -step },
      ArrowDown: { x: 0, z: step },
    };
    const by = delta[event.key];
    const at = this.positions().get(id);
    if (!by || !at) return;
    event.preventDefault();
    this.moveTo(id, { x: at.x + by.x, z: at.z + by.z }, false);
  }

  /** Al soltar la tecla se guarda (no en cada pulsación). */
  protected settle(id: string): void {
    const at = this.positions().get(id);
    const saved = this.savedAt.get(id);
    if (at && (!saved || saved.x !== at.x || saved.z !== at.z)) void this.save();
  }

  private moveTo(id: string, to: PlanPoint, snap: boolean): void {
    const room = this.rooms().find((r) => r.id === id);
    if (!room?.outline) return;
    const bounds = outlineBounds(room.outline);
    let at = { x: round(to.x), z: round(to.z) };
    if (snap) {
      const others = this.plan()
        .filter((r) => r.id !== id)
        .map((r) => r.box);
      const snapped = snapRoom(roomBox({ id, outline: room.outline }, at), others);
      at = { x: round(snapped.x - bounds.minX), z: round(snapped.z - bounds.minZ) };
    }
    this.positions.update((map) => new Map(map).set(id, at));
  }

  /** Vuelve a ponerlos en fila, olvidando dónde estaban. */
  protected async tidy(): Promise<void> {
    this.positions.set(arrangeHome(this.rooms().flatMap((r) => (r.outline?.length ? [{ id: r.id, outline: r.outline }] : []))));
    await this.save();
  }

  /** Guardados en curso, en fila: ver `save`. */
  private queue: Promise<void> = Promise.resolve();

  /**
   * Guarda el sitio de cada cuarto que no coincide con lo guardado. La primera vez son todos: así
   * la planta queda fija y no depende de cómo se ordenen solos.
   *
   * Los guardados van uno detrás de otro. Con las flechas se pide uno por pulsación, y si salieran
   * a la vez podrían llegar al servidor desordenados y quedar guardado un sitio anterior al último.
   */
  private save(): Promise<void> {
    this.queue = this.queue.then(() => this.savePending());
    return this.queue;
  }

  private async savePending(): Promise<void> {
    const pending = [...this.positions()].filter(([id, at]) => {
      const saved = this.savedAt.get(id);
      return !saved || saved.x !== at.x || saved.z !== at.z;
    });
    if (!pending.length) return;
    this.saving.set(true);
    try {
      await Promise.all(pending.map(([id, at]) => this.api.setHomePosition(id, at)));
      for (const [id, at] of pending) this.savedAt.set(id, at);
    } catch (err) {
      this.toast.error(`No se pudo guardar la planta. ${ApiError.from(err).userMessage}`);
    } finally {
      this.saving.set(false);
    }
  }

  /** La vivienda entera en un PDF: la planta como está ahora, lo que suma y cada cuarto. */
  protected async downloadPdf(): Promise<void> {
    const room = this.plan()[0];
    if (!room || this.exporting()) return;
    this.exporting.set(true);
    try {
      await this.save();
      downloadBlob(await this.api.homeDossierPdf(room.id), `${fileSlug(this.name())}.pdf`);
    } catch (err) {
      this.toast.error(`No se pudo preparar el PDF. ${ApiError.from(err).userMessage}`);
    } finally {
      this.exporting.set(false);
    }
  }

  /** Del cursor a metros de la planta. */
  private toPlan(event: PointerEvent): PlanPoint | null {
    const svg = this.svg()?.nativeElement;
    const matrix = svg?.getScreenCTM?.();
    if (!svg || !matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, z: point.y };
  }
}
