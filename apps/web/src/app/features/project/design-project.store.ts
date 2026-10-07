import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  bodiesCollide,
  bodyOf,
  clampToRoom,
  effectiveDimensions,
  mountY,
  type CatalogItem,
  type DesignProject,
  type FurniturePlacement,
  type RoomFinishes,
  type StyleId,
  type UpdateRoomRequest,
  type Vector3,
} from '@interiores/shared-types';
import { ApiError } from '../../core/api/api-error';
import { CatalogApi, ProjectsApi } from '../../core/api/projects.api';
import { ToastService } from '../../core/ui/toast.service';
import { CommandHistory, type Placements, type SceneCommand, type SceneState } from '../viewport-3d/commands';
import { planPlacement, type PlacementPlan } from './placement-planner';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

const AUTOSAVE_MS = 1200;

/**
 * Única fuente de verdad del proyecto abierto (signals).
 * La galería 2D, el viewport 3D, el panel de catálogo y la barra de guardado leen de aquí;
 * las ediciones entran SOLO como comandos (deshacer/rehacer) y se autoguardan con
 * control de concurrencia optimista (la revisión del servidor).
 */
@Injectable()
export class DesignProjectStore {
  private readonly api = inject(ProjectsApi);
  private readonly catalogApi = inject(CatalogApi);
  private readonly toast = inject(ToastService);

  private readonly history = new CommandHistory();
  private readonly historyVersion = signal(0);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly project = signal<DesignProject | null>(null);
  readonly placements = signal<Placements>([]);
  /** Acabados del cuarto en edición (null = por defecto / paleta del estilo). */
  readonly finishes = signal<RoomFinishes | null>(null);
  readonly catalog = signal<ReadonlyMap<string, CatalogItem>>(new Map());
  readonly selectedId = signal<string | null>(null);
  readonly saveState = signal<SaveState>('saved');
  readonly loadError = signal<string | null>(null);

