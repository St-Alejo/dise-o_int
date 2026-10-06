/**
 * Patrón Command para editar la escena (§9 del documento): cada edición es un objeto
 * reversible que opera sobre la lista de placements (datos puros, sin Three.js).
 * Así deshacer/rehacer es trivial y testeable, y la escena 3D solo "refleja" el estado.
 */
import type { FurniturePlacement, Vector3 } from '@interiores/shared-types';

export type Placements = readonly FurniturePlacement[];

export interface SceneCommand {
  readonly label: string;
  apply(state: Placements): Placements;
  revert(state: Placements): Placements;
}

const replace = (state: Placements, id: string, fn: (p: FurniturePlacement) => FurniturePlacement): Placements =>
  state.map((p) => (p.id === id ? fn(p) : p));

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

export class MoveCommand implements SceneCommand {
  readonly label = 'Mover mueble';
  private readonly lock = new LockMemory();
  constructor(
    private readonly id: string,
    private readonly from: Vector3,
    private readonly to: Vector3,
  ) {}
  apply(s: Placements) {
    return replace(s, this.id, (p) => this.lock.lock({ ...p, position: { ...this.to } }));
  }
  revert(s: Placements) {
    return replace(s, this.id, (p) => this.lock.restore({ ...p, position: { ...this.from } }));
  }
}

export class RotateCommand implements SceneCommand {
  readonly label = 'Rotar mueble';
  private readonly lock = new LockMemory();
  constructor(
    private readonly id: string,
    private readonly from: number,
    private readonly to: number,
    private readonly fromPosition?: Vector3,
    private readonly toPosition?: Vector3,
  ) {}
  apply(s: Placements) {
    return replace(s, this.id, (p) =>
      this.lock.lock({ ...p, rotationY: this.to, position: this.toPosition ? { ...this.toPosition } : p.position }),
    );
  }
  revert(s: Placements) {
    return replace(s, this.id, (p) =>
      this.lock.restore({ ...p, rotationY: this.from, position: this.fromPosition ? { ...this.fromPosition } : p.position }),
    );
  }
}

export class AddCommand implements SceneCommand {
  readonly label = 'Añadir mueble';
  constructor(private readonly placement: FurniturePlacement) {}
  apply(s: Placements) {
    return [...s, { ...this.placement }];
  }
  revert(s: Placements) {
    return s.filter((p) => p.id !== this.placement.id);
  }
}

export class RemoveCommand implements SceneCommand {
  readonly label = 'Quitar mueble';
  private index = -1;
  constructor(private readonly placement: FurniturePlacement) {}
  apply(s: Placements) {
    this.index = s.findIndex((p) => p.id === this.placement.id);
    return s.filter((p) => p.id !== this.placement.id);
  }
  revert(s: Placements) {
    const out = [...s];
    out.splice(this.index < 0 ? out.length : this.index, 0, { ...this.placement });
    return out;
  }
}

export class SwapCommand implements SceneCommand {
  readonly label = 'Cambiar mueble';
  private readonly lock = new LockMemory();
  constructor(
    private readonly id: string,
    private readonly fromItem: string,
    private readonly toItem: string,
    private readonly fromPosition: Vector3,
    private readonly toPosition: Vector3,
  ) {}
  apply(s: Placements) {
    return replace(s, this.id, (p) => this.lock.lock({ ...p, catalogItemId: this.toItem, position: { ...this.toPosition } }));
  }
  revert(s: Placements) {
    return replace(s, this.id, (p) => this.lock.restore({ ...p, catalogItemId: this.fromItem, position: { ...this.fromPosition } }));
  }
}

/** Historial acotado de comandos con deshacer/rehacer. */
export class CommandHistory {
  private undoStack: SceneCommand[] = [];
  private redoStack: SceneCommand[] = [];

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

  execute(cmd: SceneCommand, state: Placements): Placements {
    const next = cmd.apply(state);
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return next;
  }

  undo(state: Placements): Placements {
    const cmd = this.undoStack.pop();
    if (!cmd) return state;
    this.redoStack.push(cmd);
    return cmd.revert(state);
  }

  redo(state: Placements): Placements {
    const cmd = this.redoStack.pop();
    if (!cmd) return state;
    this.undoStack.push(cmd);
    return cmd.apply(state);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
