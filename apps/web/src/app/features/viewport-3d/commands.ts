/**
 * Patrón Command para editar la escena (§9 del documento): cada edición es un objeto
 * reversible que opera sobre el estado de la escena (datos puros, sin Three.js).
 * Así deshacer/rehacer es trivial y testeable, y la escena 3D solo "refleja" el estado.
 *
 * - `PlacementCommand` (Template Method): los comandos que solo tocan la lista de muebles.
 * - `PatchPlacementCommand`: cambia campos de una pieza (medidas, material, altura, montaje)
 *   recordando los valores previos; los consecutivos sobre lo mismo se FUSIONAN (arrastrar un
 *   slider genera un solo paso de deshacer).
 * - `MacroCommand`: varios comandos como uno (mover una mesa y lo que tiene encima; las
 *   operaciones del chat de IA).
 * - `SetRoomCommand`: la planta del cuarto también se edita con deshacer (mover una pared en el
 *   plano); guarda el cuarto y los muebles de antes y de después.
 */
import type { FurniturePlacement, RoomFinishes, RoomShell, Vector3 } from '@interiores/shared-types';

export type Placements = readonly FurniturePlacement[];

export interface SceneState {
  readonly placements: Placements;
  readonly finishes: RoomFinishes | null;
  /** Planta del cuarto. Solo la tocan los comandos de cuarto; los demás la dejan como está. */
  readonly shell?: RoomShell | null;
}

export interface SceneCommand {
  readonly label: string;
  apply(state: SceneState): SceneState;
  revert(state: SceneState): SceneState;
  /** Si este comando y el siguiente se pueden fusionar en un solo paso de deshacer, el fusionado. */
  mergeWith?(next: SceneCommand): SceneCommand | null;
  /**
   * Parte de un gesto que sigue en curso (arrastrar una pared): se fusiona con el anterior aunque
   * el usuario se detenga un momento a mitad del arrastre.
   */
  readonly continuous?: boolean;
}

const replace = (state: Placements, id: string, fn: (p: FurniturePlacement) => FurniturePlacement): Placements =>
  state.map((p) => (p.id === id ? fn(p) : p));

/** Template Method: los comandos de muebles solo implementan la transformación de la lista. */
export abstract class PlacementCommand implements SceneCommand {
  abstract readonly label: string;
  protected abstract applyTo(placements: Placements): Placements;
  protected abstract revertTo(placements: Placements): Placements;
  apply(s: SceneState): SceneState {
    return { ...s, placements: this.applyTo(s.placements) };
  }
  revert(s: SceneState): SceneState {
    return { ...s, placements: this.revertTo(s.placements) };
  }
}

/**
 * Editar un mueble a mano lo "fija" (el layout automático no lo mueve). Recuerda el estado
 * previo para que deshacer también lo restaure.
 */
class LockMemory {
  private wasLocked: boolean | null = null;
  lock(p: FurniturePlacement): FurniturePlacement {
    this.wasLocked ??= p.lockedByUser;
    return { ...p, lockedByUser: true };
  }
  restore(p: FurniturePlacement): FurniturePlacement {
    return { ...p, lockedByUser: this.wasLocked ?? p.lockedByUser };
  }
}

export class MoveCommand extends PlacementCommand {
  readonly label = 'Mover mueble';
  private readonly lock = new LockMemory();
  constructor(
    private readonly id: string,
    private readonly from: Vector3,
    private readonly to: Vector3,
  ) {
    super();
  }
  protected applyTo(s: Placements) {
    return replace(s, this.id, (p) => this.lock.lock({ ...p, position: { ...this.to } }));
  }
  protected revertTo(s: Placements) {
    return replace(s, this.id, (p) => this.lock.restore({ ...p, position: { ...this.from } }));
  }
}

