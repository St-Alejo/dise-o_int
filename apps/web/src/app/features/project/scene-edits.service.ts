import { Injectable, inject, signal } from '@angular/core';
import {
  RoomGeometryError,
  addOpening,
  alignDeltas,
  distributeDeltas,
  footprint,
  footprintBounds,
  carryPlacements,
  effectiveDimensions,
  mountY,
  removeOpening,
  removeVertex,
  resizeOpening,
  setRoomHeight,
  splitWall,
  type AlignMode,
  type ArrangeBox,
  type CatalogItem,
  type FurniturePlacement,
  type Opening,
  type Point2,
  type RoomEdit,
  type RoomShell,
} from '@interiores/shared-types';
import { newPlacementId } from '../../core/ids';
import { ToastService } from '../../core/ui/toast.service';
import { AddCommand, DuplicateCommand, MacroCommand, MoveCommand, RemountCommand, RemoveCommand, SetLockCommand, SetRoomCommand } from '../viewport-3d/commands';
import { DesignProjectStore } from './design-project.store';

/**
 * Ediciones de la escena que se lanzan desde varios sitios (catálogo, inspector, lista de objetos,
 * atajos de teclado, soltar sobre el plano o el visor). Cada una es un comando del store, así que
 * todas se deshacen igual.
 */
@Injectable()
export class SceneEditsService {
  private readonly store = inject(DesignProjectStore);
  private readonly toast = inject(ToastService);

  /** Mueble del catálogo que se está arrastrando hacia el plano o el visor. */
  readonly dragged = signal<CatalogItem | null>(null);
  /** Pieza copiada con Ctrl+C (una foto: se puede pegar aunque la original ya no esté). */
  private readonly clipboard = signal<FurniturePlacement | null>(null);
  readonly canPaste = () => this.clipboard() !== null;

  /**
   * Añade un mueble del catálogo. Con `near` (un punto del piso) los de piso y techo quedan en el
   * hueco libre más cercano a ese punto; los de pared y los que van sobre otro mueble eligen su
   * sitio según su montaje.
   */
  add(item: CatalogItem, near?: Point2): string | null {
    const shell = this.store.shell();
    if (!shell) return null;
    const id = newPlacementId();
    let plan = this.store.planPlacement(id, item);
    if (near && (item.mount === 'floor' || item.mount === 'ceiling')) {
      const y = mountY(item.mount, item.dimensionsM, shell, { elevationDefaultM: item.elevationDefaultM });
      const position = this.store.findFreeSpot(id, item, { x: near.x, y, z: near.z });
      plan = position ? { position, rotationY: 0 } : null;
    }
    if (!plan) {
      const where = item.mount === 'wall' ? 'en las paredes' : 'libre';
      this.toast.error(`No hay espacio ${where} para "${item.name}". Quita o mueve algo primero.`);
      return null;
    }
    this.store.execute(new AddCommand({ id, catalogItemId: item.id, lockedByUser: true, origin: 'user', ...plan }));
    this.store.select(id);
    if (plan.supportId) {
      const support = this.store.placements().find((p) => p.id === plan.supportId);
      const name = support ? this.store.catalog().get(support.catalogItemId)?.name : null;
      if (name) this.toast.success(`"${item.name}" quedó sobre ${name}.`);
    }
    return id;
  }

  /** Copia con sus medidas y materiales, en el hueco libre más cercano (o en otra pared o soporte). */
  duplicate(source: FurniturePlacement | null = this.store.selected()): string | null {
    const item = source ? this.store.catalog().get(source.catalogItemId) : null;
    const dims = source ? this.store.placementDimensions(source) : null;
    if (!source || !item || !dims) return null;
    const id = newPlacementId();
    let copy: FurniturePlacement | null = null;
    if (item.mount === 'floor' || item.mount === 'ceiling') {
      const near = { x: source.position.x + dims.x + 0.05, y: source.position.y, z: source.position.z };
      const position = this.store.findFreeSpot(id, item, near, source.rotationY, dims);
      if (position) copy = { ...structuredClone(source), id, position, origin: 'user' };
    } else {
      const plan = this.store.planPlacement(id, item);
      if (plan) {
        const { supportId: _s, wallId: _w, elevationM: _e, ...rest } = structuredClone(source);
        copy = { ...rest, id, origin: 'user', ...plan };
      }
    }
    if (!copy) {
      this.toast.error('No hay espacio libre para duplicarlo. Mueve algo primero.');
      return null;
    }
    this.store.execute(new DuplicateCommand(copy));
    this.store.select(id);
    return id;
  }

