import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { MATERIALS, STYLES, getMaterial, type CatalogItem, type FurniturePlacement, type MaterialSlot } from '@interiores/shared-types';
import { newPlacementId } from '../../core/ids';
import { ToastService } from '../../core/ui/toast.service';
import { CatalogThumbComponent } from '../catalog/catalog-thumb.component';
import { DesignProjectStore } from '../project/design-project.store';
import {
  DuplicateCommand,
  MacroCommand,
  MoveCommand,
  ResizeCommand,
  SetElevationCommand,
  SetLockCommand,
  SetMaterialCommand,
  type SceneCommand,
} from '../viewport-3d/commands';
import { SceneService } from '../viewport-3d/scene.service';
import {
  AXES,
  cm,
  currentDimensions,
  elevationRange,
  isResizable,
  nextDimensions,
  proposeResize,
  resizeRanges,
  sameAsCatalog,
  type Axis,
} from './inspector-model';

/**
 * Inspector de la pieza seleccionada: medidas (en cm, con sliders dentro de los rangos del
 * catálogo y candado de proporción), altura en la pared, material por slot y acciones.
 * Toda edición es un comando: Ctrl+Z la deshace, y arrastrar un slider es UN solo paso.
 */
@Component({
  selector: 'app-inspector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, CatalogThumbComponent],
  template: `
    @if (placement(); as p) {
      @if (item(); as it) {
        <div class="stack">
          <div class="row head">
            <app-catalog-thumb [item]="it" />
            <div class="grow">
              <h3>{{ it.name }}</h3>
              <p class="muted small">{{ styleNames(it) }}{{ p.origin === 'detected' ? ' · detectado en tu foto' : '' }}</p>
            </div>
            <button type="button" class="icon-btn" aria-label="Deseleccionar" (click)="store.select(null)">×</button>
          </div>

          <section class="block" aria-labelledby="ins-dims">
            <div class="row">
              <h4 id="ins-dims">Medidas</h4>
              <span class="spacer"></span>
              @if (resizable()) {
                <label class="small row-inline"><input type="checkbox" [checked]="keepRatio()" (change)="keepRatio.set($any($event.target).checked)" /> Mantener proporción</label>
              }
            </div>
            @for (a of axes; track a.axis) {
              <div class="dim">
                <label [for]="'dim-' + a.axis">{{ a.label }}</label>
                @if (ranges()[a.axis]; as r) {
                  <input
                    type="range"
                    [id]="'dim-' + a.axis + '-slider'"
                    [attr.aria-label]="a.label + ' (deslizador)'"
                    [min]="r[0] * 100"
                    [max]="r[1] * 100"
                    step="1"
                    [value]="dims()[a.axis] * 100"
                    (input)="resize(a.axis, +$any($event.target).value / 100)"
                  />
                  <span class="unit">
                    <input
                      class="input"
                      type="number"
                      [id]="'dim-' + a.axis"
                      [min]="r[0] * 100"
                      [max]="r[1] * 100"
                      step="1"
                      [value]="round(dims()[a.axis] * 100)"
                      (change)="resize(a.axis, +$any($event.target).value / 100)"
                    />
                    cm
                  </span>
                } @else {
                  <span class="fixed" [id]="'dim-' + a.axis">{{ cmText(dims()[a.axis]) }}</span>
                }
              </div>
            }
            @if (error(); as e) {
              <p class="error" role="alert">{{ e }}</p>
            }
            @if (resizable() && p.dimensionsM) {
              <button type="button" class="btn btn-sm" (click)="resetSize()">Medidas originales ({{ cmText(it.dimensionsM.x) }} × {{ cmText(it.dimensionsM.z) }})</button>
            }
            @if (!resizable()) {
              <p class="muted small">Este modelo 3D tiene medidas fijas.</p>
            }
          </section>

          @if (it.mount === 'wall') {
            <section class="block" aria-labelledby="ins-elev">
              <h4 id="ins-elev">Altura en la pared</h4>
              <div class="dim">
                <label for="ins-elev-input">Desde el piso</label>
                <input type="range" aria-label="Altura desde el piso (deslizador)" [min]="0" [max]="elevMax() * 100" step="1" [value]="p.position.y * 100" (input)="setElevation(+$any($event.target).value / 100)" />
                <span class="unit"><input id="ins-elev-input" class="input" type="number" min="0" [max]="round(elevMax() * 100)" [value]="round(p.position.y * 100)" (change)="setElevation(+$any($event.target).value / 100)" /> cm</span>
              </div>
            </section>
          }

          @if (it.materialSlots?.length) {
            <section class="block" aria-labelledby="ins-mat">
              <h4 id="ins-mat">Materiales</h4>
              @for (slot of it.materialSlots!; track slot.slot) {
                <div class="slot" role="group" [attr.aria-label]="slot.label">
                  <span class="small">{{ slot.label }}: <strong>{{ materialName(p, slot) }}</strong></span>
                  <div class="swatches">
                    @for (m of optionsFor(slot); track m.id) {
                      <button
                        type="button"
                        class="swatch"
                        [style.background]="m.color"
                        [class.metal]="m.metalness > 0.5"
                        [attr.aria-pressed]="materialOf(p, slot) === m.id"
                        [attr.aria-label]="slot.label + ': ' + m.name"
                        [title]="m.name"
                        (click)="setMaterial(slot, m.id)"
                      ></button>
                    }
                  </div>
                </div>
              }
            </section>
          }

          <dl class="facts">
            <div><dt>Precio</dt><dd>{{ it.price | currency: it.currency : 'symbol' : '1.0-0' }}</dd></div>
            <div><dt>Licencia 3D</dt><dd>{{ it.license.toUpperCase() }}{{ it.attribution ? ' · ' + it.attribution : '' }}</dd></div>
          </dl>

          <div class="actions">
            @if (it.mount !== 'wall') {
              <button type="button" class="btn" (click)="scene.rotateSelected(-pi / 12)" aria-label="Rotar a la izquierda 15 grados">⟲ Rotar</button>
              <button type="button" class="btn" (click)="scene.rotateSelected(pi / 12)" aria-label="Rotar a la derecha 15 grados">⟳ Rotar</button>
            }
            <button type="button" class="btn" (click)="duplicate()">⧉ Duplicar</button>
            <button type="button" class="btn" [attr.aria-pressed]="p.lockedByUser" (click)="toggleLock()">{{ p.lockedByUser ? '🔒 Bloqueado' : '🔓 Libre' }}</button>
            <button type="button" class="btn" (click)="swap.emit()">🔁 Cambiar</button>
            <button type="button" class="btn" (click)="ar.emit(it)">📱 Ver en mi cuarto</button>
            @if (it.productUrl) {
              <a class="btn" [href]="it.productUrl" target="_blank" rel="noopener noreferrer">🛒 Buscar similar</a>
            }
            <button type="button" class="btn btn-danger" (click)="scene.removeSelected()">🗑 Quitar</button>
          </div>
          <p class="small muted">
            {{ p.lockedByUser ? 'Bloqueado: "Reacomodar" no lo moverá.' : 'Libre: "Reacomodar" puede moverlo.' }}
          </p>
        </div>
      }
    }
  `,
  styles: `
    h3 {
      margin: 0;
      font-size: 1.05rem;
    }
    h4 {
      margin: 0;
      font-size: 0.9rem;
    }
    .head {
      align-items: center;
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
    .small {
      font-size: 0.82rem;
      margin: 0;
    }
    .block {
      display: grid;
      gap: 8px;
      padding: 10px 0;
      border-top: 1px solid var(--border);
    }
    .row-inline {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .dim {
      display: grid;
      grid-template-columns: 56px 1fr 96px;
      gap: 8px;
      align-items: center;
      font-size: 0.85rem;
    }
    .dim input[type='range'] {
      width: 100%;
    }
    .unit {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text-muted);
    }
    .unit .input {
      padding: 4px 6px;
      min-height: 30px;
    }
    .fixed {
      grid-column: 2 / 4;
      color: var(--text-muted);
    }
    .error {
      color: var(--danger);
      font-size: 0.82rem;
      margin: 0;
    }
    .slot {
      display: grid;
      gap: 6px;
    }
    .swatches {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .swatch {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid var(--border);
      cursor: pointer;
      padding: 0;
    }
    .swatch.metal {
      background-image: linear-gradient(135deg, rgba(255, 255, 255, 0.55), transparent 55%) !important;
    }
    .swatch[aria-pressed='true'] {
      outline: 3px solid var(--primary);
      outline-offset: 2px;
    }
    .facts {
      margin: 0;
      display: grid;
      gap: 6px;
    }
    .facts div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 0.88rem;
    }
    .facts dt {
      color: var(--text-muted);
    }
    .facts dd {
      margin: 0;
      font-weight: 600;
      text-align: right;
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .actions .btn {
      white-space: normal;
      padding: 6px 10px;
      min-width: 0;
    }
  `,
})
export class InspectorComponent {
  protected readonly store = inject(DesignProjectStore);
  protected readonly scene = inject(SceneService);
  private readonly toast = inject(ToastService);

