/**
 * Herramientas del visor 3D (patrón State): el visor entrega cada gesto del cursor a la
 * herramienta activa, que decide qué significa. Añadir una herramienta es añadir una clase; ni el
 * visor ni `SceneService` cambian.
 *
 * - Seleccionar: mover muebles y usar el gizmo (girar, estirar).
 * - Paredes: arrastrar una pared, una puerta o una ventana (los mismos gestos del plano).
 * - Pintar: un clic sobre una pared o el piso abre su paleta.
 * - Medir: una regla entre dos puntos del piso.
 */
import { pointInPolygon, roomPolygon, type Point2, type RoomShell } from '@interiores/shared-types';
import { MoveOpeningGesture, MoveWallGesture, type PlanContext, type PlanGesture } from '../../floor-plan/plan-gestures';
import { hitWall, openingAt } from '../mounts/gizmo-math';
import { intersectHorizontal, type Ray } from '../mounts/mount-strategies';
import type { GizmoHandleKind } from '../mounts/gizmo-math';

export type ViewportToolId = 'select' | 'room' | 'paint' | 'measure';

export interface ToolInfo {
  id: ViewportToolId;
  label: string;
  /** Tecla que la activa con el visor enfocado. */
  key: string;
  hint: string;
}

export const VIEWPORT_TOOLS: readonly ToolInfo[] = [
  { id: 'select', label: 'Mover', key: 'v', hint: 'Arrastra un mueble; con uno seleccionado, gira el aro o estira sus tiradores.' },
  { id: 'room', label: 'Paredes', key: 'w', hint: 'Arrastra una pared para moverla, o una puerta o ventana para deslizarla.' },
  { id: 'paint', label: 'Pintar', key: 'b', hint: 'Haz clic en una pared, en el piso o en un mueble para cambiar su material.' },
  { id: 'measure', label: 'Medir', key: 'm', hint: 'Arrastra entre dos puntos del piso para medir.' },
];

export interface ToolEvent {
  ray: Ray;
  event: PointerEvent;
}

export interface ViewportTool {
  readonly id: ViewportToolId;
  /** Devuelve true si se queda con el gesto: la cámara no se mueve hasta que se suelte. */
  down(e: ToolEvent): boolean;
  move(e: ToolEvent): void;
  up(e: ToolEvent): void;
  /** Cursor que conviene mostrar con el puntero en ese sitio (sin gesto en curso). */
  cursor(e: ToolEvent): string;
  /** La herramienta deja de estar activa: limpia lo que estuviera mostrando. */
  leave(): void;
}

// ------------------------------------------------------------------ seleccionar

/** Lo que la herramienta de selección necesita del arrastre de muebles y del gizmo. */
export interface SelectHost {
  pickHandle(e: ToolEvent): GizmoHandleKind | null;
  beginHandle(kind: GizmoHandleKind, e: ToolEvent): boolean;
  moveHandle(e: ToolEvent): void;
  endHandle(): void;
  highlight(kind: GizmoHandleKind | null): void;
  dragDown(event: PointerEvent): void;
  dragMove(event: PointerEvent): void;
  dragUp(event: PointerEvent): void;
  readOnly(): boolean;
}

export class SelectTool implements ViewportTool {
  readonly id = 'select';
  private handle: GizmoHandleKind | null = null;

  constructor(private readonly host: SelectHost) {}

  down(e: ToolEvent): boolean {
    const kind = this.host.readOnly() ? null : this.host.pickHandle(e);
    if (kind && this.host.beginHandle(kind, e)) {
      this.handle = kind;
      this.host.highlight(kind);
      return true;
    }
    // El arrastre de muebles gestiona por su cuenta la cámara y la captura del puntero.
    this.host.dragDown(e.event);
    return false;
  }

  move(e: ToolEvent): void {
    if (this.handle) this.host.moveHandle(e);
    else this.host.dragMove(e.event);
  }

  up(e: ToolEvent): void {
    if (this.handle) {
      this.handle = null;
      this.host.endHandle();
      this.host.highlight(null);
    } else {
      this.host.dragUp(e.event);
    }
  }

