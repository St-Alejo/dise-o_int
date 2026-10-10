import { signal } from '@angular/core';
import { effectiveDimensions, type CatalogItem, type FurniturePlacement, type RoomShell, type Vector3 } from '@interiores/shared-types';
import { nextDimensions, resizeRanges, type Axis } from '../../inspector/inspector-model';
import { buildResize, type ResizeStore } from '../../inspector/resize-command';
import { SetElevationCommand, SetPlacementsCommand, newGestureKey, type SceneCommand } from '../commands';
import { angleTo, gizmoLayout, heightAlongVertical, rotationFromDrag, sizeFromDrag, type GizmoHandleKind, type GizmoLayout } from '../mounts/gizmo-math';
import { intersectHorizontal, type Ray } from '../mounts/mount-strategies';

/** Paso al que se ajusta el giro con el aro (15°); con Alt se gira libre. */
export const ROTATE_STEP = Math.PI / 12;

export interface GizmoStore extends ResizeStore {
  selected(): FurniturePlacement | null;
  selectedItem(): CatalogItem | null;
  placements(): readonly FurniturePlacement[];
  shell(): RoomShell | null;
  execute(cmd: SceneCommand): void;
}

/** Lo que el gizmo necesita de quien gira las piezas (lo cumple `SelectionActions`). */
export interface GizmoRotator {
  rotationPlan(to: number): { poses: ReadonlyMap<string, { position: Vector3; rotationY: number }>; command: SceneCommand } | null;
}

export interface GizmoPointer {
  ray: Ray;
  /** Con Alt el giro no se ajusta a pasos de 15°. */
  free: boolean;
}

interface Drag {
  kind: GizmoHandleKind;
  start: FurniturePlacement;
  item: CatalogItem;
  startDims: Vector3;
  /** Estado de todos los muebles al empezar: cada paso se calcula desde aquí. */
  before: readonly FurniturePlacement[];
  key: string;
  grabAngle: number;
  rotation: number;
  last: number | null;
}

const AXIS_OF: Record<'width' | 'depth' | 'height', Axis> = { width: 'x', depth: 'z', height: 'y' };
const cm = (v: number) => Math.round(v * 100) / 100;

/**
 * Traduce el arrastre de un tirador del gizmo a comandos: girar es un paso de deshacer al soltar
 * (mientras tanto solo se previsualiza); estirar aplica la medida en vivo y todos los pasos del
 * mismo gesto se fusionan en uno.
 */
export class GizmoController {
  /** Tirador que se está arrastrando. */
  readonly active = signal<GizmoHandleKind | null>(null);
  /** Por qué no se puede aplicar lo que pide el cursor (choca, no cabe bajo el techo). */
  readonly message = signal<string | null>(null);
  private drag: Drag | null = null;

  constructor(
    private readonly store: GizmoStore,
    private readonly rotator: GizmoRotator,
    private readonly preview: (poses: ReadonlyMap<string, { position: Vector3; rotationY: number }> | null) => void,
  ) {}

  /** El gizmo de la pieza seleccionada, o null si no hay nada que mostrar. */
  layout(pose?: { position: Vector3; rotationY: number } | null): GizmoLayout | null {
    const p = this.store.selected();
    const item = this.store.selectedItem();
    if (!p || !item || p.supportId) return null; // lo apoyado se mueve con su soporte
    const ranges = resizeRanges(item);
    return gizmoLayout(pose?.position ?? p.position, effectiveDimensions(item.dimensionsM, p), this.drag?.kind === 'rotate' ? this.drag.rotation : (pose?.rotationY ?? p.rotationY), {
      resizable: { x: !!ranges.x, y: !!ranges.y, z: !!ranges.z },
      onWall: item.mount === 'wall',
    });
  }

  begin(kind: GizmoHandleKind, pointer: GizmoPointer): boolean {
    const start = this.store.selected();
    const item = this.store.selectedItem();
    if (!start || !item) return false;
    const floor = intersectHorizontal(pointer.ray, start.position.y);
    this.drag = {
      kind,
      start: structuredClone(start),
      item,
      startDims: effectiveDimensions(item.dimensionsM, start),
      before: this.store.placements(),
      key: newGestureKey(),
      grabAngle: floor ? angleTo(start.position, floor) : 0,
      rotation: start.rotationY,
      last: null,
    };
    this.active.set(kind);
    return true;
  }

  move(pointer: GizmoPointer): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === 'rotate') this.rotate(drag, pointer);
    else if (drag.kind === 'elevation') this.elevate(drag, pointer);
    else this.resize(drag, drag.kind, pointer);
  }

  end(): void {
    const drag = this.drag;
    this.drag = null;
    this.active.set(null);
    this.message.set(null);
    if (!drag) return;
    if (drag.kind === 'rotate') {
      this.preview(null);
      if (Math.abs(drag.rotation - drag.start.rotationY) > 1e-4) {
        const plan = this.rotator.rotationPlan(drag.rotation);
        if (plan) this.store.execute(plan.command);
      }
    }
  }

  private rotate(drag: Drag, pointer: GizmoPointer): void {
    const floor = intersectHorizontal(pointer.ray, drag.start.position.y);
    if (!floor) return;
    drag.rotation = rotationFromDrag(drag.start.rotationY, drag.grabAngle, angleTo(drag.start.position, floor), pointer.free ? null : ROTATE_STEP);
    const plan = this.rotator.rotationPlan(drag.rotation);
    if (plan) this.preview(plan.poses);
  }

  private resize(drag: Drag, kind: 'width' | 'depth' | 'height', pointer: GizmoPointer): void {
    const current = this.store.selected();
    if (!current) return;
    const raw = sizeFromDrag(kind, pointer.ray, current.position, drag.startDims, current.rotationY);
    if (raw === null) return;
    const axis = AXIS_OF[kind];
    const dims = nextDimensions(drag.item, drag.startDims, axis, cm(raw), false);
    if (dims[axis] === drag.last) return;
    const result = buildResize(this.store, drag.start, drag.item, dims, false);
    this.message.set(result.error);
    if (!result.command) return;
    drag.last = dims[axis];
    this.apply(drag, 'Cambiar medidas', result.command);
  }

  private elevate(drag: Drag, pointer: GizmoPointer): void {
    const shell = this.store.shell();
    const y = heightAlongVertical(pointer.ray, drag.start.position);
    if (!shell || y === null) return;
    const dims = drag.startDims;
    const elevation = cm(Math.min(Math.max(0, shell.heightM - dims.y), Math.max(0, y - dims.y / 2)));
    if (elevation === drag.last) return;
    if (!this.store.isPoseValid(drag.start.id, drag.start.catalogItemId, { ...drag.start.position, y: elevation }, drag.start.rotationY, dims)) {
      this.message.set('A esa altura choca con otro objeto de la pared.');
      return;
    }
    this.message.set(null);
    drag.last = elevation;
    this.apply(drag, 'Cambiar altura', new SetElevationCommand(drag.start, elevation));
  }

  /** Aplica `command` sobre el estado inicial del gesto y lo deja como un solo paso de deshacer. */
  private apply(drag: Drag, label: string, command: SceneCommand): void {
    const after = command.apply({ placements: drag.before, finishes: null }).placements;
    this.store.execute(new SetPlacementsCommand(label, drag.before, after, drag.key));
  }
}
