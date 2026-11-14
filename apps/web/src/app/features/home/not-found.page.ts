import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/ui/icon.component';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <section class="lost">
      <div class="copy">
        <p class="code">Error 404</p>
        <h1 class="title-xl">Esta puerta <em>no lleva a ningún cuarto.</em></h1>
        <p class="muted">Puede que el enlace esté mal escrito o que el proyecto se haya borrado: los que no se guardan desaparecen a las 24 horas.</p>
        <div class="row">
          <a routerLink="/" class="btn btn-primary"><app-icon name="back" /> Ir al inicio</a>
          <a routerLink="/proyectos" class="btn">Mis proyectos</a>
          <a routerLink="/plantillas" class="arrow-link">Ver las plantillas <app-icon name="arrowRight" /></a>
        </div>
      </div>
      <img
        src="landing/cuarto-dentro-800.webp"
        srcset="landing/cuarto-dentro-800.webp 800w, landing/cuarto-dentro-1600.webp 1600w"
        sizes="(max-width: 860px) 100vw, 50vw"
        width="1600"
        height="1000"
        alt="Una sala vista desde la puerta, a la altura de los ojos."
      />
    </section>
  `,
  styles: `
    .lost {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
      min-height: calc(100svh - var(--header-h));
    }
    .copy {
      align-self: center;
      display: grid;
      gap: var(--space-4);
      padding: var(--space-6) clamp(16px, 5vw, 72px);
    }
    h1,
    p {
      margin: 0;
    }
    .code {
      color: var(--text-muted);
      font-weight: 600;
    }
    .muted {
      max-width: 46ch;
    }
    .row {
      flex-wrap: wrap;
      align-items: center;
      margin-top: var(--space-2);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: var(--radius-lg);
    }
    @media (max-width: 860px) {
      .lost {
        grid-template-columns: 1fr;
        min-height: 0;
      }
      img {
        height: 40svh;
      }
    }
  `,
})
export class NotFoundPage {}
