import type { CatalogItem, FurniturePlacement, Vector3 } from '@interiores/shared-types';
import { MacroCommand, MoveCommand, RemountCommand, type SceneCommand } from '../commands';
import { delta, shifted } from './vec';

/** Dónde queda una pieza tras arrastrarla (en el visor 3D o en el plano). */
export interface MovedPose {
  position: Vector3;
  rotationY: number;
  wallId?: string;
  supportId?: string;
  elevationM?: number;
}

/**
 * El comando de soltar una pieza arrastrada: un solo paso de deshacer que mueve también lo que
 * tenía encima. Si solo cambió de sitio en el piso es un `MoveCommand`; si cambió de pared, de
 * soporte o de giro, un `RemountCommand`.
 */
export function moveCommandFor(
  start: FurniturePlacement,
  to: MovedPose,
  item: CatalogItem | undefined,
  dependents: readonly FurniturePlacement[],
): SceneCommand {
  const simpleMove = (item?.mount === 'floor' || item?.mount === 'ceiling') && start.rotationY === to.rotationY;
  const main = simpleMove
    ? new MoveCommand(start.id, start.position, to.position)
    : new RemountCommand(start, {
        position: to.position,
        rotationY: to.rotationY,
        wallId: to.wallId,
        supportId: to.supportId,
        elevationM: to.elevationM,
      });
  const d = delta(start.position, to.position);
  const followers = dependents.map((dep) => new MoveCommand(dep.id, dep.position, shifted(dep.position, d)));
  return followers.length ? new MacroCommand('Mover mueble', [main, ...followers]) : main;
}
