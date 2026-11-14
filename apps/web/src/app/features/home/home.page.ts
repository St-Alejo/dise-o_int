import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { RevealDirective } from '../../shared/ui/reveal.directive';
import { BeforeAfterComponent } from './before-after.component';
import { CoverComponent, HERO_TEMPLATE } from './cover.component';
import { FeatureGalleryComponent } from './feature-gallery.component';
import { HowComponent } from './how.component';
import { StatsBandComponent } from './stats-band.component';
import { VitrinaComponent } from './vitrina.component';

/** Qué saca la app de una foto y con cuánta seguridad: lo estimado se dice. */
const READS: readonly { title: string; text: string; exact: boolean }[] = [
  { title: 'Puertas y ventanas', text: 'en qué pared están y más o menos en qué tramo.', exact: true },
  { title: 'Los muebles que hay', text: 'sofá, cama, mesa, sillas, estantes: los coloca donde estaban.', exact: true },
  { title: 'Colores', text: 'el de las paredes y el tono del piso.', exact: true },
  { title: 'La forma del cuarto', text: 'si es rectangular o tiene un quiebre. Puedes cambiarla después.', exact: false },
  { title: 'Las medidas', text: 'una estimación. Escribe las reales o calibra con una sola.', exact: false },
];

/** La carta de lo que trae la app: el nombre a la izquierda, lo que vale a la derecha. */
const MENU: readonly { group: string; items: readonly { name: string; value: string; text: string }[] }[] = [
  {
    group: 'En el editor',
    items: [
      { name: 'Otra distribución', value: 'un clic', text: 'Cambia de pared y de piezas, pero nunca tapa una ventana ni bloquea la puerta.' },
      { name: 'Asistente', value: 'en español', text: 'Escribe "pon una lámpara junto al sofá": elige la pieza y calcula dónde cabe.' },
      { name: 'Revisión del diseño', value: '70 cm de paso', text: 'Avisa si un pasillo se estrecha, si una puerta no abre o si algo tapa la luz.' },
      { name: 'Lista de compras', value: 'CSV', text: 'Cada mueble con sus medidas y su precio estimado, y el total del cuarto.' },
    ],
  },
  {
    group: 'Modo Pro, para la obra',
    items: [
      { name: 'Planos técnicos', value: 'PDF y DXF', text: 'Planta, amoblamiento, cielo raso, acabados, alzados y corte, con cajetín.' },
      { name: 'Normativa', value: 'Colombia o Neufert', text: 'Paso libre, vanos, alturas, luz natural e iluminación.' },
      { name: 'Presupuesto de obra', value: 'AIU y cronograma', text: 'Cantidades, materiales en cajas y galones, y el tiempo de cada tarea.' },
      { name: 'Instalaciones', value: 'cuadro de cargas', text: 'Tomas, interruptores, luces y agua propuestos por la app.' },
    ],
  },
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
    a: '"Compartir" crea un enlace que se abre sin cuenta: quien lo recibe ve el cuarto en 3D, lo recorre a pie y consulta la lista de muebles, pero no puede cambiar nada. También puedes exportar la imagen, el plano y la lista de compras.',
  },
];