  readonly swap = output<void>();
  readonly ar = output<CatalogItem>();

  protected readonly pi = Math.PI;
  protected readonly axes = AXES;
  protected readonly placement = this.store.selected;
  protected readonly item = this.store.selectedItem;
  protected readonly keepRatio = signal(false);
  /** Mensaje de por qué no se aplicó la última edición; se limpia al cambiar de pieza. */
  protected readonly error = linkedSignal<string | null>(() => (this.store.selectedId(), null));

  protected readonly dims = computed(() => {
    const p = this.placement();
    const it = this.item();
    return p && it ? currentDimensions(it, p) : { x: 0, y: 0, z: 0 };
  });
  protected readonly ranges = computed(() => (this.item() ? resizeRanges(this.item()!) : {}));
  protected readonly resizable = computed(() => (this.item() ? isResizable(this.item()!) : false));
  protected readonly elevMax = computed(() => {
    const shell = this.store.shell();
    return shell ? elevationRange(shell, this.dims())[1] : 0;
  });

  protected round(v: number): number {
    return Math.round(v);
  }

  protected cmText(m: number): string {
    return cm(m);
  }

  protected styleNames(it: CatalogItem): string {
    return it.styleTags.map((s) => STYLES[s].label).join(', ');
  }

  protected materialOf(p: FurniturePlacement, slot: MaterialSlot): string {
    return p.materials?.[slot.slot] ?? slot.default;
  }

