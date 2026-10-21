import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from '../../shared/ui/icon.component';
import { TooltipDirective } from '../../shared/ui/tooltip.directive';
import { RecommendService } from './recommend.service';

/**
 * La propuesta de "Recomendar" sobre el visor: qué se eligió, su paleta y qué opina la persona.
 * 👍/👎 enseñan al recomendador; "Me la quedo" la cierra; "Deshacer" vuelve a lo de antes.
 */
@Component({
  selector: 'app-recommendation-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TooltipDirective],
  template: `
    @if (rec?.current(); as r) {
      <section class="card rec" aria-label="Propuesta recomendada" aria-live="polite">
        <header class="row">
          <app-icon name="wand" />
          <strong class="grow">Propuesta</strong>
          <button type="button" class="icon-btn" aria-label="Cerrar la propuesta" (click)="rec!.dismiss()"><app-icon name="close" /></button>
        </header>
        <p class="summary">{{ r.summary }}</p>
        <div class="palette" role="img" [attr.aria-label]="'Paleta: ' + r.palette.join(', ')">
          @for (c of r.palette; track $index) {
            <span [style.background]="c"></span>
          }
        </div>
        @if (rec!.isPending()) {
          <p class="muted small">Acomodando los muebles…</p>
        }
        <div class="row actions">
          <button type="button" class="icon-btn" [attr.aria-pressed]="rec!.verdict() === 'like'" aria-label="Me gusta" appTooltip="Me gusta: las próximas irán por ahí" (click)="rec!.feedback('like')">👍</button>
          <button type="button" class="icon-btn" [attr.aria-pressed]="rec!.verdict() === 'dislike'" aria-label="No me gusta" appTooltip="No me gusta: probaremos otra cosa" (click)="rec!.feedback('dislike')">👎</button>
          <span class="spacer"></span>
          <button type="button" class="btn btn-sm" (click)="rec!.feedback('undone')" [disabled]="rec!.isPending()">Deshacer</button>
          <button type="button" class="btn btn-sm" (click)="rec!.recommend()" [disabled]="rec!.working() || rec!.isPending()">Otra</button>
          <button type="button" class="btn btn-sm btn-primary" (click)="rec!.feedback('kept')">Me la quedo</button>
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      /* Sobre el visor 3D (a la derecha también en la vista dividida), sin tapar sus botones. */
      position: absolute;
      right: 12px;
      bottom: 12px;
      z-index: 5;
      max-width: min(360px, calc(100% - 24px));
    }
    .rec {
      padding: 12px;
      display: grid;
      gap: 8px;
      box-shadow: var(--shadow-lg, 0 8px 24px rgb(0 0 0 / 0.18));
    }
    header {
      gap: 8px;
    }
    .summary {
      margin: 0;
      font-size: 0.9rem;
    }
    .palette {
      display: flex;
      height: 18px;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .palette span {
      flex: 1;
    }
    .actions {
      gap: 6px;
      flex-wrap: wrap;
    }
    .small {
      font-size: 0.8rem;
      margin: 0;
    }
    [aria-pressed='true'] {
      background: var(--accent-soft, rgb(0 0 0 / 0.08));
    }
  `,
})
export class RecommendationCardComponent {
  // Sin el servicio (la demo, o un editor de prueba) no hay propuestas que enseñar.
  protected readonly rec = inject(RecommendService, { optional: true });
}
