import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STYLES, type StyleId } from '@interiores/shared-types';
import { IconComponent } from '../../shared/ui/icon.component';

/** Qué materiales y piezas se asocian a cada estilo, para que la tarjeta diga algo más que su nombre. */
const DETAILS: Record<StyleId, readonly string[]> = {
  escandinavo: ['Roble claro', 'Lino y lana', 'Blancos cálidos'],
  minimalista: ['Superficies lisas', 'Grises neutros', 'Poco mobiliario'],
  industrial: ['Metal negro', 'Cuero', 'Madera recuperada'],
  bohemio: ['Ratán y fibras', 'Plantas', 'Tonos tierra'],
  moderno: ['Formas geométricas', 'Contraste', 'Un acento de color'],
  clasico: ['Maderas oscuras', 'Molduras', 'Tapicería'],
};

/** A dónde lleva "Empezar con este estilo": al asistente, pasando antes por el registro si hace falta. */
export function styleLink(style: StyleId, signedIn: boolean): { path: string; query: Record<string, string> } {
  return signedIn
    ? { path: '/proyectos/nuevo', query: { estilo: style } }
    : { path: '/registro', query: { volver: `/proyectos/nuevo?estilo=${style}` } };
}

/** Los estilos de la app, cada uno con su paleta y un enlace para empezar un proyecto con él. */
@Component({
  selector: 'app-style-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <ul class="grid">
      @for (s of styles; track s.id) {
        <li class="card card-hover style">
          <div class="swatches" aria-hidden="true">
            @for (c of s.palette; track c) {
              <span [style.background]="c"></span>
            }
          </div>
          <div class="body">
            <h3>{{ s.label }}</h3>
            <p class="muted">{{ s.description }}</p>
            <ul class="details" [attr.aria-label]="'Lo típico del estilo ' + s.label">
              @for (d of details[s.id]; track d) {
                <li class="badge">{{ d }}</li>
              }
            </ul>
            <a class="go" [routerLink]="link(s.id).path" [queryParams]="link(s.id).query" [attr.aria-label]="'Empezar con el estilo ' + s.label">
              Empezar con este estilo <app-icon name="arrowRight" />
            </a>
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    .grid {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-5);
    }
    .style {
      padding: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .swatches {
      display: grid;
      grid-template-columns: 3fr 2fr 1fr;
      height: 88px;
    }
    .body {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-4) var(--space-5) var(--space-5);
      align-content: start;
      flex: 1;
    }
    h3,
    p {
      margin: 0;
    }
    .details {
      list-style: none;
      margin: var(--space-1) 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
    }
    .go {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      margin-top: auto;
      font-weight: 600;
      font-size: var(--text-sm);
      text-decoration: none;
    }
    .go:hover {
      text-decoration: underline;
    }
    @media (max-width: 900px) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    @media (max-width: 560px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class StyleCardsComponent {
  readonly signedIn = input(false);
  protected readonly styles = Object.values(STYLES);
  protected readonly details = DETAILS;

  protected link(style: StyleId) {
    return styleLink(style, this.signedIn());
  }
}
