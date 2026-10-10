import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { materialsForSurface, type MaterialDefinition } from '@interiores/shared-types';
import { effectiveFinishes, sameFinishes, selectedMaterial, withFinish } from '../../finishes/finishes-model';
import { DesignProjectStore } from '../../project/design-project.store';
import { SetFinishesCommand } from '../commands';

/** Superficie del cuarto que se pinta desde el visor. */
export type PaintSurface = { surface: 'floor' } | { surface: 'wall'; wallId: string };

/**
 * Paleta flotante de la herramienta Pintar: aparece junto al punto donde se hizo clic con los
 * materiales de esa superficie. Cada cambio es un comando (se deshace con Ctrl+Z).
 */
@Component({
  selector: 'app-paint-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <strong>{{ target().surface === 'floor' ? 'Piso' : 'Pared' }}</strong>
      <button type="button" class="close" aria-label="Cerrar la paleta" (click)="closed.emit()">×</button>
    </div>
    @if (target().surface === 'wall') {
      <label class="all"><input type="checkbox" [checked]="allWalls()" (change)="allWalls.set($any($event.target).checked)" /> Todas las paredes</label>
    }
    <div class="swatches" role="group" [attr.aria-label]="target().surface === 'floor' ? 'Material del piso' : 'Color de la pared'">
      @for (m of options(); track m.id) {
        <button type="button" class="swatch" [style.background]="m.color" [attr.aria-label]="m.name" [title]="m.name" [attr.aria-pressed]="current() === m.id" (click)="pick(m)"></button>
      }
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      z-index: 5;
      display: grid;
      gap: 8px;
      width: 232px;
      padding: 10px 12px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow);
      font-size: 0.85rem;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .close {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-size: 1.1rem;
      line-height: 1;
      cursor: pointer;
    }
    .close:hover {
      background: var(--surface-2);
    }
    .all {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
    }
    .swatches {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .swatch {
      width: 28px;
      height: 28px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 50%;
      cursor: pointer;
    }
    .swatch[aria-pressed='true'] {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
  `,
})
export class PaintPaletteComponent {
  private readonly store = inject(DesignProjectStore);

  readonly target = input.required<PaintSurface>();
  readonly closed = output<void>();

  /** Pintar todas las paredes en vez de solo la que se tocó. */
  protected readonly allWalls = signal(false);
  protected readonly options = computed<MaterialDefinition[]>(() => materialsForSurface(this.target().surface));
  private readonly finishes = computed(() => effectiveFinishes(this.store.finishes(), this.store.project()?.selectedStyleId ?? null));
  private readonly wall = computed(() => {
    const target = this.target();
    return target.surface === 'wall' && !this.allWalls() ? target.wallId : 'all';
  });
  protected readonly current = computed(() => selectedMaterial(this.finishes(), this.target().surface, this.wall()));

  protected pick(material: MaterialDefinition): void {
    const next = withFinish(this.finishes(), this.target().surface, material.id, this.wall());
    if (!sameFinishes(next, this.store.finishes())) this.store.execute(new SetFinishesCommand(this.store.finishes(), next));
  }
}