/**
 * Página de inicio, armada como una revista de interiorismo: abre con la misma sala en seis estilos
 * (escenario partido), y sigue con una idea por sección, cada una con su propia composición. Todo lo
 * que enseña es la app real: renders y capturas suyas, cifras del catálogo y plantillas que se abren
 * sin cuenta.
 */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, RevealDirective, CoverComponent, HowComponent, BeforeAfterComponent, FeatureGalleryComponent, VitrinaComponent, StatsBandComponent],
  template: `
    <app-cover [start]="start()" [signedIn]="auth.isAuthenticated()" />

    <section id="como-funciona" class="how-sec" aria-labelledby="how-title">
      <app-how />
    </section>

    <section class="ba" aria-labelledby="ba-title">
      <div class="container ba-head" appReveal>
        <h2 id="ba-title">El mismo cuarto, vacío <em>y resuelto.</em></h2>
        <p>Arrastra la raya. A un lado, las paredes tal como las mides; al otro, lo que la app propone para ese espacio.</p>
      </div>
      <div class="ba-frame">
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

    <section id="editor" class="editor-sec" aria-labelledby="features-title">
      <div class="container" appReveal>
        <div class="editor-head">
          <h2 id="features-title">Un cuarto que puedes tocar.</h2>
          <p>No es una imagen: son capturas de la app tal como la vas a usar, del plano al recorrido a pie.</p>
        </div>
        <app-feature-gallery />
      </div>
    </section>

    <section class="carta" aria-labelledby="pro-title">
      <div class="container carta-grid">
        <div class="sheet" appReveal>
          <h2 id="pro-title">Lo que trae <em>la casa.</em></h2>
          @for (g of menu; track g.group) {
            <h3 class="group">{{ g.group }}</h3>
            <dl>
              @for (item of g.items; track item.name) {
                <div class="dish">
                  <dt>{{ item.name }}</dt>
                  <dd class="value">{{ item.value }}</dd>
                  <dd class="what">{{ item.text }}</dd>
                </div>
              }
            </dl>
          }
        </div>
        <div class="carta-side" appReveal>
          <p class="carta-lead">Activa el Modo Pro y el mismo cuarto sale con todo lo que pide una obra.</p>
          <img
            src="landing/editor-plano.webp"
            alt="El editor en vista de plano: la sala con sus cotas, la ventana, la puerta y cada mueble dibujado a escala."
            width="1400"
            height="1120"
            loading="lazy"
            decoding="async"
          />
          <a class="btn btn-lg light" [routerLink]="['/demo', 'dormitorio-obra']">Abrir el dormitorio listo para obra</a>
        </div>
      </div>
    </section>

    <section id="plantillas" class="vitrina-sec" aria-labelledby="templates-title">
      <app-vitrina appReveal />
    </section>

    <section class="figures" aria-labelledby="reads-title">
      <div class="container figures-grid" appReveal>
        <div>
          <h2 id="reads-title">Qué reconoce y qué estima.</h2>
          <p class="figures-sub">Una foto no trae cinta métrica: la app dice qué leyó con seguridad y qué es aproximado, para que corrijas lo segundo en un minuto.</p>
          <dl class="reads">
            @for (r of reads; track r.title) {
              <div>
                <dt [class.approx]="!r.exact">{{ r.exact ? 'Fiable' : 'Aproximado' }}</dt>
                <dd><strong>{{ r.title }}:</strong> {{ r.text }}</dd>
              </div>
            }
          </dl>
          <p class="note">No identifica marcas ni modelos exactos, ni los objetos pequeños que haya sobre los muebles.</p>
          <app-stats-band class="stats" />
        </div>
        <img
          class="figures-photo"
          src="landing/cuarto-dentro-800.webp"
          srcset="landing/cuarto-dentro-800.webp 800w, landing/cuarto-dentro-1600.webp 1600w"
          sizes="(max-width: 860px) 60vw, 30vw"
          alt="La sala vista desde dentro, a la altura de los ojos, con el sofá bajo la ventana."
          width="1600"
          height="1000"
          loading="lazy"
          decoding="async"
        />
      </div>
    </section>

    <section id="preguntas" class="faq" aria-labelledby="faq-title">
      <div class="container faq-grid" appReveal>
        <h2 id="faq-title">Antes de empezar.</h2>
        <div class="faq-text">
          @for (item of faq; track item.q) {
            <p><strong>{{ item.q }}</strong> {{ item.a }}</p>
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
        <h2 id="closing-title">Empieza con el cuarto <em>que tienes.</em></h2>
        <p>Una foto o tres medidas bastan para verlo en 3D. Gratis y sin instalar nada.</p>
        <div class="closing-cta">
          <a class="btn btn-lg light" [routerLink]="start()">Diseñar mi cuarto</a>
          <a class="btn btn-lg outline" [routerLink]="['/demo', template]">Probar sin cuenta <app-icon name="arrowRight" /></a>
        </div>
      </div>
    </section>
  `,
  styles: `
    section {
      scroll-margin-top: var(--header-h);
    }
    h2 em {
      color: var(--primary);
    }

    /* Antes y después a lo ancho: rompe el escenario partido. */
    .ba {
      padding-block: var(--section-y) 0;
    }
    .ba-head {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(0, 4fr);
      gap: var(--space-5) var(--space-7);
      align-items: end;
      margin-bottom: var(--space-7);
    }
    .ba-head h2 {
      margin: 0;
      font-size: var(--text-3xl);
    }
    .ba-head p {
      margin: 0;
    }
    .ba-frame {
      padding-inline: 12px;
    }
    .ba-frame app-before-after {
      display: block;
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    .editor-sec {
      padding-block: var(--section-y);
    }
    .editor-head {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(0, 4fr);
      gap: var(--space-5) var(--space-7);
      align-items: end;
      margin-bottom: var(--space-6);
    }
    .editor-head h2 {
      margin: 0;
      font-size: var(--text-2xl);
    }
    .editor-head p {
      margin: 0;
    }

    /* La carta: una hoja de lino con los bordes recortados sobre el nogal. */
    .carta {
      background: var(--deep);
      color: var(--on-deep);
      padding-block: var(--section-y);
    }
    .carta-grid {
      display: grid;
      grid-template-columns: minmax(0, 560px) minmax(0, 1fr);
      gap: clamp(32px, 6vw, 96px);
      align-items: center;
    }
    .sheet {
      --cut: 10px;
      background: var(--surface);
      color: var(--text);
      padding: 56px clamp(24px, 4vw, 48px);
      clip-path: polygon(
        0 var(--cut), 5% 0, 10% var(--cut), 15% 0, 20% var(--cut), 25% 0, 30% var(--cut), 35% 0, 40% var(--cut), 45% 0, 50% var(--cut), 55% 0, 60% var(--cut), 65% 0, 70% var(--cut), 75% 0, 80% var(--cut), 85% 0, 90% var(--cut), 95% 0, 100% var(--cut),
        100% calc(100% - var(--cut)), 95% 100%, 90% calc(100% - var(--cut)), 85% 100%, 80% calc(100% - var(--cut)), 75% 100%, 70% calc(100% - var(--cut)), 65% 100%, 60% calc(100% - var(--cut)), 55% 100%, 50% calc(100% - var(--cut)), 45% 100%, 40% calc(100% - var(--cut)), 35% 100%, 30% calc(100% - var(--cut)), 25% 100%, 20% calc(100% - var(--cut)), 15% 100%, 10% calc(100% - var(--cut)), 5% 100%, 0 calc(100% - var(--cut))
      );
    }
    .sheet h2 {
      text-align: center;
      font-size: var(--text-2xl);
      margin: 0 0 40px;
    }
    .group {
      margin: 0 0 var(--space-4);
      font-size: var(--text-lg);
    }
    .sheet dl {
      margin: 0 0 44px;
      display: grid;
      gap: 18px;
    }
    .sheet dl:last-child {
      margin-bottom: 0;
    }
    .dish {
      display: grid;
      grid-template-columns: auto minmax(24px, 1fr) auto;
      align-items: baseline;
      column-gap: 8px;
    }
    .dish dt {
      font-weight: 600;
    }
    /* Línea de puntos entre el nombre y lo que vale, como en una carta. */
    .dish::before {
      content: '';
      grid-column: 2;
      grid-row: 1;
      border-bottom: 3px dotted var(--border);
      transform: translateY(-4px);
    }
    .dish dt {
      grid-column: 1;
      grid-row: 1;
    }
    .value {
      grid-column: 3;
      grid-row: 1;
      margin: 0;
      font-variant-numeric: tabular-nums;
      color: var(--primary);
      font-weight: 600;
    }
    .what {
      grid-column: 1 / -1;
      margin: 4px 0 0;
      max-width: 40ch;
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .carta-side {
      display: grid;
      gap: var(--space-5);
      justify-items: start;
    }
    .carta-lead {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-xl);
      line-height: 1.2;
      max-width: 26ch;
    }
    .carta-side img {
      width: 100%;
      height: auto;
      border-radius: var(--radius);
    }
    .btn.light {
      --btn-bg: var(--on-deep);
      --btn-fg: var(--deep);
      --btn-border: var(--on-deep);
    }
    .btn.light:hover {
      background: #ffffff;
      border-color: #ffffff;
    }

    .vitrina-sec {
      padding-block: var(--section-y);
      background: var(--tint-1);
    }

    /* Cifras en voz baja: la cifra a la derecha de su canal, la frase a la izquierda del suyo. */
    .figures {
      padding-block: var(--section-y);
    }
    .figures-grid {
      display: grid;
      grid-template-columns: minmax(0, 7fr) minmax(0, 4fr);
      gap: clamp(32px, 6vw, 96px);
      align-items: start;
    }
    .figures h2 {
      font-size: var(--text-2xl);
      margin: 0 0 var(--space-4);
    }
    .figures-sub {
      margin: 0 0 56px;
      max-width: 48ch;
    }
    .reads {
      margin: 0;
      display: grid;
      gap: 20px;
    }
    .reads div {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr);
      gap: 24px;
      align-items: baseline;
    }
    .reads dt {
      text-align: right;
      font-family: var(--font-display);
      font-size: var(--text-xl);
      color: var(--primary);
    }
    .reads dt.approx {
      color: var(--accent);
    }
    .reads dd {
      margin: 0;
      max-width: 44ch;
    }
    .note {
      margin: var(--space-5) 0 72px 156px;
      color: var(--text-muted);
      font-size: var(--text-sm);
      max-width: 44ch;
    }
    .figures-photo {
      width: 100%;
      aspect-ratio: 1;
      height: auto;
      object-fit: cover;
      border-radius: var(--radius-lg);
      margin-top: 80px;
    }

    /* Preguntas como texto corrido, en dos columnas: todo respondido de un vistazo. */
    .faq {
      padding-block: var(--section-y);
      background: var(--tint-2);
    }
    .faq-grid {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 8fr);
      gap: var(--space-6) clamp(32px, 5vw, 80px);
    }
    .faq h2 {
      margin: 0;
      font-size: var(--text-2xl);
    }
    .faq-text {
      columns: 2;
      column-gap: 56px;
    }
    .faq-text p {
      margin: 0 0 20px;
      break-inside: avoid;
      line-height: 1.55;
    }
    .faq-text strong {
      font-weight: 650;
    }

    /* Cierre: la sala de noche a sangre y el texto en la mitad tranquila. */
    .closing {
      position: relative;
      min-height: 90svh;
      display: grid;
      align-items: end;
      color: var(--on-deep);
      background: var(--deep);
      overflow: hidden;
    }
    .closing img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: brightness(0.62);
    }
    .closing-copy {
      position: relative;
      justify-self: end;
      width: min(560px, 100% - 32px);
      margin: 0 max(16px, calc((100vw - 1200px) / 2)) clamp(48px, 9vh, 96px) 16px;
      display: grid;
      gap: var(--space-4);
    }
    .closing h2 {
      margin: 0;
      font-size: var(--text-3xl);
      color: var(--on-deep);
    }
    .closing h2 em {
      color: var(--highlight);
    }
    .closing p {
      margin: 0;
      font-size: var(--text-lg);
    }
    .closing-cta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .btn.outline {
      --btn-bg: transparent;
      --btn-fg: var(--on-deep);
      --btn-border: var(--on-deep);
    }
    .btn.outline:hover {
      background: rgb(255 255 255 / 12%);
      border-color: var(--on-deep);
    }

    @media (max-width: 860px) {
      .ba-head,
      .editor-head,
      .carta-grid,
      .figures-grid,
      .faq-grid {
        grid-template-columns: 1fr;
      }
      .faq-text {
        columns: 1;
      }
      .reads div {
        grid-template-columns: 96px minmax(0, 1fr);
        gap: 16px;
      }
      .reads dt {
        font-size: var(--text-lg);
      }
      .note {
        margin-left: 112px;
      }
      .figures-photo {
        width: 60%;
        justify-self: end;
        margin-top: 0;
      }
      .sheet {
        padding: 40px 20px;
      }
      .closing {
        min-height: 0;
        display: block;
      }
      .closing img {
        position: relative;
        height: 70svh;
        filter: none;
      }
      .closing-copy {
        width: auto;
        margin: 0;
        padding: 40px 16px 48px;
      }
      .closing-cta .btn {
        flex: 1 1 100%;
      }
    }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  protected readonly reads = READS;
  protected readonly menu = MENU;
  protected readonly faq = FAQ;
  protected readonly template = HERO_TEMPLATE;
  protected readonly start = computed(() => (this.auth.isAuthenticated() ? '/proyectos/nuevo' : '/registro'));
}