  cursor(e: ToolEvent): string {
    const kind = this.host.readOnly() ? null : this.host.pickHandle(e);
    this.host.highlight(kind);
    return kind ? (kind === 'rotate' ? 'alias' : kind === 'height' || kind === 'elevation' ? 'ns-resize' : 'ew-resize') : '';
  }

  leave(): void {
    this.handle = null;
    this.host.highlight(null);
  }
}

// ------------------------------------------------------------------ paredes

export interface RoomToolHost {
  shell(): RoomShell | null;
  /** El origen del cuarto se corrió: la cámara lo acompaña. */
  panBy(dx: number, dz: number): void;
  /** Qué parte del cuarto se tocó (para ofrecer sus acciones); null = ninguna. */
  target(target: { kind: 'wall'; wallId: string } | { kind: 'opening'; openingId: string } | null): void;
  message(text: string | null): void;
}

export class RoomTool implements ViewportTool {
  readonly id = 'room';
  private gesture: PlanGesture | null = null;
  private grabY = 0;
  private shift: Point2 = { x: 0, z: 0 };

  constructor(
    private readonly ctx: PlanContext,
    private readonly host: RoomToolHost,
  ) {}

  down(e: ToolEvent): boolean {
    const shell = this.host.shell();
    const hit = shell ? hitWall(e.ray, shell) : null;
    if (!shell || !hit) {
      this.host.target(null);
      return false;
    }
    const openingId = openingAt(shell, hit);
    this.host.target(openingId ? { kind: 'opening', openingId } : { kind: 'wall', wallId: hit.wall.id });
    this.gesture = openingId ? new MoveOpeningGesture(this.ctx, openingId, hit.point) : new MoveWallGesture(this.ctx, hit.wall.id, hit.point);
    // El cursor se sigue sobre el plano horizontal a la altura donde se agarró la pared.
    this.grabY = Math.max(0.05, hit.y);
    this.shift = { x: 0, z: 0 };
    return true;
  }

  move(e: ToolEvent): void {
    if (!this.gesture) return;
    const point = intersectHorizontal(e.ray, this.grabY);
    if (!point) return;
    // Los gestos trabajan en las coordenadas que el cuarto tenía al empezar.
    const preview = this.gesture.move({ x: point.x - this.shift.x, z: point.z - this.shift.z });
    this.host.message(preview.message ?? null);
    const next = preview.shift;
    if (next && (next.x !== this.shift.x || next.z !== this.shift.z)) {
      this.host.panBy(next.x - this.shift.x, next.z - this.shift.z);
      this.shift = next;
    }
  }

  up(): void {
    this.gesture?.end();
    this.gesture = null;
    this.host.message(null);
  }

  cursor(e: ToolEvent): string {
    const shell = this.host.shell();
    const hit = shell ? hitWall(e.ray, shell) : null;
    if (!shell || !hit) return '';
    return openingAt(shell, hit) ? 'ew-resize' : 'move';
  }

  leave(): void {
    this.gesture = null;
    this.host.message(null);
  }
}

// ------------------------------------------------------------------ pintar

/** Qué se va a pintar. */
export type PaintTarget = { surface: 'floor' } | { surface: 'wall'; wallId: string };

export interface PaintToolHost {
  shell(): RoomShell | null;
  pickItem(e: ToolEvent): string | null;
  /** Un mueble se pinta desde su panel: basta con seleccionarlo. */
  select(placementId: string): void;
  /** Abre la paleta de ese destino junto al cursor (o la cierra con null). */
  open(target: PaintTarget | null, at: { x: number; y: number } | null): void;
}

/** Qué superficie del cuarto hay bajo el rayo: el piso si se ve antes que la pared. */
export function surfaceUnder(ray: Ray, shell: RoomShell): PaintTarget | null {
  const wall = hitWall(ray, shell);
  const floor = intersectHorizontal(ray, 0);
  const floorT = floor ? Math.hypot(floor.x - ray.origin.x, floor.y - ray.origin.y, floor.z - ray.origin.z) : Infinity;
  const onFloor = floor && pointInPolygon(floor, roomPolygon(shell), 0.01);
  if (onFloor && (!wall || floorT < wallDistance(ray, wall.t))) return { surface: 'floor' };
  return wall ? { surface: 'wall', wallId: wall.wall.id } : null;
}

