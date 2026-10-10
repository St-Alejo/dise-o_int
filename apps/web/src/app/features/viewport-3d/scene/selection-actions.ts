import { clampToRoom, effectiveDimensions, rotateXZ, snapAngle, wallFrames, type Vector3 } from '@interiores/shared-types';
import type { DesignProjectStore } from '../../project/design-project.store';
import { MacroCommand, MoveCommand, RemountCommand, RemoveCommand, RotateCommand, type SceneCommand } from '../commands';
import { delta, shifted } from './vec';

/** Acciones de teclado y barra sobre la pieza seleccionada: cada una es un paso de deshacer. */
export class SelectionActions {
  constructor(
    private readonly store: DesignProjectStore,
    private readonly readOnly: () => boolean,
  ) {}

  /** Girar un paso: lo que está encima gira con el soporte. Lo de pared no gira. */
  rotate(deltaRad: number): void {
    const p = this.store.selected();
    if (p) this.rotateTo(snapAngle(p.rotationY + deltaRad));
  }

  /** Girar hasta un ángulo concreto (el aro del gizmo). */
  rotateTo(to: number): void {
    const plan = this.rotationPlan(to);
    if (plan) this.store.execute(plan.command);
  }

  /**
   * Cómo quedaría todo si la pieza seleccionada girara hasta `to`: dónde queda ella y lo que
   * lleva encima (para previsualizarlo) y el comando que lo aplica.
   */
  rotationPlan(to: number): { poses: Map<string, { position: Vector3; rotationY: number }>; command: SceneCommand } | null {
    const p = this.store.selected();
    const item = this.store.selectedItem();
    const shell = this.store.shell();
    if (!p || !item || !shell || this.readOnly() || item.mount === 'wall') return null;
    const turn = to - p.rotationY;
    // Al girar, un mueble junto a la pared podría salirse: se reajusta la posición.
    const pos = clampToRoom(p.position, effectiveDimensions(item.dimensionsM, p), to, shell);
    const poses = new Map([[p.id, { position: pos, rotationY: to }]]);
    const main = new RotateCommand(p.id, p.rotationY, to, p.position, pos);
    const followers = this.store.dependentsOf(p.id).map((d) => {
      const local = rotateXZ(d.position.x - p.position.x, d.position.z - p.position.z, turn);
      const np = { x: pos.x + local.x, y: d.position.y, z: pos.z + local.z };
      const rotationY = snapAngle(d.rotationY + turn, 1e-6);
      poses.set(d.id, { position: np, rotationY });
      return new RotateCommand(d.id, d.rotationY, rotationY, d.position, np);
    });
    return { poses, command: followers.length ? new MacroCommand('Rotar mueble', [main, ...followers]) : main };
  }

  /** Flechas: mueve 5 cm (25 con Shift). Lo de pared solo se desliza a lo largo de su pared. */
  nudge(dx: number, dz: number): void {
    const p = this.store.selected();
    const item = this.store.selectedItem();
    const shell = this.store.shell();
    if (!p || !item || !shell || this.readOnly()) return;
    if (item.mount === 'wall') {
      // Solo cuenta la parte del movimiento que va a lo largo de su pared.
      const wall = wallFrames(shell).find((w) => w.id === p.wallId);
      const dir = wall?.dir ?? rotateXZ(1, 0, p.rotationY);
      const along = dx * dir.x + dz * dir.z;
      dx = dir.x * along;
      dz = dir.z * along;
    }
    const dims = effectiveDimensions(item.dimensionsM, p);
    const to = clampToRoom({ x: p.position.x + dx, y: p.position.y, z: p.position.z + dz }, dims, p.rotationY, shell);
    if (!this.store.isPoseValid(p.id, p.catalogItemId, to, p.rotationY, dims)) return;
    const d = delta(p.position, to);
    const followers = this.store.dependentsOf(p.id).map((dep) => new MoveCommand(dep.id, dep.position, shifted(dep.position, d)));
    const main = new MoveCommand(p.id, p.position, to);
    this.store.execute(followers.length ? new MacroCommand('Mover mueble', [main, ...followers]) : main);
  }

  /** Quitar: lo que estaba encima cae al piso (no desaparece con el soporte). */
  remove(): void {
    const p = this.store.selected();
    if (!p || this.readOnly()) return;
    const drops = this.store
      .dependentsOf(p.id)
      .map((d) => new RemountCommand(d, { position: { ...d.position, y: 0 }, rotationY: d.rotationY, supportId: undefined }));
    const remove = new RemoveCommand(p);
    this.store.execute(drops.length ? new MacroCommand('Quitar mueble', [...drops, remove]) : remove);
    this.store.select(null);
  }
}
