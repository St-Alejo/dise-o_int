import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';
import { RevealDirective } from '../../shared/ui/reveal.directive';
import { FeatureGalleryComponent } from './feature-gallery.component';
import { HeroComponent } from './hero.component';
import { StatsBandComponent } from './stats-band.component';
import { StyleCardsComponent } from './style-cards.component';

const STEPS: readonly { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'camera',
    title: 'Sube una foto o elige la forma',
    text: 'La foto aporta puertas, ventanas, muebles y colores. Sin foto, eliges la forma y las medidas.',
  },
  {
    icon: 'plan',
    title: 'Confirma el plano',
    text: 'Ves lo que la app entendió, con cotas, y corriges lo que haga falta antes de seguir.',
  },
  {
    icon: 'cube',
    title: 'Amuebla, recorre y comparte',
    text: 'Edita en 3D, camina por el cuarto, pruébalo de noche y comparte un enlace que también se puede recorrer.',
  },
];

/** Qué saca la app de una foto y con cuánta seguridad: lo estimado se dice. */
const READS: readonly { icon: IconName; title: string; text: string; exact: boolean }[] = [
  { icon: 'door', title: 'Puertas y ventanas', text: 'En qué pared están y más o menos en qué tramo.', exact: true },
  { icon: 'sofa', title: 'Muebles que hay', text: 'Sofá, cama, mesa, sillas, estantes: los coloca donde estaban.', exact: true },
  { icon: 'palette', title: 'Colores', text: 'El de las paredes y el tono del piso.', exact: true },
  { icon: 'plan', title: 'Forma del cuarto', text: 'Si es rectangular o tiene un quiebre; puedes cambiarla después.', exact: false },
  { icon: 'ruler', title: 'Medidas', text: 'Una estimación. Escribe las reales o calibra con una sola medida.', exact: false },
];

const COMPARE: readonly { what: string; photo: string; manual: string }[] = [
  { what: 'Qué necesitas', photo: 'Una foto del cuarto', manual: 'La forma y tres medidas' },
  { what: 'Puertas y ventanas', photo: 'Las detecta en su pared', manual: 'Una ventana y una puerta que luego mueves' },
  { what: 'Muebles', photo: 'Parte de los que ya tienes', manual: 'Los propone según el tipo de cuarto y el estilo' },
  { what: 'Medidas', photo: 'Estimadas; se corrigen en el editor', manual: 'Exactas: las que escribes' },
  { what: 'Colores', photo: 'Los de tu pared y tu piso', manual: 'Los eliges tú' },
  { what: 'Cuánto tarda', photo: 'Menos de un minuto', manual: 'Unos segundos' },
];

const FAQ = [
  {
    q: '¿Necesito una foto para empezar?',
    a: 'No. Puedes subir una foto y dejar que la app proponga el cuarto, o elegir la forma (rectangular, en L, en T o en U), escribir las medidas y empezar desde el plano.',
  },
  {
    q: '¿Qué tan exactas son las medidas que salen de una foto?',
    a: 'Son una estimación: la app acierta dónde están puertas y ventanas, qué muebles hay y los colores, pero el tamaño es aproximado. Por eso el editor te muestra el plano y te deja escribir las medidas reales o calibrar con una sola.',
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
    a: 'Sí. Las páginas se adaptan a la pantalla y el 3D se maneja con los dedos: uno mueve el mueble y dos mueven la cámara. Para editar con detalle es más cómodo un computador, donde además tienes los atajos de teclado.',
  },
  {
    q: '¿Puedo enseñárselo a otra persona?',
    a: 'Sí. "Compartir" crea un enlace que se abre sin cuenta: quien lo recibe ve el cuarto en 3D, lo recorre a pie y consulta la lista de muebles, pero no puede cambiar nada. También puedes exportar la imagen, el plano y la lista de compras.',
  },
  {
    q: '¿Y si cierro la pestaña a medias?',
    a: 'El editor guarda solo después de cada cambio. Si se cae la conexión, reintenta al volver y te ofrece recuperar lo que no llegó a guardarse. Además puedes guardar versiones y volver a cualquiera.',
  },
];

