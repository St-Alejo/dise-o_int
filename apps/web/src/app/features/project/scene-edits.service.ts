import { Injectable, inject, signal } from '@angular/core';
import { mountY, type CatalogItem, type FurniturePlacement, type Point2 } from '@interiores/shared-types';
import { newPlacementId } from '../../core/ids';
import { ToastService } from '../../core/ui/toast.service';
import { AddCommand, DuplicateCommand, MacroCommand, RemoveCommand, SetLockCommand } from '../viewport-3d/commands';
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
}
