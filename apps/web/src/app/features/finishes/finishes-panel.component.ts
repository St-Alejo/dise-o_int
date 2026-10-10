import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { STYLES, finishesForStyle, materialsForSurface, type MaterialDefinition } from '@interiores/shared-types';
import { DesignProjectStore } from '../project/design-project.store';
import { wallOptions as roomWalls } from '../room-dimensions/room-draft';
import { SetFinishesCommand } from '../viewport-3d/commands';
import { effectiveFinishes, sameFinishes, selectedMaterial, withFinish, type FinishSurface, type WallTarget } from './finishes-model';

/** Acabados del cuarto: piso, paredes (todas o una) y techo. Cada cambio es un comando deshacible. */
@Component({
  selector: 'app-finishes-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack">
      <section class="block" aria-labelledby="fin-floor">
        <h4 id="fin-floor">Piso</h4>
        <div class="swatches" role="group" aria-label="Material del piso">
          @for (m of floorOptions; track m.id) {
            <button type="button" class="swatch" [style.background]="m.color" [title]="m.name" [attr.aria-label]="'Piso: ' + m.name" [attr.aria-pressed]="selected('floor') === m.id" (click)="set('floor', m.id)"></button>
          }
        </div>
      </section>

      <section class="block" aria-labelledby="fin-walls">
        <div class="row">
          <h4 id="fin-walls">Paredes</h4>
          <span class="spacer"></span>
          <label class="small" for="fin-wall-target">Pintar</label>
          <select id="fin-wall-target" class="input select" [value]="wallTarget()" (change)="wallTarget.set($any($event.target).value)">
            <option value="all">Todas</option>
            @for (w of walls(); track w.id) {
              <option [value]="w.id">{{ w.label }}</option>
            }
          </select>
        </div>
        <div class="swatches" role="group" aria-label="Color de las paredes">
          @for (m of wallOptions; track m.id) {
            <button type="button" class="swatch" [style.background]="m.color" [title]="m.name" [attr.aria-label]="'Pared: ' + m.name" [attr.aria-pressed]="selected('wall') === m.id" (click)="set('wall', m.id)"></button>
          }
        </div>
      </section>

      <section class="block" aria-labelledby="fin-ceiling">
        <h4 id="fin-ceiling">Techo</h4>
        <div class="swatches" role="group" aria-label="Color del techo">
          @for (m of ceilingOptions; track m.id) {
            <button type="button" class="swatch" [style.background]="m.color" [title]="m.name" [attr.aria-label]="'Techo: ' + m.name" [attr.aria-pressed]="selected('ceiling') === m.id" (click)="set('ceiling', m.id)"></button>
          }
        </div>
      </section>

      <div class="row wrap">
        @if (styleId(); as s) {
          <button type="button" class="btn btn-sm" [disabled]="matchesStyle()" (click)="applyStyle()">Aplicar paleta {{ styles[s].label }}</button>
        }
        <button type="button" class="btn btn-sm" [disabled]="!store.finishes()" (click)="reset()">Restablecer</button>
      </div>
    </div>
  `,
  styles: `
    h4 {
      margin: 0;
      font-size: 0.9rem;
    }
    .block {
      display: grid;
      gap: 8px;
    }
    .small {
      font-size: 0.82rem;
    }
    .select {
      width: auto;
      min-height: 30px;
      padding: 2px 8px;
      font-size: 0.85rem;
    }
    .wrap {
      flex-wrap: wrap;
      gap: 8px;
    }
    .swatches {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .swatch {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      border: 2px solid var(--border);
      cursor: pointer;
      padding: 0;
    }
    .swatch[aria-pressed='true'] {
      outline: 3px solid var(--primary);
      outline-offset: 2px;
    }
  `,
})
export class FinishesPanelComponent {
  protected readonly store = inject(DesignProjectStore);
  protected readonly styles = STYLES;
  protected readonly floorOptions: MaterialDefinition[] = materialsForSurface('floor');
  protected readonly wallOptions: MaterialDefinition[] = materialsForSurface('wall');
  protected readonly ceilingOptions: MaterialDefinition[] = materialsForSurface('ceiling');
  protected readonly walls = computed(() => roomWalls(this.store.shell()));
  protected readonly wallTarget = signal<WallTarget>('all');

  protected readonly styleId = computed(() => this.store.project()?.selectedStyleId ?? null);
  private readonly current = computed(() => effectiveFinishes(this.store.finishes(), this.styleId()));
  protected readonly matchesStyle = computed(() => sameFinishes(this.current(), finishesForStyle(this.styleId())));

  protected selected(surface: FinishSurface): string {
    return selectedMaterial(this.current(), surface, this.wallTarget());
  }

  protected set(surface: FinishSurface, materialId: string): void {
    const next = withFinish(this.current(), surface, materialId, this.wallTarget());
    if (!sameFinishes(next, this.store.finishes())) this.store.execute(new SetFinishesCommand(this.store.finishes(), next));
  }

  protected applyStyle(): void {
    this.store.execute(new SetFinishesCommand(this.store.finishes(), finishesForStyle(this.styleId())));
  }

  protected reset(): void {
    this.store.execute(new SetFinishesCommand(this.store.finishes(), null));
  }
}