/** `t` de `hitWall` va en unidades del rayo; se pasa a metros para compararlo con el piso. */
function wallDistance(ray: Ray, t: number): number {
  return t * Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
}

export class PaintTool implements ViewportTool {
  readonly id = 'paint';
  private downAt: { x: number; y: number } | null = null;

  constructor(private readonly host: PaintToolHost) {}

  down(e: ToolEvent): boolean {
    this.downAt = { x: e.event.clientX, y: e.event.clientY };
    return false; // arrastrar sigue moviendo la cámara; solo el clic pinta
  }

  move(): void {}

  up(e: ToolEvent): void {
    const from = this.downAt;
    this.downAt = null;
    if (!from || Math.hypot(e.event.clientX - from.x, e.event.clientY - from.y) > 5) return;
    const shell = this.host.shell();
    const itemId = this.host.pickItem(e);
    if (itemId) {
      this.host.open(null, null);
      this.host.select(itemId);
      return;
    }
    const target = shell ? surfaceUnder(e.ray, shell) : null;
    this.host.open(target, target ? { x: e.event.clientX, y: e.event.clientY } : null);
  }

  cursor(): string {
    return 'cell';
  }

  leave(): void {
    this.downAt = null;
    this.host.open(null, null);
  }
}

// ------------------------------------------------------------------ medir

export interface MeasureToolHost {
  /** Dibuja la regla entre dos puntos del piso (o la quita con null). */
  measure(line: { from: Point2; to: Point2 } | null): void;
}

export class MeasureTool implements ViewportTool {
  readonly id = 'measure';
  private from: Point2 | null = null;

  constructor(private readonly host: MeasureToolHost) {}

  down(e: ToolEvent): boolean {
    const point = intersectHorizontal(e.ray, 0);
    if (!point) return false;
    this.from = { x: point.x, z: point.z };
    this.host.measure(null);
    return true;
  }

  move(e: ToolEvent): void {
    const point = intersectHorizontal(e.ray, 0);
    if (this.from && point) this.host.measure({ from: this.from, to: { x: point.x, z: point.z } });
  }

  up(): void {
    this.from = null; // la regla se queda dibujada hasta la siguiente medida
  }

  cursor(): string {
    return 'crosshair';
  }

  leave(): void {
    this.from = null;
    this.host.measure(null);
  }
}

// ------------------------------------------------------------------ gestor

/** Contexto de las herramientas: guarda la activa y le reparte los gestos. */
export class ToolManager {
  private readonly tools = new Map<ViewportToolId, ViewportTool>();
  private current: ViewportTool;
  /** La herramienta se quedó con el gesto en curso. */
  private captured = false;

  constructor(
    tools: readonly ViewportTool[],
    private readonly onChange: (id: ViewportToolId) => void = () => undefined,
  ) {
    for (const tool of tools) this.tools.set(tool.id, tool);
    this.current = tools[0]!;
  }

  get active(): ViewportToolId {
    return this.current.id;
  }

  get busy(): boolean {
    return this.captured;
  }

  use(id: ViewportToolId): void {
    const next = this.tools.get(id);
    if (!next || next === this.current) return;
    this.current.leave();
    this.captured = false;
    this.current = next;
    this.onChange(id);
  }

  down(e: ToolEvent): boolean {
    this.captured = this.current.down(e);
    return this.captured;
  }

  /** Devuelve el cursor que conviene mostrar ('' = el del visor). */
  move(e: ToolEvent, pressed: boolean): string | null {
    if (pressed || this.captured) {
      this.current.move(e);
      return null;
    }
    // Sin botón pulsado: Seleccionar sigue necesitando el movimiento (resalta lo que hay debajo).
    if (this.current.id === 'select') this.current.move(e);
    return this.current.cursor(e);
  }

  up(e: ToolEvent): void {
    this.current.up(e);
    this.captured = false;
  }
}