  protected materialName(p: FurniturePlacement, slot: MaterialSlot): string {
    return getMaterial(this.materialOf(p, slot))?.name ?? '—';
  }

  protected optionsFor(slot: MaterialSlot) {
    return MATERIALS.filter((m) => slot.allowedKinds.includes(m.kind));
  }

  protected resize(axis: Axis, valueM: number): void {
    const p = this.placement();
    const it = this.item();
    const shell = this.store.shell();
    if (!p || !it || !shell || !Number.isFinite(valueM)) return;
    const dims = nextDimensions(it, this.dims(), axis, valueM, this.keepRatio());
    this.applyDims(p, it, dims);
  }

  protected resetSize(): void {
    const p = this.placement();
    const it = this.item();
    if (p && it) this.applyDims(p, it, it.dimensionsM);
  }

  private applyDims(p: FurniturePlacement, it: CatalogItem, dims: { x: number; y: number; z: number }): void {
    const shell = this.store.shell()!;
    const proposal = proposeResize(
      {
        shell,
        isPoseValid: (id, itemId, pos, rot, d) => this.store.isPoseValid(id, itemId, pos, rot, d),
        supportTopOf: (x) => this.store.supportTopOf(x),
      },
      p,
      it,
      dims,
    );
    this.error.set(proposal.error);
    if (proposal.error) return;
    const resize = new ResizeCommand(p, sameAsCatalog(it, dims) ? undefined : dims, proposal.position);
    // Si cambia el alto de un soporte, lo que tiene encima sube o baja con su tapa.
    const top = proposal.position.y + dims.y;
    const followers: SceneCommand[] = this.store
      .dependentsOf(p.id)
      .filter((d) => Math.abs(d.position.y - top) > 1e-4)
      .map((d) => new MoveCommand(d.id, d.position, { ...d.position, y: top }));
    this.store.execute(followers.length ? new MacroCommand('Cambiar medidas', [resize, ...followers]) : resize);
  }

  protected setElevation(valueM: number): void {
    const p = this.placement();
    if (!p || !Number.isFinite(valueM)) return;
    const y = Math.min(this.elevMax(), Math.max(0, valueM));
    if (!this.store.isPoseValid(p.id, p.catalogItemId, { ...p.position, y }, p.rotationY, this.dims())) {
      this.error.set('A esa altura choca con otro objeto de la pared.');
      return;
    }
    this.error.set(null);
    this.store.execute(new SetElevationCommand(p, y));
  }

  protected setMaterial(slot: MaterialSlot, materialId: string): void {
    const p = this.placement();
    if (!p) return;
    this.store.execute(new SetMaterialCommand(p, slot.slot, materialId === slot.default ? undefined : materialId));
  }

  protected toggleLock(): void {
    const p = this.placement();
    if (p) this.store.execute(new SetLockCommand(p.id, !p.lockedByUser));
  }

  /** Copia con sus medidas y materiales, en el hueco libre más cercano (o en otra pared/soporte). */
  protected duplicate(): void {
    const p = this.placement();
    const it = this.item();
    if (!p || !it) return;
    const id = newPlacementId();
    const dims = this.dims();
    let copy: FurniturePlacement | null = null;
    if (it.mount === 'floor' || it.mount === 'ceiling') {
      const near = { x: p.position.x + dims.x + 0.05, y: p.position.y, z: p.position.z };
      const pos = this.store.findFreeSpot(id, it, near, p.rotationY, dims);
      if (pos) copy = { ...structuredClone(p), id, position: pos, origin: 'user' };
    } else {
      const plan = this.store.planPlacement(id, it);
      if (plan) {
        const { supportId: _s, wallId: _w, elevationM: _e, ...rest } = structuredClone(p);
        copy = { ...rest, id, origin: 'user', ...plan };
      }
    }
    if (!copy) {
      this.toast.error('No hay espacio libre para duplicarlo. Mueve algo primero.');
      return;
    }
    this.store.execute(new DuplicateCommand(copy));
    this.store.select(id);
  }
}
