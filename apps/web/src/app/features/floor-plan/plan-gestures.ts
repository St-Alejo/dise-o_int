/**
 * Gestos del plano editable (patrón State, sin Angular ni DOM): al pulsar sobre algo se crea el
 * gesto que le corresponde (mover un mueble, una pared, una esquina, una abertura o medir) y el
 * plano solo le va pasando puntos en metros. Cada gesto traduce el arrastre a COMANDOS del store,
 * así que todo lo que se hace en el plano se deshace con Ctrl+Z.
 */
import {
  RoomGeometryError,
  alongOf,
  carryPlacements,
  clampToRoom,
  distanceToSegment,
  effectiveDimensions,
  footprint,
  footprintBounds,
  guidesFor,
  moveOpening,
  moveVertex,
  moveWall,
  overlapsOpening,
  positionOnWall,
  roomPolygon,
  snapMove,
  wallFrames,
  wallLength,
  type CatalogItem,
  type FurniturePlacement,
  type Point2,
  type RoomEdit,
  type RoomShell,
  type SnapBox,
  type SnapGuide,
  type Vector3,
  type WallFrame,
} from '@interiores/shared-types';
import { SetRoomCommand, newGestureKey, type RoomSnapshot, type SceneCommand } from '../viewport-3d/commands';
import { MOUNT_STRATEGIES, snapToWalls, supportCandidates } from '../viewport-3d/mounts/mount-strategies';
import { moveCommandFor, type MovedPose } from '../viewport-3d/scene/move-command';

/** Lo que los gestos necesitan del proyecto abierto (lo cumple `DesignProjectStore`). */
export interface PlanContext {
  shell(): RoomShell | null;
  placements(): readonly FurniturePlacement[];
  catalog(): ReadonlyMap<string, CatalogItem>;
  dependentsOf(id: string): FurniturePlacement[];
  isPoseValid(
    placementId: string,
    catalogItemId: string,
    position: Vector3,
    rotationY: number,
    dimensionsM?: Vector3,
    extra?: Pick<FurniturePlacement, 'supportId'>,
  ): boolean;
  execute(cmd: SceneCommand): void;
}

/** Lo que el plano dibuja de forma provisional mientras dura un gesto. */
export interface PlanPreview {
  /** Piezas que se están moviendo, en su posición provisional. */
  moved?: ReadonlyMap<string, { position: Vector3; rotationY: number }>;
  /** La posición provisional no se permite (choca, tapa una ventana, el cuarto sería imposible). */
  invalid?: boolean;
  message?: string;
  guides?: readonly SnapGuide[];
  /** Cuánto se corrió el origen del cuarto desde que empezó el gesto. */
  shift?: Point2;
  measure?: { from: Point2; to: Point2 };
}

export interface PlanGesture {
  readonly kind: 'item' | 'wall' | 'vertex' | 'opening' | 'measure';
  /** `point` va en metros, en las coordenadas que el cuarto tenía al empezar el gesto. */
  move(point: Point2): PlanPreview;
  /** Termina el gesto; lo que devuelve se queda dibujado (la medida). */
  end(): PlanPreview | null;
}

/** Paso al que se ajustan las ediciones de la planta. */
export const PLAN_STEP_M = 0.05;
const cm = (v: number) => Math.round(v * 100) / 100 + 0;
const step = (v: number) => cm(Math.round(v / PLAN_STEP_M) * PLAN_STEP_M);

// ------------------------------------------------------------------ muebles

/** En el plano se arrastra todo: lo apoyado se mueve sobre su soporte o salta a otro, como en el 3D. */
export function draggableInPlan(_p: FurniturePlacement): boolean {
  return true;
}

export class MoveItemGesture implements PlanGesture {
  readonly kind = 'item';
  private readonly dims: Vector3;
  private readonly offset: Point2;
  private readonly dependents: FurniturePlacement[];
  private lastValid: MovedPose;
  private changed = false;

  constructor(
    private readonly ctx: PlanContext,
    private readonly start: FurniturePlacement,
    private readonly item: CatalogItem,
    grab: Point2,
  ) {
    this.dims = effectiveDimensions(item.dimensionsM, start);
    this.offset = { x: start.position.x - grab.x, z: start.position.z - grab.z };
    this.dependents = ctx.dependentsOf(start.id);
    this.lastValid = { position: start.position, rotationY: start.rotationY, wallId: start.wallId, supportId: start.supportId };
  }