  copy(): boolean {
    const selected = this.store.selected();
    if (!selected) return false;
    this.clipboard.set(structuredClone(selected));
    this.toast.show('Mueble copiado: Ctrl+V lo pega');
    return true;
  }

  paste(): boolean {
    const source = this.clipboard();
    if (!source) return false;
    this.duplicate(source);
    return true;
  }

  toggleLock(placement: FurniturePlacement): void {
    this.store.execute(new SetLockCommand(placement.id, !placement.lockedByUser));
  }

  /** Quita todos los muebles en un solo paso (Ctrl+Z los devuelve). */
  clear(): void {
    const all = this.store.placements();
    if (!all.length) return;
    this.store.select(null);
    this.store.execute(
      new MacroCommand(
        'Vaciar cuarto',
        all.map((p) => new RemoveCommand(p)),
      ),
    );
    this.toast.show('Cuarto vacío. Ctrl+Z devuelve los muebles');
  }

  // ------------------------------------------------------------------ varios muebles a la vez
  /** Alinea las piezas seleccionadas por un borde o por el centro. */
  align(mode: AlignMode): void {
    this.moveGroup(alignDeltas(this.arrangeBoxes(), mode), 'Alinear muebles');
  }

  /** Reparte las piezas seleccionadas con la misma separación entre ellas. */
  distribute(axis: 'x' | 'z'): void {
    this.moveGroup(distributeDeltas(this.arrangeBoxes(), axis), 'Repartir muebles');
  }

  /** Mueve juntas todas las piezas seleccionadas (flechas del teclado). */
  nudgeSelection(dx: number, dz: number): void {
    this.moveGroup(new Map(this.arrangeBoxes().map((b) => [b.id, { x: dx, z: dz }])), 'Mover muebles', false);
  }

  duplicateSelection(): void {
    const sources = this.store.selection();
    const copies = sources.flatMap((p) => {
      const id = this.duplicate(p);
      return id ? [id] : [];
    });
    if (copies.length) this.store.selectMany(copies);
  }

  lockSelection(locked: boolean): void {
    const targets = this.store.selection().filter((p) => p.lockedByUser !== locked);
    if (targets.length) {
      this.store.execute(
        new MacroCommand(
          locked ? 'Fijar muebles' : 'Soltar muebles',
          targets.map((p) => new SetLockCommand(p.id, locked)),
        ),
      );
    }
  }

  /** Quita todas las piezas seleccionadas; lo que tenían encima y no estaba elegido cae al piso. */
  removeSelection(): void {
    const selected = this.store.selection();
    if (!selected.length) return;
    const ids = new Set(selected.map((p) => p.id));
    const drops = this.store
      .placements()
      .filter((p) => p.supportId && ids.has(p.supportId) && !ids.has(p.id))
      .map((d) => new RemountCommand(d, { position: { ...d.position, y: 0 }, rotationY: d.rotationY, supportId: undefined }));
    this.store.select(null);
    this.store.execute(new MacroCommand(selected.length > 1 ? 'Quitar muebles' : 'Quitar mueble', [...drops, ...selected.map((p) => new RemoveCommand(p))]));
  }

  /** Cajas en planta de las piezas seleccionadas que se pueden mover por el piso (ni colgadas ni apoyadas). */
  private arrangeBoxes(): ArrangeBox[] {
    const catalog = this.store.catalog();
    return this.store.selection().flatMap((p) => {
      const item = catalog.get(p.catalogItemId);
      if (!item || p.supportId || p.wallId || item.mount === 'wall') return [];
      return [{ id: p.id, ...footprintBounds(footprint(p.position, effectiveDimensions(item.dimensionsM, p), p.rotationY)) }];
    });
  }