/**
 * Página de inicio. Todo lo que muestra es la app real: el plano del encabezado es el mismo
 * componente del asistente, las cifras salen del catálogo y las imágenes son capturas de cuartos
 * creados con ella.
 */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, RevealDirective, HeroComponent, StatsBandComponent, FeatureGalleryComponent, StyleCardsComponent],
  template: `
    <app-hero [start]="start()" [signedIn]="auth.isAuthenticated()" />
    <app-stats-band />

    <section id="como-funciona" class="section" aria-labelledby="how-title">
      <div class="container" appReveal>
        <div class="section-head">
          <p class="eyebrow">Cómo funciona</p>
          <h2 id="how-title">Tres pasos, del cuarto que tienes al que quieres</h2>
        </div>
        <ol class="steps">
          @for (step of steps; track step.title; let i = $index) {
            <li class="card">
              <div class="step-top">
                <span class="icon-tile"><app-icon [name]="step.icon" /></span>
                <span class="n" aria-hidden="true">{{ i + 1 }}</span>
              </div>
              <h3>{{ step.title }}</h3>
              <p class="muted">{{ step.text }}</p>
            </li>
          }
        </ol>
      </div>
    </section>

    <section class="section section-tint" aria-labelledby="reads-title">
      <div class="container reads" appReveal>
        <div class="section-head">
          <p class="eyebrow">De tu foto</p>
          <h2 id="reads-title">Qué reconoce y qué solo estima</h2>
          <p class="muted">
            Una foto no trae cinta métrica. La app te dice qué leyó con seguridad y qué es aproximado, para que corrijas lo segundo en un
            minuto.
          </p>
          <p class="note"><app-icon name="info" /> No identifica marcas ni modelos exactos, ni objetos pequeños sobre los muebles.</p>
        </div>
        <ul class="read-list">
          @for (r of reads; track r.title) {
            <li>
              <span class="icon-tile" [class.accent]="!r.exact"><app-icon [name]="r.icon" /></span>
              <div>
                <h3>
                  {{ r.title }}
                  <span class="badge" [class.badge-success]="r.exact" [class.badge-warning]="!r.exact">{{ r.exact ? 'Fiable' : 'Aproximado' }}</span>
                </h3>
                <p class="muted">{{ r.text }}</p>
              </div>
            </li>
          }
        </ul>
      </div>
    </section>

    <section class="section" aria-labelledby="proof-title">
      <div class="container" appReveal>
        <div class="section-head">
          <p class="eyebrow">Resultados</p>
          <h2 id="proof-title">Seis fotos, seis cuartos distintos</h2>
          <p class="muted">
            Cada uno salió de una foto real: medidas, ventanas en su pared, color de paredes y piso, y los muebles que había en la imagen.
          </p>
        </div>
        <img
          class="shot"
          src="landing/cuartos.jpg"
          width="1600"
          height="830"
          loading="lazy"
          decoding="async"
          alt="Seis cuartos en 3D generados a partir de seis fotos: una sala, un comedor con tres ventanales, una oficina de paredes azules, una cocina, una sala abierta y un dormitorio de paredes color vino."
        />
      </div>
    </section>

    <section id="que-hace" class="section section-tint warm" aria-labelledby="features-title">
      <div class="container" appReveal>
        <div class="section-head">
          <p class="eyebrow">Qué hace</p>
          <h2 id="features-title">Un editor completo, no solo una imagen</h2>
          <p class="muted">Estas son capturas de la app tal como la vas a usar.</p>
        </div>
        <app-feature-gallery />
        <ul class="extras">
          <li>
            <span class="icon-tile"><app-icon name="shuffle" /></span>
            <div>
              <h3>Otra distribución con un clic</h3>
              <p class="muted">Cambia de pared y de piezas, pero nunca tapa una ventana ni bloquea la puerta.</p>
            </div>
          </li>
          <li>
            <span class="icon-tile"><app-icon name="chat" /></span>
            <div>
              <h3>Un asistente que entiende el espacio</h3>
              <p class="muted">Escribe "pon una lámpara junto al sofá". Él elige la pieza y la app calcula dónde cabe.</p>
            </div>
          </li>
          <li>
            <span class="icon-tile"><app-icon name="shield" /></span>
            <div>
              <h3>Revisión del diseño</h3>
              <p class="muted">Avisa si un pasillo queda en menos de 70 cm, si una puerta no abre o si algo tapa una ventana.</p>
            </div>
          </li>
          <li>
            <span class="icon-tile"><app-icon name="cart" /></span>
            <div>
              <h3>Lista de compras</h3>
              <p class="muted">Cada mueble con sus medidas y su precio estimado, y el total del cuarto. También en hoja de cálculo.</p>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <section class="section" aria-labelledby="compare-title">
      <div class="container" appReveal>
        <div class="section-head">
          <p class="eyebrow">Dos formas de empezar</p>
          <h2 id="compare-title">Con foto o sin foto</h2>
          <p class="muted">Las dos terminan en el mismo editor. Elige según lo que tengas a mano.</p>
        </div>
        <div class="table-wrap card">
          <table>
            <thead>
              <tr>
                <td></td>
                <th scope="col"><app-icon name="camera" /> Con foto</th>
                <th scope="col"><app-icon name="ruler" /> Sin foto</th>
              </tr>
            </thead>
            <tbody>
              @for (row of compare; track row.what) {
                <tr>
                  <th scope="row">{{ row.what }}</th>
                  <td data-label="Con foto">{{ row.photo }}</td>
                  <td data-label="Sin foto">{{ row.manual }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section id="estilos" class="section section-tint sand" aria-labelledby="styles-title">
      <div class="container" appReveal>
        <div class="section-head">
          <p class="eyebrow">Estilos</p>
          <h2 id="styles-title">Seis estilos para empezar</h2>
          <p class="muted">El estilo decide qué muebles y qué materiales propone la app. Puedes mezclar hasta cuatro y cambiarlos después.</p>
        </div>
        <app-style-cards [signedIn]="auth.isAuthenticated()" />
      </div>
    </section>

    <section id="preguntas" class="section" aria-labelledby="faq-title">
      <div class="container faq" appReveal>
        <div class="section-head">
          <p class="eyebrow">Preguntas</p>
          <h2 id="faq-title">Preguntas frecuentes</h2>
          <p class="muted">Lo que más se pregunta antes de subir la primera foto.</p>
        </div>
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

    <section class="closing-wrap">
      <div class="container closing" appReveal>
        <h2>Empieza con el cuarto que tienes</h2>
        <p class="lead">Una foto o tres medidas bastan para verlo en 3D.</p>
        <a class="btn btn-primary btn-lg" [routerLink]="start()">Diseñar mi cuarto</a>
        <p class="muted fine">Gratis. Sin instalar nada.</p>
      </div>
    </section>
  `,
  styles: `
    section {
      scroll-margin-top: var(--header-h);
    }
    h2 {
      font-size: var(--text-2xl);
    }
    h3 {
      margin: 0;
    }
    p {
      margin: 0;
    }
    .steps {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-5);
    }
    .steps li {
      display: grid;
      gap: var(--space-2);
      align-content: start;
    }
    .step-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-2);
    }
    .n {
      font-family: var(--font-display);
      font-size: 2.4rem;
      line-height: 1;
      color: var(--accent);
    }
    .reads {
      display: grid;
      grid-template-columns: 1fr 1.2fr;
      gap: var(--space-7);
      align-items: start;
    }
    .reads .section-head {
      margin: 0;
      position: sticky;
      top: calc(var(--header-h) + var(--space-5));
    }
    .note {
      display: flex;
      gap: var(--space-2);
      font-size: var(--text-sm);
      color: var(--text-muted);
      margin-top: var(--space-2);
    }
    .note app-icon {
      margin-top: 0.15em;
    }
    .read-list,
    .extras {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: var(--space-3);
    }
    .read-list li,
    .extras li {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-4);
      align-items: start;
    }
    .read-list li {
      padding: var(--space-4);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface);
    }
    .read-list h3 {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      font-family: var(--font);
      font-size: var(--text-base);
      font-weight: 600;
      letter-spacing: 0;
    }
    .shot {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
      background: var(--surface-2);
      box-shadow: var(--shadow);
    }
    .extras {
      grid-template-columns: repeat(2, 1fr);
      gap: var(--space-5) var(--space-6);
      margin-top: var(--space-6);
    }
    .extras h3 {
      font-family: var(--font);
      font-size: var(--text-base);
      font-weight: 600;
      letter-spacing: 0;
      margin-bottom: 2px;
    }
    .table-wrap {
      padding: 0;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
    }
    th,
    td {
      padding: var(--space-3) var(--space-4);
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--border);
    }
    tbody tr:last-child > * {
      border-bottom: none;
    }
    thead th {
      background: var(--primary-soft);
      color: var(--primary-strong);
      font-weight: 700;
    }
    thead td {
      background: var(--primary-soft);
    }
    tbody th {
      font-weight: 600;
      color: var(--text-muted);
      width: 24%;
    }
    .faq {
      display: grid;
      grid-template-columns: 1fr 1.6fr;
      gap: var(--space-7);
      align-items: start;
    }
    .faq .section-head {
      margin: 0;
    }
    details {
      border-bottom: 1px solid var(--border);
      padding-block: var(--space-4);
    }
    details:first-child {
      padding-top: 0;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      list-style: none;
      display: flex;
      justify-content: space-between;
      gap: var(--space-4);
    }
    summary::-webkit-details-marker {
      display: none;
    }
    summary::after {
      content: '+';
      flex: none;
      font-size: 1.3rem;
      line-height: 1;
      color: var(--primary);
    }
    details[open] summary::after {
      content: '−';
    }
    details p {
      margin-top: var(--space-2);
      max-width: 68ch;
    }
    .closing-wrap {
      background: var(--gradient-brand);
      border-top: 1px solid var(--border);
    }
    .closing {
      display: grid;
      gap: var(--space-3);
      justify-items: center;
      text-align: center;
      padding-block: clamp(var(--space-7), 8vw, 96px);
    }
    .closing h2 {
      margin: 0;
    }
    @media (max-width: 900px) {
      .steps,
      .reads,
      .faq,
      .extras {
        grid-template-columns: 1fr;
      }
      .reads,
      .faq {
        gap: var(--space-5);
      }
      .reads .section-head {
        position: static;
      }
    }
    /* En móvil la comparativa deja de ser una rejilla: cada fila es un bloque con sus dos respuestas. */
    @media (max-width: 640px) {
      thead {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      tr,
      tbody th,
      tbody td {
        display: block;
        width: auto;
      }
      tbody tr {
        padding: var(--space-3) var(--space-4);
        border-bottom: 1px solid var(--border);
      }
      tbody tr:last-child {
        border-bottom: none;
      }
      tbody th,
      tbody td {
        padding: 2px 0;
        border: none;
      }
      tbody th {
        color: var(--text);
      }
      tbody td::before {
        content: attr(data-label) ': ';
        font-weight: 600;
        color: var(--text-muted);
      }
    }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  protected readonly steps = STEPS;
  protected readonly reads = READS;
  protected readonly compare = COMPARE;
  protected readonly faq = FAQ;
  protected readonly start = computed(() => (this.auth.isAuthenticated() ? '/proyectos/nuevo' : '/registro'));
}