export class RotateCommand extends PlacementCommand {
  readonly label = 'Rotar mueble';
  private readonly lock = new LockMemory();
  constructor(
    private readonly id: string,
    private readonly from: number,
    private readonly to: number,
    private readonly fromPosition?: Vector3,
    private readonly toPosition?: Vector3,
  ) {
    super();
  }
  protected applyTo(s: Placements) {
    return replace(s, this.id, (p) =>
      this.lock.lock({ ...p, rotationY: this.to, position: this.toPosition ? { ...this.toPosition } : p.position }),
    );
  }
  protected revertTo(s: Placements) {
    return replace(s, this.id, (p) =>
      this.lock.restore({ ...p, rotationY: this.from, position: this.fromPosition ? { ...this.fromPosition } : p.position }),
    );
  }
}

export class AddCommand extends PlacementCommand {
  readonly label: string = 'Añadir mueble';
  constructor(private readonly placement: FurniturePlacement) {
    super();
  }
  protected applyTo(s: Placements) {
    return [...s, { ...this.placement }];
  }
  protected revertTo(s: Placements) {
    return s.filter((p) => p.id !== this.placement.id);
  }
}

/** Duplicar es añadir una copia (con id nuevo) al lado del original. */
export class DuplicateCommand extends AddCommand {
  override readonly label = 'Duplicar mueble';
}

export class RemoveCommand extends PlacementCommand {
  readonly label = 'Quitar mueble';
  private index = -1;
  constructor(private readonly placement: FurniturePlacement) {
    super();
  }
  protected applyTo(s: Placements) {
    this.index = s.findIndex((p) => p.id === this.placement.id);
    return s.filter((p) => p.id !== this.placement.id);
  }
  protected revertTo(s: Placements) {
    const out = [...s];
    out.splice(this.index < 0 ? out.length : this.index, 0, { ...this.placement });
    return out;
  }
}

export class SwapCommand extends PlacementCommand {
  readonly label = 'Cambiar mueble';
  private readonly lock = new LockMemory();
  constructor(
    private readonly id: string,
    private readonly fromItem: string,
    private readonly toItem: string,
    private readonly fromPosition: Vector3,
    private readonly toPosition: Vector3,
  ) {
    super();
  }
  /** Medidas y materiales propios del mueble anterior, para restaurarlos al deshacer. */
  private previous: Pick<FurniturePlacement, 'dimensionsM' | 'materials'> | null = null;
  protected applyTo(s: Placements) {
    // Las medidas y materiales propios eran del mueble anterior: el nuevo empieza con los suyos.
    return replace(s, this.id, (p) => {
      const { dimensionsM, materials, ...rest } = p;
      this.previous ??= { ...(dimensionsM ? { dimensionsM } : {}), ...(materials ? { materials } : {}) };
      return this.lock.lock({ ...rest, catalogItemId: this.toItem, position: { ...this.toPosition } });
    });
  }
  protected revertTo(s: Placements) {
    return replace(s, this.id, (p) =>
      this.lock.restore({ ...p, ...this.previous, catalogItemId: this.fromItem, position: { ...this.fromPosition } }),
    );
  }
}

/** Campos de una pieza que se pueden "parchear" (undefined = el campo no existe). */
export type PlacementPatch = Partial<Omit<FurniturePlacement, 'id' | 'catalogItemId'>>;

function patch(p: FurniturePlacement, values: PlacementPatch): FurniturePlacement {
  const out: Record<string, unknown> = { ...p };
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete out[k];
    else out[k] = structuredClone(v);
  }
  return out as unknown as FurniturePlacement;
}

/**
 * Cambia campos de una pieza guardando sus valores anteriores. `mergeKey` identifica "la misma
 * edición" (p. ej. `resize:p1`): dos parches seguidos con la misma clave se fusionan en uno que
 * va del estado original al último.
 */