  readonly shell = computed(() => this.project()?.roomShell ?? null);
  readonly selected = computed(() => this.placements().find((p) => p.id === this.selectedId()) ?? null);
  readonly selectedItem = computed(() => {
    const sel = this.selected();
    return sel ? (this.catalog().get(sel.catalogItemId) ?? null) : null;
  });
  readonly canUndo = computed(() => (this.historyVersion(), this.history.canUndo));
  readonly canRedo = computed(() => (this.historyVersion(), this.history.canRedo));
  readonly undoLabel = computed(() => (this.historyVersion(), this.history.nextUndoLabel));
  readonly redoLabel = computed(() => (this.historyVersion(), this.history.nextRedoLabel));
  readonly selectedDimensions = computed(() => {
    const sel = this.selected();
    return sel ? this.placementDimensions(sel) : null;
  });
  readonly totalPrice = computed(() =>
    this.placements().reduce((acc, p) => acc + (this.catalog().get(p.catalogItemId)?.price ?? 0), 0),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      // Si se sale con cambios pendientes, se intenta un último guardado.
      if (this.saveState() === 'dirty') void this.flush();
    });
  }

  // ------------------------------------------------------------------ carga
  async load(id: string): Promise<void> {
    this.loadError.set(null);
    try {
      const [project, catalog] = await Promise.all([this.api.get(id), this.catalogApi.all()]);
      this.catalog.set(new Map(catalog.map((c) => [c.id, c])));
      this.replaceFromServer(project);
    } catch (err) {
      this.loadError.set(ApiError.from(err).userMessage);
    }
  }

  /** Vista pública (solo lectura): el proyecto llega ya resuelto por el link compartido. */
  async loadReadOnly(project: DesignProject): Promise<void> {
    try {
      const catalog = await this.catalogApi.all();
      this.catalog.set(new Map(catalog.map((c) => [c.id, c])));
      this.replaceFromServer(project);
    } catch (err) {
      this.loadError.set(ApiError.from(err).userMessage);
    }
  }

  /** Recarga tras un job del worker (o para resolver un conflicto). */
  async reload(): Promise<void> {
    const current = this.project();
    if (!current) return;
    try {
      this.replaceFromServer(await this.api.get(current.id));
    } catch (err) {
      this.toast.error(ApiError.from(err).userMessage);
    }
  }

  replaceFromServer(project: DesignProject): void {
    const localEdits = this.saveState() === 'dirty' || this.saveState() === 'saving';
    this.project.set(project);
    if (!localEdits) {
      this.placements.set(project.furniturePlacements);
      this.finishes.set(project.finishes ?? null);
      this.history.clear();
      this.bumpHistory();
      this.saveState.set('saved');
      if (this.selectedId() && !project.furniturePlacements.some((p) => p.id === this.selectedId())) this.selectedId.set(null);
    }
  }

  /** Actualiza los metadatos del proyecto sin tocar la escena local (p. ej. tras elegir estilo). */
  patchProject(project: DesignProject): void {
    this.project.update((p) => (p ? { ...project, furniturePlacements: p.furniturePlacements } : project));
  }

  // ------------------------------------------------------------------ edición (Command)
  private get sceneState(): SceneState {
    return { placements: this.placements(), finishes: this.finishes() };
  }

  private setScene(state: SceneState): void {
    this.placements.set(state.placements);
    this.finishes.set(state.finishes);
  }

  execute(cmd: SceneCommand): void {
    this.setScene(this.history.execute(cmd, this.sceneState));
    this.afterEdit();
  }

  undo(): void {
    if (!this.history.canUndo) return;
    this.setScene(this.history.undo(this.sceneState));
    this.afterEdit();
  }

  redo(): void {
    if (!this.history.canRedo) return;
    this.setScene(this.history.redo(this.sceneState));
    this.afterEdit();
  }

  /** Piezas apoyadas sobre `supportId` (se mueven, giran o caen con él). */
  dependentsOf(supportId: string): FurniturePlacement[] {
    return this.placements().filter((p) => p.supportId === supportId);
  }

  select(id: string | null): void {
    this.selectedId.set(id);
  }

  dimensionsOf(catalogItemId: string): Vector3 | null {
    return this.catalog().get(catalogItemId)?.dimensionsM ?? null;
  }

  /** Medidas reales de una pieza colocada: las suyas si el usuario las cambió, si no las del catálogo. */
  placementDimensions(p: Pick<FurniturePlacement, 'catalogItemId' | 'dimensionsM'>): Vector3 | null {
    const item = this.catalog().get(p.catalogItemId);
    return item ? effectiveDimensions(item.dimensionsM, p) : null;
  }

  /**
   * ¿Es válida esta pose? Dentro del cuarto y sin chocar en 3D con otras piezas de su capa
   * (alfombras, techo, pared y superficie tienen sus propias reglas; una silla cabe bajo la mesa).
   * `dimensionsM` permite validar un tamaño nuevo y `extra` otros campos (soporte) antes de aplicarlos.
   */
  isPoseValid(
    placementId: string,
    catalogItemId: string,
    position: Vector3,
    rotationY: number,
    dimensionsM?: Vector3,
    extra: Pick<FurniturePlacement, 'supportId'> = {},
  ): boolean {
    const shell = this.shell();
    const item = this.catalog().get(catalogItemId);
    if (!shell || !item) return false;
    const own = this.placements().find((p) => p.id === placementId);
    const dims = dimensionsM ?? (own && own.catalogItemId === catalogItemId ? effectiveDimensions(item.dimensionsM, own) : item.dimensionsM);
    const clamped = clampToRoom(position, dims, rotationY, shell);
    if (Math.abs(clamped.x - position.x) > 1e-3 || Math.abs(clamped.z - position.z) > 1e-3) return false;
    if (position.y + dims.y > shell.heightM + 1e-3) return false; // no atraviesa el techo
    const supportId = 'supportId' in extra ? extra.supportId : own?.supportId;
    const me = bodyOf({ id: placementId, position, rotationY, dimensionsM: dims, ...(supportId ? { supportId } : {}) }, item);
    return !this.placements().some((other) => {
      if (other.id === placementId) return false;
      const otherItem = this.catalog().get(other.catalogItemId);
      return !!otherItem && bodiesCollide(me, bodyOf(other, otherItem));
    });
  }

  /** Busca un hueco libre cerca de `near` (espiral) para añadir o cambiar un mueble. */
  findFreeSpot(placementId: string, item: CatalogItem, near: Vector3, rotationY = 0): Vector3 | null {
    const shell = this.shell();
    if (!shell) return null;
    const dims = item.dimensionsM;
    const y = mountY(item.mount, dims, shell, { elevationDefaultM: item.elevationDefaultM });
    for (let r = 0; r <= 4; r += 0.2) {
      const steps = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.25);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const pos = clampToRoom({ x: near.x + Math.cos(a) * r, y, z: near.z + Math.sin(a) * r }, dims, rotationY, shell);
        if (this.isPoseValid(placementId, item.id, pos, rotationY, dims)) return pos;
      }
    }
    return null;
  }

  /** Dónde poner un mueble nuevo según su montaje (piso, pared, techo o encima de otro). */
  planPlacement(id: string, item: CatalogItem): PlacementPlan | null {
    const shell = this.shell();
    if (!shell) return null;
    return planPlacement(id, item, {
      shell,
      placements: this.placements(),
      catalog: this.catalog(),
      isPoseValid: (pid, it, pos, rot) => this.isPoseValid(pid, it.id, pos, rot, it.dimensionsM),
      findFreeSpot: (pid, it, near, rot) => this.findFreeSpot(pid, it, near, rot),
    });
  }

  // ------------------------------------------------------------------ guardado
  private afterEdit(): void {
    this.bumpHistory();
    this.saveState.set('dirty');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), AUTOSAVE_MS);
  }

  async flush(): Promise<void> {
    const project = this.project();
    const state = this.saveState();
    // Sin cambios pendientes no hay nada que enviar (evita PUTs inútiles y conflictos falsos).
    if (!project || state === 'saved' || state === 'saving' || state === 'conflict') return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const sent = this.placements();
    this.saveState.set('saving');
    try {
      const saved = await this.api.saveScene(project.id, {
        revision: project.revision,
        furniturePlacements: [...sent],
        finishes: this.finishes(),
      });
      this.project.set(saved);
      if (this.placements() === sent) {
        // El servidor puede haber ajustado posiciones (clamp): se adopta su versión.
        this.placements.set(saved.furniturePlacements);
        this.saveState.set('saved');
      } else {
        this.saveState.set('dirty'); // hubo ediciones mientras se guardaba
        this.saveTimer = setTimeout(() => void this.flush(), AUTOSAVE_MS);
      }
    } catch (err) {
      const e = ApiError.from(err);
      if (e.status === 409) {
        this.saveState.set('conflict');
      } else {
        this.saveState.set('error');
        this.toast.error(`No se pudo guardar: ${e.userMessage}`);
      }
    }
  }

  /** Resuelve un conflicto descartando los cambios locales y cargando la versión del servidor. */
  async discardLocalAndReload(): Promise<void> {
    this.saveState.set('saved');
    await this.reload();
  }

  async retrySave(): Promise<void> {
    this.saveState.set('dirty');
    await this.flush();
  }

  /**
   * Cambia las medidas exactas del cuarto en el servidor (que reacomoda los muebles) y adopta el
   * resultado. Primero se guardan los cambios pendientes para no perderlos ni provocar un 409.
   * Los errores (422 de medidas inválidas, 409) se propagan para que el diálogo los muestre.
   */
  async updateRoom(body: Omit<UpdateRoomRequest, 'revision'>): Promise<void> {
    if (!this.project()) return;
    await this.flush();
    const project = this.project()!;
    const updated = await this.api.updateRoom(project.id, { ...body, revision: project.revision });
    this.saveState.set('saved');
    this.replaceFromServer(updated);
  }

  async selectStyle(styleId: StyleId): Promise<void> {
    const project = this.project();
    if (!project) return;
    this.patchProject(await this.api.selectStyle(project.id, styleId));
  }

  private bumpHistory(): void {
    this.historyVersion.update((v) => v + 1);
  }
}
