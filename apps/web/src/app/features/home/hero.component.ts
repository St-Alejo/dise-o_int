import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/ui/icon.component';

export type HeroLight = 'dia' | 'tarde' | 'noche';

export const HERO_LIGHTS: readonly { id: HeroLight; label: string; alt: string }[] = [
  { id: 'dia', label: 'Día', alt: 'Una sala amueblada en 3D con luz de día: sofá en L bajo la ventana con cortinas, mesa de centro, butaca de cuero, estantería y un cuadro.' },
  { id: 'tarde', label: 'Tarde', alt: 'La misma sala por la tarde: el sol entra bajo y cálido por la ventana y alarga las sombras sobre el piso.' },
  { id: 'noche', label: 'Noche', alt: 'La misma sala de noche, alumbrada solo por su lámpara colgante.' },
];

/** Plantilla que abre "Probar sin cuenta": la misma sala que se ve en la imagen. */
export const HERO_TEMPLATE = 'sala-escandinava';

/**
 * Encabezado de la página de inicio: primero el cuarto, después la explicación. La imagen es una
 * captura real del visor; el conmutador enseña la misma sala con las tres luces del editor.
 */
@Component({
  selector: 'app-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <section class="hero" aria-labelledby="hero-title">
      <div class="container">
        <p class="eyebrow">Diseño de interiores con IA</p>
        <h1 id="hero-title" class="display">Tu cuarto, antes de mover <em>un solo mueble.</em></h1>
        <div class="pitch">
          <p class="lead">
            Sube una foto o dibuja la planta. La app levanta el cuarto en 3D, lo amuebla y te deja cambiarlo todo: recorrerlo a pie, verlo de
            noche y llevarte la lista de compras.
          </p>
          <div class="cta">
            <a class="btn btn-primary btn-lg" [routerLink]="start()">Diseñar mi cuarto</a>
            <a class="arrow-link" [routerLink]="['/demo', template]">Probar sin cuenta <app-icon name="arrowRight" /></a>
          </div>
        </div>
      </div>

      <figure class="stage container">
        <div class="frame">
          @for (l of lights; track l.id) {
            <img
              [class.on]="light() === l.id"
              [attr.srcset]="'landing/cuarto-' + l.id + '-800.webp 800w, landing/cuarto-' + l.id + '-1600.webp 1600w'"
              sizes="(max-width: 1232px) 100vw, 1200px"
              [src]="'landing/cuarto-' + l.id + '-1600.webp'"
              [alt]="l.alt"
              width="1600"
              height="1000"
              [attr.loading]="l.id === 'tarde' ? 'eager' : 'lazy'"
              [attr.fetchpriority]="l.id === 'tarde' ? 'high' : null"
              [attr.aria-hidden]="light() === l.id ? null : 'true'"
              decoding="async"
            />
          }
        </div>
        <figcaption>
          <div class="lights" role="group" aria-label="Luz con la que se ve la sala">
            @for (l of lights; track l.id) {
              <button type="button" [attr.aria-pressed]="light() === l.id" (click)="light.set(l.id)">{{ l.label }}</button>
            }
          </div>
          <span class="muted">Captura del editor. Es la plantilla que se abre con "Probar sin cuenta".</span>
        </figcaption>
      </figure>
    </section>
  `,
  styles: `
    .hero {
      padding-top: clamp(40px, 7vw, 104px);
    }
    .eyebrow {
      margin-bottom: var(--space-4);
    }
    .display {
      max-width: 15ch;
    }
    .pitch {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
      gap: var(--space-5) var(--space-7);
      align-items: end;
      margin-top: clamp(var(--space-5), 4vw, 56px);
    }
    .lead {
      max-width: 52ch;
      margin: 0;
    }
    .cta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-4) var(--space-5);
      align-items: center;
      justify-content: flex-end;
    }
    .stage {
      margin-block: clamp(var(--space-6), 5vw, 72px) 0;
    }
    .frame {
      position: relative;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border-radius: var(--radius-lg);
      background: var(--surface-2);
    }
    img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transition: opacity 0.7s var(--ease);
    }
    img.on {
      opacity: 1;
    }
    figcaption {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3) var(--space-5);
      align-items: center;
      justify-content: space-between;
      margin-top: var(--space-4);
      font-size: var(--text-sm);
    }
    .lights {
      display: inline-flex;
      gap: 2px;
      padding: 3px;
      border-radius: 999px;
      border: 1px solid var(--rule);
    }
    .lights button {
      min-height: 36px;
      padding: 0 var(--space-4);
      border: 0;
      border-radius: 999px;
      background: none;
      color: var(--text-muted);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .lights button[aria-pressed='true'] {
      background: var(--text);
      color: var(--bg);
    }
    @media (max-width: 860px) {
      .pitch {
        grid-template-columns: 1fr;
        align-items: start;
      }
      .cta {
        justify-content: flex-start;
      }
      .frame {
        aspect-ratio: 4 / 3;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      img {
        transition: none;
      }
    }
  `,
})
export class HeroComponent {
  /** A dónde lleva "Diseñar mi cuarto": al asistente o, sin sesión, al registro. */
  readonly start = input.required<string>();
  protected readonly lights = HERO_LIGHTS;
  protected readonly template = HERO_TEMPLATE;
  protected readonly light = signal<HeroLight>('tarde');
}