export class PatchPlacementCommand extends PlacementCommand {
  private readonly lock = new LockMemory();
  constructor(
    readonly label: string,
    readonly id: string,
    readonly before: PlacementPatch,
    readonly after: PlacementPatch,
    readonly mergeKey: string,
  ) {
    super();
  }
  protected applyTo(s: Placements) {
    return replace(s, this.id, (p) => this.lock.lock(patch(p, this.after)));
  }
  protected revertTo(s: Placements) {
    return replace(s, this.id, (p) => this.lock.restore(patch(p, this.before)));
  }
  mergeWith(next: SceneCommand): SceneCommand | null {
    if (!(next instanceof PatchPlacementCommand) || next.mergeKey !== this.mergeKey || next.id !== this.id) return null;
    return new PatchPlacementCommand(this.label, this.id, { ...next.before, ...this.before }, { ...this.after, ...next.after }, this.mergeKey);
  }
}

const pick = (p: FurniturePlacement, keys: (keyof PlacementPatch)[]): PlacementPatch =>
  Object.fromEntries(keys.map((k) => [k, p[k]])) as PlacementPatch;

/** Medidas propias (y la posición, que puede reajustarse para que siga cabiendo). */
export class ResizeCommand extends PatchPlacementCommand {
  constructor(p: FurniturePlacement, to: Vector3 | undefined, position: Vector3 = p.position) {
    super('Cambiar medidas', p.id, pick(p, ['dimensionsM', 'position']), { dimensionsM: to, position }, `resize:${p.id}`);
  }
}

export class SetMaterialCommand extends PatchPlacementCommand {
  constructor(p: FurniturePlacement, slot: string, materialId: string | undefined) {
    const materials = { ...(p.materials ?? {}) };
    if (materialId === undefined) delete materials[slot];
    else materials[slot] = materialId;
    super('Cambiar material', p.id, pick(p, ['materials']), { materials: Object.keys(materials).length ? materials : undefined }, `material:${p.id}:${slot}`);
  }
}

/** Altura de un objeto de pared. */
export class SetElevationCommand extends PatchPlacementCommand {
  constructor(p: FurniturePlacement, elevationM: number) {
    super('Cambiar altura', p.id, pick(p, ['elevationM', 'position']), { elevationM, position: { ...p.position, y: elevationM } }, `elevation:${p.id}`);
  }
}

let remountSeq = 0;

/** Mover con cambio de montaje (otra pared, otro soporte) en un solo paso; nunca se fusiona. */
export class RemountCommand extends PatchPlacementCommand {
  constructor(p: FurniturePlacement, to: Pick<FurniturePlacement, 'position' | 'rotationY'> & PlacementPatch) {
    super('Mover mueble', p.id, pick(p, ['position', 'rotationY', 'wallId', 'supportId', 'elevationM']), to, `remount:${p.id}:${++remountSeq}`);
  }
}

/** Bloquear o desbloquear explícitamente (el layout automático respeta los bloqueados). */
export class SetLockCommand extends PlacementCommand {
  readonly label: string;
  private previous: boolean | null = null;
  constructor(
    private readonly id: string,
    private readonly locked: boolean,
  ) {
    super();
    this.label = locked ? 'Bloquear mueble' : 'Desbloquear mueble';
  }
  protected applyTo(s: Placements) {
    return replace(s, this.id, (p) => {
      this.previous ??= p.lockedByUser;
      return { ...p, lockedByUser: this.locked };
    });
  }
  protected revertTo(s: Placements) {
    return replace(s, this.id, (p) => ({ ...p, lockedByUser: this.previous ?? p.lockedByUser }));
  }
}

/** Sustituye una pieza entera por su nuevo estado (las operaciones del chat traen la pieza final). */
export class ReplacePlacementCommand extends PlacementCommand {
  readonly label = 'Editar mueble';
  constructor(
    private readonly before: FurniturePlacement,
    private readonly after: FurniturePlacement,
  ) {
    super();
  }
  protected applyTo(s: Placements) {
    return replace(s, this.after.id, () => ({ ...this.after }));
  }
  protected revertTo(s: Placements) {
    return replace(s, this.before.id, () => ({ ...this.before }));
  }
}

