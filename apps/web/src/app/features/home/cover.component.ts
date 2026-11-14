import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChildren } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STYLES, STYLE_IDS, type CatalogItem, type StyleId } from '@interiores/shared-types';
import { CatalogApi } from '../../core/api/projects.api';
import { IconComponent } from '../../shared/ui/icon.component';
import { STYLE_DETAILS, piecesFor, styleLink } from './style-showcase.component';

/** Plantilla que abre "Probar sin cuenta": la sala escandinava, la primera vida de la portada. */
export const HERO_TEMPLATE = 'sala-escandinava';

/** La foto de cada estilo: la misma sala, la misma cámara y la misma luz de tarde (render de Blender). */
export function lifeImage(style: StyleId): { src: string; srcset: string } {
  const base = `landing/vida-${style}`;
  return { src: `${base}-1200.webp`, srcset: `${base}-700.webp 700w, ${base}-1200.webp 1200w` };
}

/**
 * Qué estilo toca enseñar: el bloque cuyo centro está más cerca del centro de la pantalla. Antes del
 * primero manda el primero; después del último, el último.
 */
export function activeLife(centres: readonly number[], viewportCentre: number): number {
  let best = 0;
  let distance = Infinity;
  centres.forEach((c, i) => {
    const d = Math.abs(c - viewportCentre);
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}

/**
 * Portada de la página de inicio en "escenario partido": la mitad derecha es una foto que no se mueve
 * y la izquierda se lee. La foto es siempre la misma sala, desde el mismo sitio; al bajar por los
 * seis estilos, el cuarto cambia de vida. Con las muestras de color de la barra se salta a cualquiera.
 */
@Component({
  selector: 'app-cover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, CurrencyPipe],
  template: `
    <div class="split">
      <div class="read">
        <section class="lead-sheet" aria-labelledby="hero-title">
          <h1 id="hero-title" class="title">Tu cuarto, en todos <em>sus estilos.</em></h1>
          <p class="lede">
            Sube una foto o escribe tres medidas: la app levanta el cuarto en 3D, lo amuebla a tu estilo y te entrega la lista de compras y los planos para
            la obra.
          </p>
          <div class="cta">
            <a class="btn btn-primary btn-lg" [routerLink]="start()">Diseñar mi cuarto</a>
            <a class="btn btn-lg" [routerLink]="['/demo', template]">Probar sin cuenta <app-icon name="arrowRight" /></a>
          </div>
          <p class="hint">Gratis, sin instalar nada. La foto es una sala real hecha con la app: baja y cambia de estilo.</p>
        </section>

        <section id="estilos" class="lives" aria-labelledby="styles-title">
          <header class="lives-head">
            <h2 id="styles-title">Una sala, seis vidas.</h2>
            <p>
              La misma sala de 5 × 4,2 m, con la misma ventana y la misma puerta. El estilo decide qué muebles, materiales y colores propone la app; puedes
              mezclar hasta cuatro y cambiarlos después.
            </p>
          </header>
          <ol class="life-list">
            @for (s of styles; track s.id; let i = $index) {
              <li #life class="life" [class.on]="active() === i" [attr.aria-labelledby]="'life-' + s.id">
                <img
                  class="life-shot"
                  [attr.srcset]="image(s.id).srcset"
                  sizes="100vw"
                  [src]="image(s.id).src"
                  [alt]="'La sala de la app amueblada en estilo ' + s.label + ', con luz de tarde.'"
                  width="1200"
                  height="1500"
                  loading="lazy"
                  decoding="async"
                />
                <h3 [id]="'life-' + s.id" class="life-name">{{ s.label }}</h3>
                <p class="life-text">{{ s.description }}</p>
                <div class="life-swatches" aria-hidden="true">
                  @for (c of s.palette; track c) {
                    <span [style.background]="c"></span>
                  }
                </div>
                <p class="life-details">{{ details[s.id].join(' · ') }}</p>
                @if (pieces()[s.id]; as list) {
                  @if (list.length) {
                    <dl class="life-pieces" [attr.aria-label]="'Piezas del catálogo en estilo ' + s.label">
                      @for (p of list; track p.id) {
                        <div>
                          <dt>{{ p.name }}</dt>
                          <dd>{{ p.price | currency: 'USD' : 'symbol' : '1.0-0' }}</dd>
                        </div>
                      }
                    </dl>
                  }
                }
                <figure class="life-real">
                  <img
                    [src]="'landing/fotos/' + s.id + '.webp'"
                    [alt]="'Fotografía de un interior real de estilo ' + s.label + '.'"
                    width="720"
                    height="480"
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption>El estilo, en una casa real</figcaption>
                </figure>
                <a class="arrow-link" [routerLink]="link(s.id).path" [queryParams]="link(s.id).query">
                  Empezar en estilo {{ s.label }} <app-icon name="arrowRight" />
                </a>
              </li>
            }
          </ol>
        </section>
      </div>

      <div class="photo">
        @for (s of styles; track s.id; let i = $index) {
          <img
            class="life-photo"
            [class.on]="active() === i"
            [attr.srcset]="image(s.id).srcset"
            sizes="(max-width: 860px) 100vw, 50vw"
            [src]="image(s.id).src"
            [alt]="active() === i ? 'La sala de la app amueblada en estilo ' + s.label + ', con luz de tarde.' : ''"
            [attr.aria-hidden]="active() === i ? null : 'true'"
            width="1200"
            height="1500"
            [attr.loading]="i === 0 ? 'eager' : 'lazy'"
            [attr.fetchpriority]="i === 0 ? 'high' : null"
            decoding="async"
          />
        }
        <div class="bar">
          <p class="bar-what">
            <strong>{{ current().label }}</strong>
            <span>Sala de 5 × 4,2 m · render de la app en Blender</span>
          </p>
          <div class="bar-pick" role="group" aria-label="Ver la sala en otro estilo">
            @for (s of styles; track s.id; let i = $index) {
              <button
                type="button"
                [class.on]="active() === i"
                [attr.aria-pressed]="active() === i"
                [attr.aria-label]="'Ver la sala en estilo ' + s.label"
                [style.--swatch]="s.palette[1]"
                (click)="go(i)"
              ></button>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      --gap: 12px;
    }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--gap);
      /* La cabecera de la home va encima, sobre el lino: la foto empieza debajo de ella. */
      padding: var(--header-h) var(--gap) var(--gap);
    }
    .read {
      padding-inline: clamp(20px, 4.4vw, 72px);
    }
    /* La primera hoja: lo que es, para qué sirve y la acción, a la altura de una pantalla. */
    .lead-sheet {
      min-height: calc(100svh - var(--header-h) - var(--gap));
      display: grid;
      align-content: center;
      gap: 28px;
      padding-block: 24px 48px;
    }
    .title {
      margin: 0;
      font-size: var(--text-3xl);
      line-height: 0.98;
      max-width: 13ch;
    }
    .title em {
      color: var(--primary);
    }
    .lede {
      margin: 0;
      max-width: 44ch;
      font-size: var(--text-lg);
      line-height: 1.5;
    }
    .cta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .hint {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-sm);
      max-width: 44ch;
    }

    .lives {
      padding-bottom: 12vh;
      scroll-margin-top: var(--gap);
    }
    .lives-head {
      max-width: 46ch;
      padding-block: 8vh 4vh;
    }
    .lives-head h2 {
      font-size: var(--text-2xl);
      margin: 0 0 var(--space-4);
    }
    .lives-head p {
      margin: 0;
    }
    .life-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    /* Un estilo por pantalla: el que está en el centro manda en la foto. */
    .life {
      min-height: 78svh;
      display: grid;
      align-content: center;
      gap: var(--space-4);
      max-width: 46ch;
      padding-block: 6vh;
    }
    .life-name {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 400;
      font-size: var(--text-3xl);
      line-height: 1;
      letter-spacing: -0.015em;
      color: var(--text-muted);
      transition: color 0.6s var(--ease);
    }
    .life.on .life-name {
      color: var(--text);
    }
    .life-text {
      margin: 0;
      font-size: var(--text-lg);
    }
    .life-swatches {
      display: flex;
      gap: 6px;
    }
    .life-swatches span {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%);
    }
    .life-details {
      margin: 0;
      color: var(--text-muted);
    }
    .life-pieces {
      margin: 0;
      display: grid;
      gap: 6px;
    }
    .life-pieces div {
      display: flex;
      justify-content: space-between;
      gap: var(--space-4);
    }
    .life-pieces dt {
      color: var(--text);
    }
    .life-pieces dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .life-shot {
      display: none;
    }
    .life-real {
      margin: var(--space-2) 0 0;
      display: grid;
      grid-template-columns: 132px 1fr;
      gap: var(--space-3);
      align-items: end;
    }
    .life-real img {
      width: 132px;
      aspect-ratio: 3 / 2;
      height: auto;
      object-fit: cover;
      border-radius: var(--radius-sm);
    }
    .life-real figcaption {
      font-size: var(--text-sm);
      color: var(--text-muted);
    }

    /* La mitad que no se mueve: la sala, con su barra de lino abajo. */
    .photo {
      position: sticky;
      top: var(--header-h);
      height: calc(100svh - var(--header-h) - var(--gap));
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--surface-2);
    }
    .life-photo {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transform: scale(1.04);
      transition:
        opacity 1.4s var(--ease),
        transform 6s var(--ease);
    }
    .life-photo.on {
      opacity: 1;
      transform: scale(1);
    }
    .bar {
      position: absolute;
      inset: auto 0 0;
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      padding: 10px 12px 10px 20px;
      background: var(--bg);
    }
    .bar-what {
      margin: 0;
      display: grid;
      line-height: 1.25;
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .bar-what strong {
      color: var(--text);
      font-size: var(--text-base);
    }
    .bar-pick {
      display: flex;
      gap: 2px;
    }
    .bar-pick button {
      width: 44px;
      height: 44px;
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .bar-pick button::before {
      content: '';
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--swatch);
      box-shadow:
        inset 0 0 0 1px rgb(0 0 0 / 18%),
        0 0 0 0 var(--text);
      transition: box-shadow 0.25s var(--ease);
    }
    .bar-pick button:hover::before {
      box-shadow:
        inset 0 0 0 1px rgb(0 0 0 / 18%),
        0 0 0 2px var(--border);
    }
    .bar-pick button.on::before {
      box-shadow:
        inset 0 0 0 1px rgb(0 0 0 / 18%),
        0 0 0 3px var(--text);
    }

    @media (max-width: 860px) {
      .split {
        grid-template-columns: 1fr;
      }
      /* En el celular la sala va primero y cada estilo trae su propia foto: no hay mitad fija. */
      .photo {
        order: -1;
        position: relative;
        top: auto;
        height: 62svh;
      }
      .bar {
        display: none;
      }
      .read {
        padding-inline: 8px;
      }
      .lead-sheet {
        min-height: 0;
        padding-block: 28px 40px;
      }
      .life-shot {
        display: block;
        width: 100%;
        height: auto;
        aspect-ratio: 4 / 5;
        max-height: 70svh;
        object-fit: cover;
        border-radius: var(--radius-lg);
        margin-bottom: var(--space-2);
      }
      .title {
        font-size: clamp(2.4rem, 10vw, 3.2rem);
      }
      .cta .btn {
        flex: 1 1 100%;
      }
      .life {
        min-height: 0;
        padding-block: 4vh;
      }
      .life-name {
        color: var(--text);
      }
    }
  `,
})
export class CoverComponent {
  /** A dónde lleva "Diseñar mi cuarto": al asistente o, sin sesión, al registro. */
  readonly start = input.required<string>();
  readonly signedIn = input(false);
  protected readonly template = HERO_TEMPLATE;
  protected readonly styles = STYLE_IDS.map((id) => STYLES[id]);
  protected readonly details = STYLE_DETAILS;
  protected readonly active = signal(0);
  protected readonly current = computed(() => this.styles[this.active()]!);
  private readonly catalog = signal<CatalogItem[] | null>(null);
  /** Tres piezas reales del catálogo por estilo (vacío si el catálogo no responde). */
  protected readonly pieces = computed(() => {
    const catalog = this.catalog() ?? [];
    return Object.fromEntries(STYLE_IDS.map((id) => [id, piecesFor(id, catalog)])) as Record<StyleId, ReturnType<typeof piecesFor>>;
  });
  private readonly lives = viewChildren<ElementRef<HTMLElement>>('life');

  constructor() {
    inject(CatalogApi)
      .all()
      .then((items) => this.catalog.set(items))
      .catch(() => undefined);
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      let frame = 0;
      const measure = () => {
        frame = 0;
        const blocks = this.lives().map((l) => l.nativeElement.getBoundingClientRect());
        if (!blocks.length) return;
        // Hasta que el primer estilo llega a la pantalla, la sala se queda en el primero.
        if (blocks[0]!.top > window.innerHeight * 0.6) return this.active.set(0);
        this.active.set(activeLife(blocks.map((b) => b.top + b.height / 2), window.innerHeight / 2));
      };
      const onScroll = () => {
        if (!frame) frame = requestAnimationFrame(measure);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      measure();
      destroy.onDestroy(() => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        if (frame) cancelAnimationFrame(frame);
      });
    });
  }

  protected image(style: StyleId) {
    return lifeImage(style);
  }

  protected link(style: StyleId) {
    return styleLink(style, this.signedIn());
  }

  /** Lleva al bloque del estilo elegido (la foto cambia al llegar). */
  protected go(i: number): void {
    this.active.set(i);
    const block = this.lives()[i]?.nativeElement;
    if (!block) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const top = block.getBoundingClientRect().top + window.scrollY - (window.innerHeight - block.offsetHeight) / 2;
    window.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' });
  }
}