  /** Mueve cada pieza lo que diga `deltas` (y lo que lleva encima), si el conjunto cabe. */
  private moveGroup(deltas: ReadonlyMap<string, Point2>, label: string, explain = true): void {
    const placements = this.store.placements();
    const moved = new Map<string, FurniturePlacement['position']>();
    const commands: MoveCommand[] = [];
    for (const p of placements) {
      // Una pieza apoyada sigue a su soporte aunque no esté seleccionada.
      const delta = deltas.get(p.id) ?? (p.supportId ? deltas.get(p.supportId) : undefined);
      if (!delta || (Math.abs(delta.x) < 1e-4 && Math.abs(delta.z) < 1e-4)) continue;
      const to = { x: p.position.x + delta.x, y: p.position.y, z: p.position.z + delta.z };
      moved.set(p.id, to);
      commands.push(new MoveCommand(p.id, p.position, to));
    }
    if (!commands.length) return;
    if (!this.store.isGroupValid(moved)) {
      if (explain) this.toast.error('Así no caben: alguno se sale del cuarto o choca con otro mueble.');
      return;
    }
    this.store.execute(new MacroCommand(label, commands));
  }

  // ------------------------------------------------------------------ el cuarto
  addOpening(wallId: string, type: Opening['type']): void {
    const label = type === 'door' ? 'Añadir puerta' : 'Añadir ventana';
    const done = this.editRoom(label, (shell) => addOpening(shell, wallId, type));
    if (done) {
      const added = done.openings.at(-1);
      if (added) this.store.roomTarget.set({ kind: 'opening', openingId: added.id });
    }
  }

  removeOpening(openingId: string): void {
    if (this.editRoom('Quitar abertura', (shell) => removeOpening(shell, openingId))) this.store.roomTarget.set(null);
  }

  resizeOpening(openingId: string, widthM: number): void {
    this.editRoom('Cambiar abertura', (shell) => resizeOpening(shell, openingId, { widthM }));
  }

  splitWall(wallId: string): void {
    const done = this.editRoom('Partir pared', (shell) => splitWall(shell, wallId));
    if (done) {
      // La esquina nueva es donde empieza la segunda mitad: queda elegida para moverla o quitarla.
      const index = done.walls.findIndex((w) => w.id === wallId) + 1;
      this.store.roomTarget.set({ kind: 'vertex', index });
    }
  }

  removeVertex(index: number): void {
    if (this.editRoom('Quitar esquina', (shell) => removeVertex(shell, index))) this.store.roomTarget.set(null);
  }

  setRoomHeight(heightM: number): void {
    this.editRoom('Cambiar alto del cuarto', (shell) => setRoomHeight(shell, heightM));
  }

  /**
   * Aplica una edición de la planta como un paso de deshacer; los muebles se reacomodan con ella
   * (lo colgado del techo sube o baja con él). Si el cuarto resultante no es válido, se explica.
   */
  private editRoom(label: string, edit: (shell: RoomShell) => RoomEdit | RoomShell): RoomShell | null {
    const shell = this.store.shell();
    if (!shell) return null;
    let result: RoomEdit;
    try {
      const out = edit(shell);
      result = 'shell' in out ? out : { shell: out, shift: { x: 0, z: 0 } };
    } catch (err) {
      if (!(err instanceof RoomGeometryError)) throw err;
      this.toast.error(err.message);
      return null;
    }
    const catalog = this.store.catalog();
    const before = this.store.placements();
    const carried = carryPlacements(
      before,
      (p) => {
        const item = catalog.get(p.catalogItemId);
        return item ? effectiveDimensions(item.dimensionsM, p) : undefined;
      },
      result,
    ).map((p) => {
      const item = catalog.get(p.catalogItemId);
      if (!item) return p;
      const dims = effectiveDimensions(item.dimensionsM, p);
      const top = Math.max(0, result.shell.heightM - dims.y);
      if (item.mount === 'ceiling') return { ...p, position: { ...p.position, y: top } };
      // Lo colgado en la pared no puede quedar atravesando un techo más bajo.
      return p.wallId && p.position.y > top ? { ...p, position: { ...p.position, y: top }, elevationM: top } : p;
    });
    this.store.execute(new SetRoomCommand(label, { shell, placements: before }, { shell: result.shell, placements: carried }));
    return result.shell;
  }
}