  move(point: Point2): PlanPreview {
    const shell = this.ctx.shell();
    if (!shell) return {};
    const target = { x: point.x + this.offset.x, z: point.z + this.offset.z };
    const { pose, guides, blocked } =
      this.item.mount === 'wall' ? this.onWall(shell, point) : this.item.mount === 'surface' ? this.onSurface(shell, target) : this.onFloor(shell, target);
    const valid =
      !blocked &&
      this.ctx.isPoseValid(this.start.id, this.start.catalogItemId, pose.position, pose.rotationY, this.dims, this.item.mount === 'surface' ? { supportId: pose.supportId } : undefined);
    if (valid) {
      this.lastValid = pose;
      this.changed = true;
    }
    const moved = new Map([[this.start.id, { position: pose.position, rotationY: pose.rotationY }]]);
    const dx = pose.position.x - this.start.position.x;
    const dz = pose.position.z - this.start.position.z;
    for (const dep of this.dependents) {
      moved.set(dep.id, { position: { x: dep.position.x + dx, y: dep.position.y, z: dep.position.z + dz }, rotationY: dep.rotationY });
    }
    return { moved, guides, invalid: !valid, ...(valid ? {} : { message: blocked ? 'Ahí taparía una puerta o una ventana' : 'Ahí choca con otro mueble' }) };
  }

  end(): null {
    const to = this.lastValid;
    const from = this.start;
    const moved = Math.hypot(to.position.x - from.position.x, to.position.z - from.position.z) > 1e-3 || to.wallId !== from.wallId || to.supportId !== from.supportId;
    if (this.changed && moved) this.ctx.execute(moveCommandFor(from, to, this.item, this.dependents));
    return null;
  }

  /** Piso o techo: dentro del cuarto, alineado con los demás muebles y pegado a la pared si está cerca. */
  private onFloor(shell: RoomShell, target: Point2): { pose: MovedPose; guides: SnapGuide[]; blocked: boolean } {
    const rot = this.start.rotationY;
    const y = this.start.position.y;
    const inside = clampToRoom({ x: target.x, y, z: target.z }, this.dims, rot, shell);
    const snap = snapMove(this.boxAt(inside), this.otherBoxes());
    const aligned = clampToRoom({ x: inside.x + snap.dx, y, z: inside.z + snap.dz }, this.dims, rot, shell);
    const position = snapToWalls(aligned, this.dims, rot, shell);
    // Una guía solo se dibuja si, tras meter la pieza en el cuarto, sigue alineada con ella.
    const guides = guidesFor(snap.guides, this.boxAt(position));
    return { pose: { position, rotationY: rot }, guides, blocked: false };
  }

  /**
   * Lo que va sobre otro mueble: queda encima del que haya bajo el cursor (centrado si no cabe
   * entero) o, si no hay ninguno, en el piso. Es la misma estrategia del 3D, mirando desde arriba.
   */
  private onSurface(shell: RoomShell, target: Point2): { pose: MovedPose; guides: SnapGuide[]; blocked: boolean } {
    const pose = MOUNT_STRATEGIES.surface.poseFor(
      { origin: { x: target.x, y: 50, z: target.z }, direction: { x: 0, y: -1, z: 0 } },
      {
        shell,
        dims: this.dims,
        rotationY: this.start.rotationY,
        grabOffset: { x: 0, z: 0 },
        supports: supportCandidates(this.ctx.placements(), this.ctx.catalog(), shell, this.start.id),
      },
    );
    if (!pose) return { pose: { position: this.start.position, rotationY: this.start.rotationY, supportId: this.start.supportId }, guides: [], blocked: true };
    return { pose: { position: pose.position, rotationY: pose.rotationY, supportId: pose.supportId }, guides: [], blocked: false };
  }

