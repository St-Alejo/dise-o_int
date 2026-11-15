import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { RevealDirective } from '../../shared/ui/reveal.directive';
import { BeforeAfterComponent } from './before-after.component';
import { HERO_TEMPLATE } from './cover.component';
import { FilmComponent } from './film.component';
import { reducedMotion, smoothScroll } from './motion';
import { PiecesComponent } from './pieces.component';
import { RunwayComponent } from './runway.component';
import { VitrinaComponent } from './vitrina.component';
import { WalkComponent } from './walk.component';

export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: '¿Necesito una foto para empezar?',
    a: 'No. Con foto, la app detecta puertas y ventanas en su pared, parte de los muebles que ya tienes y los colores, y estima las medidas en menos de un minuto. Sin foto, eliges la forma (rectangular, en L, en T o en U), escribes tres medidas exactas y la app propone los muebles según el tipo de cuarto y el estilo. Las dos terminan en el mismo editor.',
  },
  {
    q: '¿Qué tan exactas son las medidas que salen de una foto?',
    a: 'Son una estimación: la app acierta dónde están puertas y ventanas, qué muebles hay y los colores, pero el tamaño es aproximado. Por eso el editor te muestra el plano y te deja escribir las medidas reales o calibrar con una sola.',
  },
  {
    q: '¿Puedo probarlo sin crear una cuenta?',
    a: 'Sí. Las plantillas abren el editor completo sin registro y lo que cambias se guarda en tu navegador. Si te gusta el resultado, con un clic pasa a ser un proyecto de tu cuenta.',
  },
  {
    q: '¿Puedo cambiar lo que la app colocó?',
    a: 'Todo. Mueve, gira, cambia de tamaño y de material cada mueble, pinta paredes y piso, pide otra distribución o díselo al asistente con tus palabras. Cada cambio se puede deshacer.',
  },
  {
    q: '¿Qué pasa con mis fotos?',
    a: 'Quitamos la ubicación GPS al subirlas, nunca se usan para entrenar modelos y, si no guardas ni compartes el proyecto, se borra por completo a las 24 horas.',
  },
  {
    q: '¿Cuánto cuesta?',
    a: 'Nada: es un proyecto académico y crear la cuenta es gratis. Los precios que ves junto a cada mueble son estimados del catálogo para que armes tu lista de compras; la app no vende nada.',
  },
  {
    q: '¿Funciona en el celular?',
    a: 'Sí. Las páginas se adaptan a la pantalla y el 3D se maneja con los dedos. Para editar con detalle es más cómodo un computador, donde además tienes los atajos de teclado.',
  },
  {
    q: '¿Puedo enseñárselo a otra persona?',
    a: '"Compartir" crea un enlace que se abre sin cuenta: quien lo recibe ve el cuarto en 3D, lo recorre a pie y consulta la lista de muebles, pero no puede cambiar nada. También puedes exportar la imagen, el plano y la lista de compras.',
  },
];

