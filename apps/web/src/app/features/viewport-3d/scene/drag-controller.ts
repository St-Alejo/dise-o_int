import { signal } from '@angular/core';
import { effectiveDimensions, type CatalogItem, type FurniturePlacement, type RoomShell, type Vector3 } from '@interiores/shared-types';
import * as THREE from 'three';
import { MacroCommand, MoveCommand, RemountCommand, type SceneCommand } from '../commands';
import { MOUNT_STRATEGIES, type MountPose, type MountStrategy, type SupportCandidate } from '../mounts/mount-strategies';
import type { SceneContext } from './render-loop';
import { delta, shifted } from './vec';

/** Lo que el arrastre necesita del estado del proyecto. */
export interface DragStore {
  placements(): readonly FurniturePlacement[];
  catalog(): ReadonlyMap<string, CatalogItem>;
  shell(): RoomShell | null;
  select(id: string | null): void;
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

/** Los muebles tal como están dibujados: se pueden señalar y mover de forma provisional. */
export interface DragTargets {
  pick(raycaster: THREE.Raycaster): string | null;
  place(id: string, position: Vector3, rotationY: number): void;
}

export interface DragHost {
  /** Canvas donde ocurre el gesto (null hasta que el viewport lo monta). */
  canvas(): HTMLCanvasElement | null;
  readOnly(): boolean;
  /** La cámara se suelta mientras se arrastra un mueble. */
  setCameraEnabled(enabled: boolean): void;
  refreshSelection(invalid?: boolean): void;
}

interface Drag {
  id: string;
  catalogItemId: string;
  /** La pieza tal como estaba al empezar (para deshacer y para el montaje). */
  start: FurniturePlacement;
  strategy: MountStrategy;
  grabOffset: { x: number; z: number };
  last: MountPose;
  lastValid: MountPose;
  moved: boolean;
  /** Lo que estaba apoyado encima al empezar: se mueve con el soporte. */
  dependents: FurniturePlacement[];
}

/**
 * Traduce el gesto de señalar y arrastrar a COMANDOS del store: seleccionar con un clic, mover
 * con la estrategia de montaje de la pieza y, al soltar, un solo paso de deshacer.
 */
export class DragController {
  readonly dragging = signal(false);
  readonly invalidDrop = signal(false);

  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private drag: Drag | null = null;
  private pointerDownAt: { x: number; y: number } | null = null;

  constructor(
    private readonly ctx: SceneContext,
    private readonly store: DragStore,
    private readonly targets: DragTargets,
    private readonly host: DragHost,
  ) {}

  /** ¿Esta pieza (o su soporte) se está arrastrando ahora? */
  holds(id: string): boolean {
    return !!this.drag && (this.drag.id === id || this.drag.dependents.some((d) => d.id === id));
  }

  /** Pose provisional de la pieza que se arrastra. */
  poseOf(id: string): MountPose | null {
    return this.drag?.id === id ? this.drag.last : null;
  }

  onPointerDown(event: PointerEvent): void {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
    const id = this.pick(event);
    if (!id) return;
    this.store.select(id);
    if (this.host.readOnly()) return;
    const placement = this.store.placements().find((p) => p.id === id);
    const item = placement ? this.store.catalog().get(placement.catalogItemId) : null;
    if (!placement || !item) return;
    // En piso y techo se conserva el punto agarrado; en pared o superficie el cursor manda.
    const hit = this.floorPoint(event);
    const grabOffset =
      hit && (item.mount === 'floor' || item.mount === 'ceiling')
        ? { x: placement.position.x - hit.x, z: placement.position.z - hit.z }
        : { x: 0, z: 0 };
    const pose: MountPose = {
      position: { ...placement.position },
      rotationY: placement.rotationY,
      ...(placement.wallId ? { wallId: placement.wallId } : {}),
      ...(placement.supportId ? { supportId: placement.supportId } : {}),
    };
    this.drag = {
      id,
      catalogItemId: placement.catalogItemId,
      start: structuredClone(placement),
      strategy: MOUNT_STRATEGIES[item.mount],
      grabOffset,
      last: pose,
      lastValid: pose,
      moved: false,
      dependents: this.store.dependentsOf(id).map((d) => structuredClone(d)),
    };
    this.host.setCameraEnabled(false);
    this.host.canvas()?.setPointerCapture(event.pointerId);
    this.dragging.set(true);
  }