  /** Lo colgado se desliza por la pared más cercana al cursor, sin tapar puertas ni ventanas. */
  private onWall(shell: RoomShell, point: Point2): { pose: MovedPose; guides: SnapGuide[]; blocked: boolean } {
    const frames = wallFrames(shell);
    let frame: WallFrame | null = null;
    let nearest = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const wall = shell.walls[i]!;
      const d = distanceToSegment(point, wall.start, wall.end);
      if (d < nearest) [frame, nearest] = [frames[i]!, d];
    }
    if (!frame) return { pose: { position: this.start.position, rotationY: this.start.rotationY }, guides: [], blocked: true };
    const half = Math.min(this.dims.x, frame.length) / 2;
    const along = Math.min(frame.length - half, Math.max(half, alongOf(frame, point)));
    const y = this.start.position.y;
    const pose: MovedPose = { position: positionOnWall(frame, along, y, this.dims.z), rotationY: frame.rotationY, wallId: frame.id, elevationM: y };
    return { pose, guides: [], blocked: overlapsOpening(shell, frame, along, this.dims.x, y, this.dims.y) };
  }

  private boxAt(position: Vector3): SnapBox {
    return footprintBounds(footprint(position, this.dims, this.start.rotationY));
  }

  /** Los demás muebles que pisan el suelo: con sus bordes y centros se alinea la pieza. */
  private otherBoxes(): SnapBox[] {
    const skip = new Set([this.start.id, ...this.dependents.map((d) => d.id)]);
    return this.ctx.placements().flatMap((p) => {
      const item = this.ctx.catalog().get(p.catalogItemId);
      if (!item || skip.has(p.id) || p.supportId || item.mount === 'wall') return [];
      return [footprintBounds(footprint(p.position, effectiveDimensions(item.dimensionsM, p), p.rotationY))];
    });
  }
}

// ------------------------------------------------------------------ planta del cuarto

/** Base de los gestos que cambian la planta: recuerdan el cuarto inicial y ejecutan un solo paso de deshacer. */
abstract class RoomGesture implements PlanGesture {
  abstract readonly kind: PlanGesture['kind'];
  protected readonly start: RoomSnapshot;
  private readonly key = newGestureKey();
  private preview: PlanPreview = {};
  private executed = false;

  constructor(
    protected readonly ctx: PlanContext,
    private readonly label: string,
  ) {
    this.start = { shell: ctx.shell()!, placements: ctx.placements() };
  }

  abstract move(point: Point2): PlanPreview;

  end(): null {
    return null;
  }

  /** Prueba una edición: si el cuarto resultante es válido se aplica; si no, se avisa y no cambia nada. */
  protected attempt(edit: () => RoomEdit | null): PlanPreview {
    let result: RoomEdit | null;
    try {
      result = edit();
    } catch (err) {
      if (!(err instanceof RoomGeometryError)) throw err;
      return { ...this.preview, invalid: true, message: err.message };
    }
    if (!result) return this.preview;
    const unchanged = result.shell === this.start.shell;
    if (unchanged && !this.executed) return this.preview;
    const catalog = this.ctx.catalog();
    const placements = unchanged
      ? this.start.placements
      : carryPlacements(
          this.start.placements,
          (p) => {
            const item = catalog.get(p.catalogItemId);
            return item ? effectiveDimensions(item.dimensionsM, p) : undefined;
          },
          result,
        );
    this.ctx.execute(new SetRoomCommand(this.label, this.start, { shell: result.shell, placements }, this.key));
    this.executed = true;
    this.preview = { shift: result.shift };
    return this.preview;
  }
}

export class MoveWallGesture extends RoomGesture {
  readonly kind = 'wall';
  private readonly normal: Point2;
  private last = 0;

  constructor(
    ctx: PlanContext,
    private readonly wallId: string,
    private readonly grab: Point2,
  ) {
    super(ctx, 'Mover pared');
    this.normal = wallFrames(this.start.shell).find((f) => f.id === wallId)?.normal ?? { x: 0, z: 0 };
  }

  move(point: Point2): PlanPreview {
    // Hacia fuera es en contra de la normal interior.
    const outward = step(-((point.x - this.grab.x) * this.normal.x + (point.z - this.grab.z) * this.normal.z));
    return this.attempt(() => {
      if (outward === this.last) return null;
      const edit = outward === 0 ? { shell: this.start.shell, shift: { x: 0, z: 0 } } : moveWall(this.start.shell, this.wallId, outward);
      this.last = outward;
      return edit;
    });
  }
}

