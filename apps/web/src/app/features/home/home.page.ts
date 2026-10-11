import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { RevealDirective } from '../../shared/ui/reveal.directive';
import { BeforeAfterComponent } from './before-after.component';
import { FeatureGalleryComponent } from './feature-gallery.component';
import { HERO_TEMPLATE, HeroComponent } from './hero.component';
import { StatsBandComponent } from './stats-band.component';
import { StyleShowcaseComponent } from './style-showcase.component';
import { TemplateMosaicComponent } from './template-mosaic.component';

const STEPS: readonly { title: string; text: string }[] = [
  { title: 'Una foto o tres medidas', text: 'La foto aporta puertas, ventanas, muebles y colores. Sin foto, eliges la forma del cuarto y escribes sus medidas.' },
  { title: 'Confirmas el plano', text: 'Ves lo que la app entendió, con sus cotas, y corriges lo que haga falta antes de seguir.' },
  { title: 'Amueblas y lo recorres', text: 'Editas en 3D, caminas por el cuarto, lo pruebas de noche y compartes un enlace que también se puede recorrer.' },
];

/** Qué saca la app de una foto y con cuánta seguridad: lo estimado se dice. */
const READS: readonly { title: string; text: string; exact: boolean }[] = [
  { title: 'Puertas y ventanas', text: 'En qué pared están y más o menos en qué tramo.', exact: true },
  { title: 'Los muebles que hay', text: 'Sofá, cama, mesa, sillas, estantes: los coloca donde estaban.', exact: true },
  { title: 'Colores', text: 'El de las paredes y el tono del piso.', exact: true },
  { title: 'La forma del cuarto', text: 'Si es rectangular o tiene un quiebre. Puedes cambiarla después.', exact: false },
  { title: 'Las medidas', text: 'Una estimación. Escribe las reales o calibra con una sola.', exact: false },
];

const FAQ = [
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
    a: 'Sí. "Compartir" crea un enlace que se abre sin cuenta: quien lo recibe ve el cuarto en 3D, lo recorre a pie y consulta la lista de muebles, pero no puede cambiar nada. También puedes exportar la imagen, el plano y la lista de compras.',
  },
];

