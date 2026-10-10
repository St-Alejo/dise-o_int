/**
 * El comando de cambiar las medidas de una pieza (sin Angular): lo usan el inspector, que escribe
 * centímetros, y el gizmo del visor 3D, que estira la pieza con el cursor.
 */
import type { CatalogItem, FurniturePlacement, RoomShell, Vector3 } from '@interiores/shared-types';
import { MacroCommand, MoveCommand, ResizeCommand, type SceneCommand } from '../viewport-3d/commands';
import { proposeResize, sameAsCatalog } from './inspector-model';

/** Lo que hace falta saber del proyecto para redimensionar una pieza (lo cumple `DesignProjectStore`). */
export interface ResizeStore {
  shell(): RoomShell | null;
  isPoseValid(placementId: string, catalogItemId: string, position: Vector3, rotationY: number, dimensionsM?: Vector3): boolean;
  supportTopOf(p: Pick<FurniturePlacement, 'supportId'>): number | null;
  findFreeSpot(placementId: string, item: CatalogItem, near: Vector3, rotationY?: number, dimensionsM?: Vector3): Vector3 | null;
  dependentsOf(id: string): FurniturePlacement[];
}

export interface ResizeResult {
  /** null si con esas medidas no cabe. */
  command: SceneCommand | null;
  error: string | null;
  /** La pieza tuvo que cambiar de sitio para caber. */
  relocated: boolean;
}

/**
 * Comando para dejar la pieza `p` con las medidas `dims`. Con `relocate`, si en su sitio choca se
 * busca el hueco libre más cercano (lo que hace el inspector); sin él, simplemente no se permite
 * (lo que conviene mientras se arrastra un tirador: la pieza no debe saltar de sitio).
 */
export function buildResize(store: ResizeStore, p: FurniturePlacement, item: CatalogItem, dims: Vector3, relocate: boolean): ResizeResult {
  const shell = store.shell();
  if (!shell) return { command: null, error: null, relocated: false };
  const proposal = proposeResize(
    {
      shell,
      isPoseValid: (id, itemId, pos, rot, d) => store.isPoseValid(id, itemId, pos, rot, d),
      supportTopOf: (x) => store.supportTopOf(x),
    },
    p,
    item,
    dims,
  );
  let position = proposal.position;
  let relocated = false;
  if (proposal.reason === 'collision' && relocate && (item.mount === 'floor' || item.mount === 'ceiling')) {
    const free = store.findFreeSpot(p.id, item, proposal.position, p.rotationY, dims);
    if (!free) return { command: null, error: 'Con esas medidas no cabe en ningún lugar libre del cuarto.', relocated: false };
    position = free;
    relocated = true;
  } else if (proposal.error) {
    return { command: null, error: proposal.error, relocated: false };
  }
  const resize = new ResizeCommand(p, sameAsCatalog(item, dims) ? undefined : dims, position);
  // Si cambia el alto o el sitio de un soporte, lo que tiene encima lo acompaña.
  const top = position.y + dims.y;
  const shift = { x: position.x - p.position.x, z: position.z - p.position.z };
  const followers: SceneCommand[] = store
    .dependentsOf(p.id)
    .filter((d) => Math.abs(d.position.y - top) > 1e-4 || Math.abs(shift.x) > 1e-4 || Math.abs(shift.z) > 1e-4)
    .map((d) => new MoveCommand(d.id, d.position, { x: d.position.x + shift.x, y: top, z: d.position.z + shift.z }));
  return { command: followers.length ? new MacroCommand('Cambiar medidas', [resize, ...followers]) : resize, error: null, relocated };
}
