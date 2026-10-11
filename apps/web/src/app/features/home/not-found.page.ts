import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/ui/icon.component';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <section class="container lost">
      <svg class="door" viewBox="0 0 120 120" aria-hidden="true">
        <path class="floor" d="M12 104h96" />
        <path class="frame" d="M34 104V20h52v84" />
        <path class="leaf" d="M34 20l34 10v84l-34-10z" />
        <circle class="knob" cx="60" cy="68" r="3" />
      </svg>
      <p class="eyebrow">Error 404</p>
      <h1 class="title-xl">Esta página <em>no existe.</em></h1>
      <p class="muted">Puede que el enlace esté mal escrito o que el proyecto se haya borrado: los que no se guardan desaparecen a las 24 horas.</p>
      <div class="row">
        <a routerLink="/" class="btn btn-primary"><app-icon name="back" /> Ir al inicio</a>
        <a routerLink="/proyectos" class="btn">Mis proyectos</a>
        <a routerLink="/plantillas" class="arrow-link">Ver las plantillas <app-icon name="arrowRight" /></a>
      </div>
    </section>
  `,
  styles: `
    .lost {
      display: grid;
      justify-items: center;
      gap: var(--space-3);
      text-align: center;
      padding-block: clamp(var(--space-7), 10vw, 120px);
    }
    h1,
    p {
      margin: 0;
    }
    .muted {
      max-width: 52ch;
    }
    .row {
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      margin-top: var(--space-3);
    }
    .door {
      width: 120px;
      height: 120px;
      fill: none;
      stroke-width: 3;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .floor,
    .frame {
      stroke: var(--text-muted);
    }
    .leaf {
      fill: var(--primary-soft);
      stroke: var(--primary);
    }
    .knob {
      fill: var(--accent);
    }
  `,
})
export class NotFoundPage {}
