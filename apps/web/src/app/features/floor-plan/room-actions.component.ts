import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ROOM_LIMITS, wallLength } from '@interiores/shared-types';
import { DesignProjectStore } from '../project/design-project.store';
import { SceneEditsService } from '../project/scene-edits.service';
import { metres } from './floor-plan-model';

/**
 * Acciones sobre la parte del cuarto que se tocó con la herramienta de paredes (en el plano o en
 * el 3D): añadir una puerta o una ventana a una pared, partirla, quitar una esquina o una
 * abertura, y cambiar el alto del cuarto. Todas se deshacen.
 */
@Component({
  selector: 'app-room-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="height">
      Alto
      <input
        type="number"
        class="num"
        step="0.05"
        [min]="limits.minHeightM"
        [max]="limits.maxHeightM"
        [value]="height()"
        aria-label="Alto del cuarto en metros"
        (change)="edits.setRoomHeight(+$any($event.target).value)"
      />
      m
    </label>
    <span class="sep" aria-hidden="true"></span>
    @switch (view().kind) {
      @case ('wall') {
        <strong>Pared de {{ view().text }}</strong>
        <button type="button" class="act" (click)="edits.addOpening(view().id, 'door')">+ Puerta</button>
        <button type="button" class="act" (click)="edits.addOpening(view().id, 'window')">+ Ventana</button>
        <button type="button" class="act" (click)="edits.splitWall(view().id)" title="Añade una esquina en la mitad de la pared: después puedes moverla">Partir</button>
      }
      @case ('opening') {
        <strong>{{ view().text }}</strong>
        <label class="height">
          Ancho
          <input type="number" class="num" step="0.05" min="0.4" [value]="view().width" aria-label="Ancho en metros" (change)="edits.resizeOpening(view().id, +$any($event.target).value)" />
          m
        </label>
        <button type="button" class="act danger" (click)="edits.removeOpening(view().id)">Quitar</button>
      }
      @case ('vertex') {
        <strong>Esquina</strong>
        <button type="button" class="act danger" (click)="edits.removeVertex(view().index)" [disabled]="!view().removable">Quitar esquina</button>
      }
      @default {
        <span class="muted">Toca una pared, una esquina, una puerta o una ventana para ver qué puedes hacer con ella.</span>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      font-size: 0.82rem;
      color: var(--text);
    }
    .height {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text-muted);
    }
    .num {
      width: 64px;
      min-height: 28px;
      padding: 0 6px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }
    .sep {
      width: 1px;
      height: 20px;
      background: var(--border);
    }
    .act {
      min-height: 28px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
      cursor: pointer;
    }
    .act:hover:not(:disabled) {
      border-color: var(--primary);
    }
    .act:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .act.danger {
      color: var(--danger);
    }
    .muted {
      color: var(--text-muted);
    }
  `,
})
export class RoomActionsComponent {
  private readonly store = inject(DesignProjectStore);
  protected readonly edits = inject(SceneEditsService);
  protected readonly limits = ROOM_LIMITS;

  protected readonly height = computed(() => this.store.shell()?.heightM ?? 2.6);

  /** Lo que se muestra para la parte del cuarto elegida (o nada si ya no existe). */
  protected readonly view = computed(() => {
    const none = { kind: 'none' as const, id: '', index: -1, text: '', width: 0, removable: false };
    const shell = this.store.shell();
    const target = this.store.roomTarget();
    if (!shell || !target) return none;
    if (target.kind === 'wall') {
      const wall = shell.walls.find((w) => w.id === target.wallId);
      return wall ? { ...none, kind: 'wall' as const, id: wall.id, text: metres(wallLength(wall)) } : none;
    }
    if (target.kind === 'opening') {
      const opening = shell.openings.find((o) => o.id === target.openingId);
      return opening ? { ...none, kind: 'opening' as const, id: opening.id, text: opening.type === 'door' ? 'Puerta' : 'Ventana', width: opening.widthM } : none;
    }
    return target.index < shell.walls.length ? { ...none, kind: 'vertex' as const, index: target.index, removable: shell.walls.length > 3 } : none;
  });
}