/** Acabados del cuarto (piso, paredes, techo). Consecutivos se fusionan. */
export class SetFinishesCommand implements SceneCommand {
  readonly label = 'Cambiar acabados';
  constructor(
    readonly from: RoomFinishes | null,
    readonly to: RoomFinishes | null,
  ) {}
  apply(s: SceneState): SceneState {
    return { ...s, finishes: this.to ? structuredClone(this.to) : null };
  }
  revert(s: SceneState): SceneState {
    return { ...s, finishes: this.from ? structuredClone(this.from) : null };
  }
  mergeWith(next: SceneCommand): SceneCommand | null {
    return next instanceof SetFinishesCommand ? new SetFinishesCommand(this.from, next.to) : null;
  }
}

/** El cuarto y sus muebles en un momento dado. */
export interface RoomSnapshot {
  readonly shell: RoomShell;
  readonly placements: Placements;
}

let gestureSeq = 0;
/** Clave única para los comandos de un mismo gesto (se fusionan entre sí y con nadie más). */
export const newGestureKey = (): string => `gesture:${++gestureSeq}`;

/**
 * Cambia la planta del cuarto (y los muebles, que se reacomodan con ella). Los comandos de un
 * mismo gesto comparten `gestureKey` y se fusionan: arrastrar una pared es un solo paso de deshacer.
 */
export class SetRoomCommand implements SceneCommand {
  readonly continuous: boolean;
  constructor(
    readonly label: string,
    readonly before: RoomSnapshot,
    readonly after: RoomSnapshot,
    readonly gestureKey: string | null = null,
  ) {
    this.continuous = gestureKey !== null;
  }
  apply(s: SceneState): SceneState {
    return { ...s, shell: this.after.shell, placements: this.after.placements };
  }
  revert(s: SceneState): SceneState {
    return { ...s, shell: this.before.shell, placements: this.before.placements };
  }
  mergeWith(next: SceneCommand): SceneCommand | null {
    if (!(next instanceof SetRoomCommand) || !this.gestureKey || next.gestureKey !== this.gestureKey) return null;
    return new SetRoomCommand(this.label, this.before, next.after, this.gestureKey);
  }
}

/** Composite de comandos: se aplican en orden y se revierten al revés, como un solo paso. */
export class MacroCommand implements SceneCommand {
  constructor(
    readonly label: string,
    readonly commands: readonly SceneCommand[],
  ) {}
  apply(s: SceneState): SceneState {
    return this.commands.reduce((acc, c) => c.apply(acc), s);
  }
  revert(s: SceneState): SceneState {
    return [...this.commands].reverse().reduce((acc, c) => c.revert(acc), s);
  }
}

/** Historial acotado de comandos con deshacer/rehacer y fusión de ediciones continuas. */
export class CommandHistory {
  private undoStack: SceneCommand[] = [];
  private redoStack: SceneCommand[] = [];
  private lastAt = -Infinity;
  /** Ventana para fusionar ediciones continuas (arrastre de un slider). */
  static readonly MERGE_WINDOW_MS = 800;
  /** Reloj inyectable (las pruebas lo fijan). */
  clock: () => number = () => Date.now();

  constructor(private readonly limit = 100) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get nextUndoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get nextRedoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  execute(cmd: SceneCommand, state: SceneState): SceneState {
    const next = cmd.apply(state);
    const now = this.clock();
    const top = this.undoStack.at(-1);
    const inWindow = cmd.continuous === true || now - this.lastAt < CommandHistory.MERGE_WINDOW_MS;
    const merged = top && this.redoStack.length === 0 && inWindow ? top.mergeWith?.(cmd) : null;
    if (merged) {
      this.undoStack[this.undoStack.length - 1] = merged;
    } else {
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastAt = now;
    return next;
  }

  undo(state: SceneState): SceneState {
    const cmd = this.undoStack.pop();
    if (!cmd) return state;
    this.redoStack.push(cmd);
    this.lastAt = -Infinity; // tras deshacer, la siguiente edición no se fusiona
    return cmd.revert(state);
  }

  redo(state: SceneState): SceneState {
    const cmd = this.redoStack.pop();
    if (!cmd) return state;
    this.undoStack.push(cmd);
    this.lastAt = -Infinity;
    return cmd.apply(state);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastAt = -Infinity;
  }
}