/**
 * Página de inicio en cinco movimientos, cada uno con su propia forma de avanzar con el scroll:
 * la película (de la foto al hogar), la pista (el plano tendido por el que vuela la cámara), el
 * antes y después, el paseo por los seis estilos y las piezas del catálogo flotando. Todo lo que
 * enseña sale de la app: sus renders, sus capturas y su catálogo.
 */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, RevealDirective, FilmComponent, RunwayComponent, BeforeAfterComponent, WalkComponent, PiecesComponent, VitrinaComponent],
  template: `
    <app-film [start]="start()" />

    <div id="editor" class="anchor"></div>
    <app-runway />

    <section class="ba" aria-labelledby="ba-title">
      <div class="ba-head" appReveal>
        <p class="kicker">Antes y después</p>
        <h2 id="ba-title" class="big">Vacío. <span>Resuelto.</span></h2>
        <p class="ba-lead">Arrastra la raya. A un lado, las paredes tal como las mides; al otro, lo que la app propone para ese espacio.</p>
      </div>
      <app-before-after
        before="landing/cuarto-vacio"
        after="landing/cuarto-tarde"
        beforeLabel="Vacío"
        afterLabel="Amueblado"
        beforeAlt="Una sala vacía en 3D: piso de madera clara, paredes blancas, una ventana al fondo y una puerta al frente."
        afterAlt="La misma sala amueblada por la app: sofá en L bajo la ventana con cortinas, mesa de centro, butaca, estantería, televisor y un cuadro."
      />
    </section>

    <div id="estilos" class="anchor"></div>
    <app-walk />

    <div id="catalogo" class="anchor"></div>
    <app-pieces />

    <section id="plantillas" class="vitrina-sec" aria-labelledby="templates-title">
      <app-vitrina appReveal />
    </section>

    <section id="preguntas" class="faq" aria-labelledby="faq-title">
      <div class="faq-grid">
        <div class="faq-head">
          <p class="kicker">05 · Preguntas</p>
          <h2 id="faq-title" class="big">Antes de<br />empezar.</h2>
        </div>
        <div class="faq-list">
          @for (item of faq; track item.q; let i = $index) {
            <details [open]="i === 0">
              <summary>
                <span class="q-n">{{ '0' + (i + 1) }}</span>
                <span class="q">{{ item.q }}</span>
                <span class="plus" aria-hidden="true"></span>
              </summary>
              <p>{{ item.a }}</p>
            </details>
          }
        </div>
      </div>
    </section>

    <section class="closing" aria-labelledby="closing-title">
      <img
        src="landing/cuarto-noche-1600.webp"
        srcset="landing/cuarto-noche-800.webp 800w, landing/cuarto-noche-1600.webp 1600w"
        sizes="100vw"
        alt="La sala de noche, alumbrada solo por su lámpara colgante."
        width="1600"
        height="1000"
        loading="lazy"
        decoding="async"
      />
      <div class="closing-copy" appReveal>
        <h2 id="closing-title" class="giant">Empieza con el cuarto que tienes.</h2>
        <div class="closing-row">
          <p>Una foto o tres medidas bastan para verlo en 3D. Gratis y sin instalar nada.</p>
          <div class="closing-cta">
            <a class="btn btn-lg brass" [routerLink]="start()">Diseñar mi cuarto</a>
            <a class="btn btn-lg outline" [routerLink]="['/demo', template]">Probar sin cuenta <app-icon name="arrowRight" /></a>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      --ink: #f3eee6;
      --ink-2: #a89f93;
      --brass: #c9a46a;
      --night: #100f0e;
      background: var(--night);
    }
    section,
    .anchor {
      scroll-margin-top: var(--header-h);
    }
    .kicker {
      margin: 0 0 14px;
      color: var(--brass);
      font-size: var(--text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .big {
      margin: 0;
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 300;
      font-size: clamp(2.6rem, 6.4vw, 6rem);
      line-height: 0.88;
      text-transform: uppercase;
    }

    /* Antes y después: el titular partido en dos, como la imagen. */
    .ba {
      background: var(--night);
      color: var(--ink);
      padding: var(--section-y) clamp(16px, 4vw, 56px);
    }
    .ba-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 26rem);
      gap: 12px 48px;
      align-items: end;
      margin-bottom: 40px;
    }
    .ba-head .kicker {
      grid-column: 1 / -1;
      margin: 0;
    }
    .ba .big {
      color: var(--ink);
    }
    .ba .big span {
      color: var(--brass);
    }
    .ba-lead {
      margin: 0;
      color: var(--ink);
    }
    .ba app-before-after {
      display: block;
      overflow: hidden;
    }

    .vitrina-sec {
      padding-block: var(--section-y);
      background: var(--bg);
    }

    /* Preguntas: una lista que se abre de una en una, numerada como un pliego. */
    .faq {
      background: var(--night);
      color: var(--ink);
      padding: var(--section-y) clamp(16px, 4vw, 56px);
    }
    .faq-grid {
      display: grid;
      grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
      gap: 40px clamp(32px, 6vw, 96px);
      max-width: 1400px;
      margin-inline: auto;
    }
    .faq-head {
      position: sticky;
      top: calc(var(--header-h) + 32px);
      align-self: start;
    }
    .faq .big {
      color: var(--ink);
    }
    .faq-list {
      border-top: 1px solid rgb(243 238 230 / 22%);
    }
    details {
      border-bottom: 1px solid rgb(243 238 230 / 22%);
    }
    summary {
      list-style: none;
      cursor: pointer;
      display: grid;
      grid-template-columns: 3rem minmax(0, 1fr) 24px;
      gap: 16px;
      align-items: baseline;
      padding: 22px 0;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    summary:focus-visible {
      outline: 2px solid var(--brass);
      outline-offset: 4px;
    }
    .q-n {
      color: var(--brass);
      font-variant-numeric: tabular-nums;
    }
    .q {
      font-family: var(--font-display);
      font-stretch: 75%;
      font-size: var(--text-xl);
      line-height: 1.15;
    }
    .plus {
      position: relative;
      width: 18px;
      height: 18px;
      align-self: center;
    }
    .plus::before,
    .plus::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      border-top: 2px solid var(--brass);
      transition: transform 0.3s var(--ease);
    }
    .plus::after {
      transform: rotate(90deg);
    }
    details[open] .plus::after {
      transform: rotate(0deg);
    }
    details p {
      margin: 0 0 26px calc(3rem + 16px);
      max-width: 60ch;
      line-height: 1.6;
      color: var(--ink);
    }

    /* Cierre: la sala de noche a sangre y una frase que ocupa todo el ancho. */
    .closing {
      position: relative;
      min-height: 100svh;
      display: grid;
      align-items: end;
      color: var(--ink);
      background: var(--night);
      overflow: hidden;
    }
    .closing img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .closing::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(transparent 30%, rgb(16 15 14 / 92%) 88%);
    }
    .closing-copy {
      position: relative;
      z-index: 1;
      padding: 0 clamp(16px, 4vw, 56px) clamp(40px, 8vh, 80px);
    }
    .giant {
      margin: 0 0 32px;
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 600;
      font-size: clamp(3rem, 9.6vw, 10.5rem);
      line-height: 0.84;
      text-transform: uppercase;
      color: var(--ink);
      max-width: 12ch;
    }
    .closing-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: end;
      gap: 24px;
      border-top: 1px solid rgb(243 238 230 / 30%);
      padding-top: 24px;
    }
    .closing-row p {
      margin: 0;
      max-width: 36ch;
      font-size: var(--text-lg);
    }
    .closing-cta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .btn.brass {
      --btn-bg: var(--brass);
      --btn-fg: var(--night);
      --btn-border: var(--brass);
    }
    .btn.brass:hover {
      background: #dcb97f;
      border-color: #dcb97f;
    }
    .btn.outline {
      --btn-bg: transparent;
      --btn-fg: var(--ink);
      --btn-border: var(--ink);
    }
    .btn.outline:hover {
      background: rgb(255 255 255 / 12%);
      border-color: var(--ink);
    }

    @media (max-width: 860px) {
      .ba-head,
      .faq-grid {
        grid-template-columns: 1fr;
      }
      .faq-head {
        position: static;
      }
      summary {
        grid-template-columns: 2.2rem minmax(0, 1fr) 18px;
        gap: 10px;
      }
      details p {
        margin-left: 0;
      }
      .closing-cta .btn {
        flex: 1 1 100%;
      }
    }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  protected readonly faq = FAQ;
  protected readonly template = HERO_TEMPLATE;
  protected readonly start = computed(() => (this.auth.isAuthenticated() ? '/proyectos/nuevo' : '/registro'));

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      if (reducedMotion()) return;
      let stop: (() => void) | null = null;
      let alive = true;
      destroy.onDestroy(() => {
        alive = false;
        stop?.();
      });
      void smoothScroll().then((off) => (alive ? (stop = off) : off()));
    });
  }
}