/**
 * Página de inicio, en tono editorial: primero el cuarto, después la explicación, una idea por
 * sección. Todo lo que enseña es la app real: las imágenes son capturas del visor y del editor, las
 * cifras salen del catálogo y las plantillas son las mismas que se abren sin cuenta.
 */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, RevealDirective, HeroComponent, BeforeAfterComponent, FeatureGalleryComponent, StyleShowcaseComponent, TemplateMosaicComponent, StatsBandComponent],
  template: `
    <app-hero [start]="start()" />

    <section id="como-funciona" class="editorial" aria-labelledby="how-title">
      <div class="container" appReveal>
        <header class="spread">
          <p class="eyebrow">Cómo funciona</p>
          <h2 id="how-title" class="title-xl">Del cuarto que tienes al que quieres, <em>en tres pasos.</em></h2>
        </header>
        <ol class="steps">
          @for (step of steps; track step.title; let i = $index) {
            <li>
              <span class="n" aria-hidden="true">0{{ i + 1 }}</span>
              <h3>{{ step.title }}</h3>
              <p class="muted">{{ step.text }}</p>
            </li>
          }
        </ol>
      </div>
    </section>

    <section class="editorial" aria-labelledby="ba-title">
      <div class="container" appReveal>
        <header class="spread">
          <p class="eyebrow">Antes y después</p>
          <div>
            <h2 id="ba-title" class="title-xl">El mismo cuarto, <em>vacío y resuelto.</em></h2>
            <p class="lead">Arrastra la raya. A la izquierda, las paredes tal como las mides; a la derecha, lo que la app propone para ese espacio.</p>
          </div>
        </header>
        <app-before-after
          before="landing/cuarto-vacio"
          after="landing/cuarto-tarde"
          beforeLabel="Vacío"
          afterLabel="Amueblado"
          beforeAlt="Una sala vacía en 3D: piso de madera clara, paredes blancas, una ventana al fondo y una puerta al frente."
          afterAlt="La misma sala amueblada por la app: sofá en L bajo la ventana con cortinas, mesa de centro, butaca, estantería, televisor y un cuadro."
        />
      </div>
    </section>

    <section id="editor" class="editorial" aria-labelledby="features-title">
      <div class="container" appReveal>
        <header class="spread">
          <p class="eyebrow">El editor</p>
          <div>
            <h2 id="features-title" class="title-xl">No es una imagen. <em>Es un cuarto que puedes tocar.</em></h2>
            <p class="lead">Estas son capturas de la app tal como la vas a usar.</p>
          </div>
        </header>
        <app-feature-gallery />
        <ul class="extras">
          <li>
            <h3>Otra distribución con un clic</h3>
            <p class="muted">Cambia de pared y de piezas, pero nunca tapa una ventana ni bloquea la puerta.</p>
          </li>
          <li>
            <h3>Un asistente que entiende el espacio</h3>
            <p class="muted">Escribe "pon una lámpara junto al sofá". Él elige la pieza y la app calcula dónde cabe.</p>
          </li>
          <li>
            <h3>Revisión del diseño</h3>
            <p class="muted">Avisa si un pasillo queda en menos de 70 cm, si una puerta no abre o si algo tapa una ventana.</p>
          </li>
          <li>
            <h3>Lista de compras</h3>
            <p class="muted">Cada mueble con sus medidas y su precio estimado, y el total del cuarto. También en hoja de cálculo.</p>
          </li>
        </ul>
      </div>
    </section>

    <section id="estilos" class="editorial" aria-labelledby="styles-title">
      <div class="container" appReveal>
        <header class="spread">
          <p class="eyebrow">Estilos</p>
          <div>
            <h2 id="styles-title" class="title-xl">La misma sala, <em>seis maneras de vivirla.</em></h2>
            <p class="lead">El estilo decide qué muebles y qué materiales propone la app. Puedes mezclar hasta cuatro y cambiarlos después.</p>
          </div>
        </header>
        <app-style-showcase [signedIn]="auth.isAuthenticated()" />
      </div>
    </section>

    <section id="plantillas" class="editorial" aria-labelledby="templates-title">
      <div class="container" appReveal>
        <header class="spread">
          <p class="eyebrow">Plantillas</p>
          <div>
            <h2 id="templates-title" class="title-xl">Empieza por uno <em>ya hecho.</em></h2>
            <p class="lead">Cada plantilla abre el editor sin pedir cuenta. Lo que cambies se queda en tu navegador hasta que decidas guardarlo.</p>
          </div>
        </header>
        <app-template-mosaic />
        <p class="after"><a class="arrow-link" routerLink="/plantillas">Ver todas las plantillas <app-icon name="arrowRight" /></a></p>
      </div>
    </section>

    <section class="editorial" aria-labelledby="reads-title">
      <div class="container" appReveal>
        <header class="spread">
          <p class="eyebrow">De tu foto</p>
          <div>
            <h2 id="reads-title" class="title-xl">Qué reconoce <em>y qué solo estima.</em></h2>
            <p class="lead">Una foto no trae cinta métrica. La app te dice qué leyó con seguridad y qué es aproximado, para que corrijas lo segundo en un minuto.</p>
          </div>
        </header>
        <div class="reads">
          <ul class="read-list">
            @for (r of reads; track r.title) {
              <li>
                <h3>{{ r.title }}</h3>
                <p class="muted">{{ r.text }}</p>
                <span class="level" [class.approx]="!r.exact">{{ r.exact ? 'Fiable' : 'Aproximado' }}</span>
              </li>
            }
          </ul>
          <p class="fine muted note">No identifica marcas ni modelos exactos, ni los objetos pequeños que haya sobre los muebles.</p>
        </div>
        <app-stats-band class="stats" />
      </div>
    </section>

    <section id="preguntas" class="editorial" aria-labelledby="faq-title">
      <div class="container" appReveal>
        <header class="spread">
          <p class="eyebrow">Preguntas</p>
          <h2 id="faq-title" class="title-xl">Lo que se pregunta <em>antes de empezar.</em></h2>
        </header>
        <div class="faq-list">
          @for (item of faq; track item.q) {
            <details>
              <summary>{{ item.q }}</summary>
              <p class="muted">{{ item.a }}</p>
            </details>
          }
        </div>
      </div>
    </section>

    <section class="closing deep" aria-labelledby="closing-title">
      <div class="container closing-grid" appReveal>
        <div>
          <h2 id="closing-title" class="display">Empieza con el cuarto <em>que tienes.</em></h2>
          <p class="lead">Una foto o tres medidas bastan para verlo en 3D. Gratis y sin instalar nada.</p>
          <div class="closing-cta">
            <a class="btn btn-lg light" [routerLink]="start()">Diseñar mi cuarto</a>
            <a class="arrow-link" [routerLink]="['/demo', template]">Probar sin cuenta <app-icon name="arrowRight" /></a>
          </div>
        </div>
        <img
          src="landing/cuarto-noche-800.webp"
          srcset="landing/cuarto-noche-800.webp 800w, landing/cuarto-noche-1600.webp 1600w"
          sizes="(max-width: 900px) 100vw, 560px"
          alt=""
          width="1600"
          height="1000"
          loading="lazy"
          decoding="async"
        />
      </div>
    </section>
  `,
  styles: `
    section {
      scroll-margin-top: var(--header-h);
    }
    h3 {
      margin: 0;
      font-size: var(--text-lg);
      font-weight: 500;
    }
    p {
      margin: 0;
    }

    /* Tres pasos sobre un filete: sin tarjetas, el número manda. */
    .steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-6);
      border-top: 1px solid var(--rule);
    }
    .steps li {
      display: grid;
      gap: var(--space-2);
      align-content: start;
      padding-top: var(--space-5);
    }
    .n {
      font-family: var(--font-display);
      font-size: var(--text-3xl);
      font-weight: 380;
      line-height: 1;
      color: var(--accent);
      margin-bottom: var(--space-3);
    }

    .extras {
      list-style: none;
      margin: clamp(var(--space-6), 5vw, 72px) 0 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--space-5) var(--space-6);
    }
    .extras li {
      display: grid;
      gap: var(--space-2);
      align-content: start;
      padding-top: var(--space-4);
      border-top: 1px solid var(--rule);
    }

    .after {
      margin-top: var(--space-6);
    }

    /* Lo que lee de la foto: una lista con filetes, y a la derecha de cada fila su fiabilidad. */
    .read-list {
      list-style: none;
      margin: 0;
      padding: 0;
      border-top: 1px solid var(--rule);
    }
    .read-list li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) auto;
      gap: var(--space-3) var(--space-6);
      align-items: baseline;
      padding: var(--space-4) 0;
      border-bottom: 1px solid var(--rule);
    }
    .level {
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--primary);
    }
    .level.approx {
      color: var(--accent);
    }
    .note {
      margin-top: var(--space-4);
    }
    .stats {
      display: block;
      margin-top: clamp(var(--space-6), 5vw, 72px);
    }

    .faq-list {
      border-top: 1px solid var(--rule);
      columns: 2;
      column-gap: var(--space-7);
    }
    details {
      break-inside: avoid;
      border-bottom: 1px solid var(--rule);
    }
    summary {
      display: flex;
      justify-content: space-between;
      gap: var(--space-4);
      padding: var(--space-4) 0;
      font-family: var(--font-display);
      font-size: var(--text-lg);
      cursor: pointer;
      list-style: none;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    summary::after {
      content: '+';
      flex: none;
      color: var(--accent);
      font-family: var(--font);
      font-size: 1.4rem;
      line-height: 1;
      transition: transform 0.2s var(--ease);
    }
    details[open] summary::after {
      transform: rotate(45deg);
    }
    details p {
      padding: 0 var(--space-6) var(--space-4) 0;
    }

    /* Cierre: la única sección profunda de la página. */
    .closing {
      padding-block: var(--section-y);
    }
    .closing-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
      gap: var(--space-6) var(--space-7);
      align-items: center;
    }
    .closing .display {
      font-size: var(--text-3xl);
      max-width: 14ch;
    }
    .closing .lead {
      margin-top: var(--space-4);
      max-width: 44ch;
    }
    .closing-cta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-4) var(--space-5);
      align-items: center;
      margin-top: var(--space-6);
    }
    .closing .arrow-link {
      color: var(--on-deep);
    }
    .btn.light {
      background: var(--on-deep);
      border-color: var(--on-deep);
      color: var(--deep);
    }
    .btn.light:hover {
      background: #ffffff;
      border-color: #ffffff;
    }
    .closing img {
      width: 100%;
      height: auto;
      aspect-ratio: 16 / 10;
      object-fit: cover;
      border-radius: var(--radius-lg);
    }

    @media (max-width: 900px) {
      .steps,
      .closing-grid {
        grid-template-columns: 1fr;
      }
      .steps {
        gap: 0;
      }
      .extras {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .faq-list {
        columns: 1;
      }
      .read-list li {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .read-list p {
        grid-column: 1 / -1;
        grid-row: 2;
      }
    }
    @media (max-width: 520px) {
      .extras {
        grid-template-columns: 1fr;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      summary::after {
        transition: none;
      }
    }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  protected readonly steps = STEPS;
  protected readonly reads = READS;
  protected readonly faq = FAQ;
  protected readonly template = HERO_TEMPLATE;
  protected readonly start = computed(() => (this.auth.isAuthenticated() ? '/proyectos/nuevo' : '/registro'));
}