/** A esta distancia de quedar en escuadra con la esquina vecina, la esquina se alinea sola. */
const SQUARE_SNAP_M = 0.12;

export class MoveVertexGesture extends RoomGesture {
  readonly kind = 'vertex';
  private readonly origin: Point2;
  private readonly neighbours: Point2[];
  private last: Point2;

  constructor(
    ctx: PlanContext,
    private readonly index: number,
    private readonly grab: Point2,
  ) {
    super(ctx, 'Mover esquina');
    const poly = roomPolygon(this.start.shell);
    this.origin = poly[index]!;
    this.neighbours = [poly[(index - 1 + poly.length) % poly.length]!, poly[(index + 1) % poly.length]!];
    this.last = this.origin;
  }

  move(point: Point2): PlanPreview {
    const to = { x: step(this.origin.x + point.x - this.grab.x), z: step(this.origin.z + point.z - this.grab.z) };
    for (const n of this.neighbours) {
      if (Math.abs(to.x - n.x) < SQUARE_SNAP_M) to.x = n.x;
      if (Math.abs(to.z - n.z) < SQUARE_SNAP_M) to.z = n.z;
    }
    return this.attempt(() => {
      if (to.x === this.last.x && to.z === this.last.z) return null;
      const back = to.x === this.origin.x && to.z === this.origin.z;
      const edit = back ? { shell: this.start.shell, shift: { x: 0, z: 0 } } : moveVertex(this.start.shell, this.index, to);
      this.last = to;
      return edit;
    });
  }
}

export class MoveOpeningGesture extends RoomGesture {
  readonly kind = 'opening';
  private readonly startOffset: number;
  private readonly from: Point2;
  private readonly dir: Point2;
  private last: number;

  constructor(
    ctx: PlanContext,
    private readonly openingId: string,
    private readonly grab: Point2,
  ) {
    const opening = ctx.shell()!.openings.find((o) => o.id === openingId);
    super(ctx, opening?.type === 'door' ? 'Mover puerta' : 'Mover ventana');
    const wall = this.start.shell.walls.find((w) => w.id === opening?.wallId);
    const length = wall ? wallLength(wall) || 1 : 1;
    this.from = wall ? { x: wall.start.x, z: wall.start.z } : { x: 0, z: 0 };
    this.dir = wall ? { x: (wall.end.x - wall.start.x) / length, z: (wall.end.z - wall.start.z) / length } : { x: 1, z: 0 };
    this.startOffset = opening?.offsetM ?? 0;
    this.last = this.startOffset;
  }

  move(point: Point2): PlanPreview {
    const along = (p: Point2) => (p.x - this.from.x) * this.dir.x + (p.z - this.from.z) * this.dir.z;
    const wanted = cm(this.startOffset + step(along(point) - along(this.grab)));
    return this.attempt(() => {
      if (wanted === this.last) return null;
      const shell = moveOpening(this.start.shell, this.openingId, wanted);
      this.last = wanted;
      return { shell, shift: { x: 0, z: 0 } };
    });
  }
}

// ------------------------------------------------------------------ medir

/** Regla: de donde se pulsa a donde se suelta. Los extremos se pegan a las esquinas del cuarto. */
export class MeasureGesture implements PlanGesture {
  readonly kind = 'measure';
  private readonly corners: Point2[];
  private readonly from: Point2;
  private to: Point2;

  constructor(ctx: PlanContext, grab: Point2) {
    const shell = ctx.shell();
    this.corners = shell ? roomPolygon(shell) : [];
    this.from = this.snap(grab);
    this.to = this.from;
  }

  move(point: Point2): PlanPreview {
    this.to = this.snap(point);
    return { measure: { from: this.from, to: this.to } };
  }

  end(): PlanPreview | null {
    return Math.hypot(this.to.x - this.from.x, this.to.z - this.from.z) < 0.02 ? null : { measure: { from: this.from, to: this.to } };
  }

  private snap(p: Point2): Point2 {
    const corner = this.corners.find((c) => Math.hypot(c.x - p.x, c.z - p.z) < SQUARE_SNAP_M);
    return corner ? { ...corner } : { x: cm(p.x), z: cm(p.z) };
  }
}