  onPointerMove(event: PointerEvent): void {
    const canvas = this.host.canvas();
    if (!this.drag) {
      if (canvas && event.pointerType === 'mouse') {
        canvas.style.cursor = this.pick(event) ? (this.host.readOnly() ? 'pointer' : 'grab') : '';
      }
      return;
    }
    // Umbral de 4 px: un clic con un leve temblor del mouse no es un arrastre.
    const down = this.pointerDownAt;
    if (!this.drag.moved && down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4) return;
    const item = this.store.catalog().get(this.drag.catalogItemId);
    const shell = this.store.shell();
    if (!item || !shell) return;
    const dims = effectiveDimensions(item.dimensionsM, this.drag.start);
    this.aim(event);
    const { origin, direction } = this.raycaster.ray;
    const pose = this.drag.strategy.poseFor(
      { origin: { x: origin.x, y: origin.y, z: origin.z }, direction: { x: direction.x, y: direction.y, z: direction.z } },
      { shell, dims, rotationY: this.drag.start.rotationY, grabOffset: this.drag.grabOffset, supports: this.supportsFor(this.drag.id) },
    );
    if (!pose) return;
    this.drag.last = pose;
    this.drag.moved = true;
    const valid =
      !pose.blockedBy &&
      this.store.isPoseValid(this.drag.id, this.drag.catalogItemId, pose.position, pose.rotationY, dims, {
        ...(pose.supportId ? { supportId: pose.supportId } : {}),
      });
    if (valid) this.drag.lastValid = pose;
    this.invalidDrop.set(!valid);
    this.targets.place(this.drag.id, pose.position, pose.rotationY);
    // Lo que está encima acompaña al soporte mientras se arrastra.
    const d = delta(this.drag.start.position, pose.position);
    for (const dep of this.drag.dependents) this.targets.place(dep.id, shifted(dep.position, d), dep.rotationY);
    if (canvas) canvas.style.cursor = 'grabbing';
    this.host.refreshSelection(!valid);
  }

  onPointerUp(event: PointerEvent): void {
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!this.drag) {
      // Clic (sin arrastrar la cámara) sobre el vacío → deseleccionar
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5 && !this.pick(event)) this.store.select(null);
      return;
    }
    const { start, lastValid, moved, dependents } = this.drag;
    this.drag = null;
    this.dragging.set(false);
    this.invalidDrop.set(false);
    this.host.setCameraEnabled(true);
    const canvas = this.host.canvas();
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const changed =
      moved &&
      (Math.hypot(start.position.x - lastValid.position.x, start.position.y - lastValid.position.y, start.position.z - lastValid.position.z) > 1e-3 ||
        start.rotationY !== lastValid.rotationY ||
        start.wallId !== lastValid.wallId ||
        start.supportId !== lastValid.supportId);
    if (changed) {
      this.store.execute(this.commandFor(start, lastValid, dependents));
    } else {
      // Si terminó en una pose inválida, vuelve a la última válida (la del store).
      for (const id of [start.id, ...dependents.map((d) => d.id)]) {
        const p = this.store.placements().find((x) => x.id === id);
        if (p) this.targets.place(id, p.position, p.rotationY);
      }
    }
    this.host.refreshSelection();
  }

  private commandFor(start: FurniturePlacement, to: MountPose, dependents: FurniturePlacement[]): SceneCommand {
    const item = this.store.catalog().get(start.catalogItemId);
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

  /** Muebles de piso donde se puede apoyar algo (menos la pieza arrastrada y lo que lleva encima). */
  private supportsFor(placementId: string): SupportCandidate[] {
    const shell = this.store.shell();
    return this.store
      .placements()
      .filter((p) => p.id !== placementId && p.supportId !== placementId)
      .flatMap((p) => {
        const item = this.store.catalog().get(p.catalogItemId);
        if (!item || item.mount !== 'floor' || item.subcategory === 'rug') return [];
        const dims = effectiveDimensions(item.dimensionsM, p);
        if (shell && dims.y > shell.heightM - 0.3) return []; // un armario hasta el techo no es una mesa
        return [{ id: p.id, position: p.position, rotationY: p.rotationY, dims }];
      });
  }

  /** Apunta el rayo al cursor. */
  private aim(event: PointerEvent): void {
    const rect = this.host.canvas()!.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
  }

  private pick(event: PointerEvent): string | null {
    this.aim(event);
    return this.targets.pick(this.raycaster);
  }

  private floorPoint(event: PointerEvent): THREE.Vector3 | null {
    this.aim(event);
    return this.raycaster.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
  }
}
