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

    <section class="intro" aria-labelledby="intro-title">
      <div class="container intro-grid" appReveal>
        <h2 id="intro-title">Vívelo antes de construirlo.</h2>
        <div class="intro-body">
          <p class="intro-lead">
            Un cuarto bien resuelto empieza por sus medidas reales: dónde cae la ventana, cuánto paso queda junto a la cama, qué luz entra por la tarde.
            La app trabaja sobre esas medidas, no sobre una foto bonita.
          </p>
          <dl class="facts">
            <div>
              <dt>6</dt>
              <dd>estilos que deciden muebles, materiales y paleta</dd>
            </div>
            <div>
              <dt>3D</dt>
              <dd>que se recorre a pie, de día, de tarde o de noche</dd>
            </div>
            <div>
              <dt>1:50</dt>
              <dd>la escala de los planos que salen para la obra</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    <section class="pro deep" aria-labelledby="pro-title">
      <div class="container pro-grid" appReveal>
        <figure class="pro-shot">
          <img
            src="landing/editor-plano.webp"
            alt="El editor en vista de plano: la sala con sus cotas, la ventana, la puerta y cada mueble dibujado a escala."
            width="1400"
            height="1120"
            loading="lazy"
            decoding="async"
          />
        </figure>
        <div class="pro-copy">
          <h2 id="pro-title">Planos listos para la obra.</h2>
          <p class="pro-lead">
            Activa el Modo profesional y el mismo cuarto sale con todo lo que pide una obra: el juego de planos con cajetín, la revisión de normativa y
            ergonomía, el presupuesto de obra y los puntos eléctricos e hidráulicos.
          </p>
          <ul class="pro-list">
            <li><strong>Planos técnicos.</strong> Planta, amoblamiento, cielo raso, acabados, alzados y corte, en PDF y DXF para AutoCAD.</li>
            <li><strong>Normativa.</strong> Paso libre, vanos, alturas, luz natural e iluminación con el perfil de Colombia o el de Neufert.</li>
            <li><strong>Presupuesto de obra.</strong> Cantidades, materiales en cajas y galones, AIU y cronograma.</li>
            <li><strong>Instalaciones.</strong> Tomas, interruptores, luces y agua propuestos por la app, con su cuadro de cargas.</li>
          </ul>
          <a class="btn btn-lg pro-go" [routerLink]="['/demo', 'dormitorio-obra']">Abrir el dormitorio listo para obra</a>
        </div>
      </div>
    </section>

    <section id="como-funciona" class="block" aria-labelledby="how-title">
      <div class="container" appReveal>
        <header class="head">
          <h2 id="how-title">Tres pasos hasta tu cuarto.</h2>
          <p class="head-lead">Del cuarto que tienes al que quieres, sin instalar nada y sin saber de diseño.</p>
        </header>
        <ol class="steps">
          @for (step of steps; track step.title) {
            <li>
              <h3>{{ step.title }}</h3>
              <p>{{ step.text }}</p>
            </li>
          }
        </ol>
      </div>
    </section>

    <section class="block tone" aria-labelledby="ba-title">
      <div class="container" appReveal>
        <header class="head">
          <h2 id="ba-title">El mismo cuarto, vacío y resuelto.</h2>
          <p class="head-lead">Arrastra la raya. A la izquierda, las paredes tal como las mides; a la derecha, lo que la app propone para ese espacio.</p>
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

    <section id="editor" class="block" aria-labelledby="features-title">
      <div class="container" appReveal>
        <header class="head">
          <h2 id="features-title">Un cuarto que puedes tocar.</h2>
          <p class="head-lead">No es una imagen: son capturas de la app tal como la vas a usar.</p>
        </header>
        <app-feature-gallery />
        <ul class="extras">
          <li>
            <h3>Otra distribución con un clic</h3>
            <p>Cambia de pared y de piezas, pero nunca tapa una ventana ni bloquea la puerta.</p>
          </li>
          <li>
            <h3>Un asistente que entiende el espacio</h3>
            <p>Escribe "pon una lámpara junto al sofá". Él elige la pieza y la app calcula dónde cabe.</p>
          </li>
          <li>
            <h3>Revisión del diseño</h3>
            <p>Avisa si un pasillo queda en menos de 70 cm, si una puerta no abre o si algo tapa una ventana.</p>
          </li>
          <li>
            <h3>Lista de compras</h3>
            <p>Cada mueble con sus medidas y su precio estimado, y el total del cuarto. También en hoja de cálculo.</p>
          </li>
        </ul>
      </div>
    </section>

    <section id="estilos" class="block tone" aria-labelledby="styles-title">
      <div class="container" appReveal>
        <header class="head">
          <h2 id="styles-title">Seis maneras de vivir la sala.</h2>
          <p class="head-lead">El estilo decide qué muebles y qué materiales propone la app. Puedes mezclar hasta cuatro y cambiarlos después.</p>
        </header>
        <app-style-showcase [signedIn]="auth.isAuthenticated()" />
      </div>
    </section>

    <section id="plantillas" class="block" aria-labelledby="templates-title">
      <div class="container" appReveal>
        <header class="head">
          <h2 id="templates-title">Empieza por uno ya hecho.</h2>
          <p class="head-lead">Cada plantilla abre el editor sin pedir cuenta. Lo que cambies se queda en tu navegador hasta que decidas guardarlo.</p>
        </header>
        <app-template-mosaic />
        <p class="after"><a class="btn btn-lg square" routerLink="/plantillas">Ver todas las plantillas <app-icon name="arrowRight" /></a></p>
      </div>
    </section>

    <section class="block" aria-labelledby="reads-title">
      <div class="container" appReveal>
        <header class="head">
          <h2 id="reads-title">Qué reconoce y qué estima.</h2>
          <p class="head-lead">Una foto no trae cinta métrica. La app te dice qué leyó con seguridad y qué es aproximado, para que corrijas lo segundo en un minuto.</p>
        </header>
        <div class="reads">
          <ul class="read-list">
            @for (r of reads; track r.title) {
              <li>
                <h3>{{ r.title }}</h3>
                <p>{{ r.text }}</p>
                <span class="level" [class.approx]="!r.exact">{{ r.exact ? 'Fiable' : 'Aproximado' }}</span>
              </li>
            }
          </ul>
          <p class="note">No identifica marcas ni modelos exactos, ni los objetos pequeños que haya sobre los muebles.</p>
        </div>
        <app-stats-band class="stats" />
      </div>
    </section>

    <section id="preguntas" class="block tone" aria-labelledby="faq-title">
      <div class="container" appReveal>
        <header class="head">
          <h2 id="faq-title">Antes de empezar.</h2>
          <p class="head-lead">Lo que más se pregunta sobre fotos, medidas, privacidad y precio.</p>
        </header>
        <div class="faq-list">
          @for (item of faq; track item.q) {
            <details>
              <summary>{{ item.q }}</summary>
              <p>{{ item.a }}</p>
            </details>
          }
        </div>
      </div>
    </section>

    <section class="closing deep" aria-labelledby="closing-title">
      <div class="container closing-grid" appReveal>
        <div>
          <h2 id="closing-title">Empieza con el cuarto que tienes.</h2>
          <p class="closing-lead">Una foto o tres medidas bastan para verlo en 3D. Gratis y sin instalar nada.</p>
          <div class="closing-cta">
            <a class="btn btn-lg light" [routerLink]="start()">Diseñar mi cuarto</a>
            <a class="btn btn-lg outline" [routerLink]="['/demo', template]">Probar sin cuenta <app-icon name="arrowRight" /></a>
          </div>
        </div>
        <img
          src="landing/cuarto-noche-800.webp"
          srcset="landing/cuarto-noche-800.webp 800w, landing/cuarto-noche-1600.webp 1600w"
          sizes="(max-width: 900px) 100vw, 560px"
          alt="La sala de noche, alumbrada solo por su lámpara colgante."
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

    /* Dos columnas: la tesis grande a la izquierda, el porqué y tres datos a la derecha. */
    .intro {
      padding-block: clamp(96px, 11vw, 200px);
    }
    .intro-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--space-7) clamp(48px, 7vw, 120px);
      align-items: start;
    }
    .intro h2 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 500;
      font-size: clamp(2.2rem, 4.2vw, 4rem);
      line-height: 1.02;
      letter-spacing: -0.03em;
    }
    .intro-body {
      display: grid;
      gap: var(--space-7);
    }
    .intro-lead {
      font-size: clamp(1.1rem, 0.5vw + 1rem, 1.35rem);
      line-height: 1.5;
      max-width: 46ch;
      color: var(--text);
    }
    .facts {
      margin: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-5);
    }
    .facts div {
      display: grid;
      gap: var(--space-2);
      align-content: start;
    }
    .facts dt {
      font-family: var(--font-display);
      font-size: clamp(2.2rem, 3.4vw, 3.2rem);
      line-height: 1;
      letter-spacing: -0.02em;
      color: var(--primary);
    }
    .facts dd {
      margin: 0;
      font-size: var(--text-base);
      line-height: 1.45;
      color: var(--text);
    }

    /* Bloque oscuro: la captura del plano a la izquierda, lo que trae el Modo Pro a la derecha. */
    .pro {
      padding-block: clamp(96px, 10vw, 180px);
    }
    .pro-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      gap: var(--space-7) clamp(40px, 6vw, 96px);
      align-items: center;
    }
    .pro-shot {
      margin: 0;
      overflow: hidden;
    }
    .pro-shot img {
      display: block;
      width: 100%;
      height: auto;
      transition: transform 1.2s var(--ease);
    }
    .pro-shot:hover img {
      transform: scale(1.03);
    }
    .pro-copy {
      display: grid;
      gap: var(--space-5);
      justify-items: start;
    }
    .pro h2 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 500;
      font-size: clamp(2.1rem, 3.8vw, 3.6rem);
      line-height: 1.02;
      letter-spacing: -0.03em;
      color: var(--on-deep);
    }
    .pro-lead {
      font-size: clamp(1.05rem, 0.4vw + 1rem, 1.25rem);
      line-height: 1.5;
      color: var(--on-deep);
      max-width: 48ch;
    }
    .pro-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-3);
      max-width: 52ch;
    }
    .pro-list li {
      line-height: 1.5;
      color: var(--on-deep);
    }
    .pro-list strong {
      font-weight: 600;
    }
    .pro-go {
      background: var(--on-deep);
      color: var(--deep);
      border-color: var(--on-deep);
      border-radius: 0;
    }
    .pro-go:hover {
      background: #ffffff;
    }
    @media (max-width: 900px) {
      .intro-grid,
      .pro-grid {
        grid-template-columns: 1fr;
      }
      .facts {
        grid-template-columns: 1fr;
      }
      .facts div {
        grid-template-columns: 5.5rem 1fr;
        align-items: baseline;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .pro-shot img {
        transition: none;
      }
    }
    h3 {
      margin: 0;
      font-size: var(--text-lg);
      font-weight: 600;
    }
    p {
      margin: 0;
    }

    /* Secciones antiguas: título grande a la izquierda, entrada a la derecha; las superficies se separan por tono. */
    .block {
      padding-block: clamp(80px, 9vw, 160px);
    }
    .block.tone {
      background: var(--surface-2);
    }
    .head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--space-4) clamp(40px, 6vw, 96px);
      align-items: end;
      margin-bottom: clamp(40px, 5vw, 72px);
    }
    .head h2 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 500;
      font-size: clamp(2.1rem, 3.8vw, 3.6rem);
      line-height: 1.02;
      letter-spacing: -0.03em;
    }
    .head-lead {
      font-size: clamp(1.05rem, 0.4vw + 1rem, 1.25rem);
      line-height: 1.5;
      max-width: 52ch;
      color: var(--text);
    }

    /* Tres pasos como bloques de tono, sin números ni filetes. */
    .steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-4);
    }
    .steps li {
      display: grid;
      gap: var(--space-3);
      align-content: start;
      padding: clamp(24px, 3vw, 40px);
      background: var(--surface-2);
    }
    .steps h3 {
      font-family: var(--font-display);
      font-weight: 500;
      font-size: var(--text-xl);
    }
    .steps p,
    .extras p,
    .read-list p,
    details p {
      line-height: 1.55;
      max-width: 60ch;
      color: var(--text);
    }

    .extras {
      list-style: none;
      margin: clamp(var(--space-6), 5vw, 72px) 0 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--space-6);
    }
    .extras li {
      display: grid;
      gap: var(--space-2);
      align-content: start;
    }

    .after {
      margin-top: var(--space-6);
    }
    .btn.square {
      border-radius: 0;
      background: var(--text);
      border-color: var(--text);
      color: var(--bg);
    }
    .btn.square:hover {
      background: var(--primary);
      border-color: var(--primary);
    }

    /* Lo que lee de la foto: filas alternas por tono y, a la derecha de cada una, su fiabilidad. */
    .read-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .read-list li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) auto;
      gap: var(--space-3) var(--space-6);
      align-items: baseline;
      padding: var(--space-4) var(--space-5);
    }
    .read-list li:nth-child(odd) {
      background: var(--surface-2);
    }
    .level {
      font-size: var(--text-base);
      font-weight: 600;
      color: var(--primary);
    }
    .level.approx {
      /* Mezclado con la tinta para pasar 4,5:1 también sobre las filas de tono. */
      color: color-mix(in srgb, var(--accent) 80%, var(--text));
    }
    .note {
      margin-top: var(--space-4);
      color: var(--text);
    }
    .stats {
      display: block;
      margin-top: clamp(var(--space-6), 5vw, 72px);
    }

    /* Preguntas como bloques sobre el fondo de la sección, sin filetes. */
    .faq-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
      align-items: start;
    }
    details {
      background: var(--bg);
    }
    summary {
      display: flex;
      justify-content: space-between;
      gap: var(--space-4);
      padding: var(--space-4) var(--space-5);
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
      padding: 0 var(--space-5) var(--space-5);
    }

    /* Cierre: la foto de noche y la última invitación sobre el fondo profundo. */
    .closing {
      padding-block: clamp(96px, 10vw, 180px);
    }
    .closing-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      gap: var(--space-6) clamp(40px, 6vw, 96px);
      align-items: center;
    }
    .closing h2 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 500;
      font-size: clamp(2.1rem, 3.8vw, 3.6rem);
      line-height: 1.02;
      letter-spacing: -0.03em;
      color: var(--on-deep);
    }
    .closing-lead {
      margin-top: var(--space-4);
      font-size: clamp(1.05rem, 0.4vw + 1rem, 1.25rem);
      line-height: 1.5;
      max-width: 44ch;
      color: var(--on-deep);
    }
    .closing-cta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      align-items: center;
      margin-top: var(--space-6);
    }
    .closing .btn {
      border-radius: 0;
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
    .btn.outline {
      background: transparent;
      border: 2px solid var(--on-deep);
      color: var(--on-deep);
    }
    .btn.outline:hover {
      background: var(--on-deep);
      color: var(--deep);
    }
    .closing img {
      display: block;
      width: 100%;
      height: auto;
      aspect-ratio: 16 / 10;
      object-fit: cover;
    }

    @media (max-width: 900px) {
      .head,
      .steps,
      .closing-grid,
      .faq-list {
        grid-template-columns: 1fr;
      }
      .extras {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .read-list li {
        grid-template-columns: minmax(0, 1fr) auto;
        padding-inline: var(--space-4);
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
