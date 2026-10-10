import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ROOM_SHAPE_IDS, ROOM_TEMPLATES, STYLES, buildRoomFromSpec, type RoomShapeId } from '@interiores/shared-types';
import { AuthService } from '../../core/auth/auth.service';
import { FloorPlanComponent } from '../floor-plan/floor-plan.component';

/** Medidas del cuarto de muestra del plano interactivo, por forma. */
const DEMO_ROOM = { widthM: 5.5, depthM: 4.5, heightM: 2.6 };

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
];

/**
 * Página de inicio. Todo lo que muestra es la app real: el plano del encabezado es el mismo
 * componente del asistente y las imágenes son capturas de cuartos creados con ella.
 */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FloorPlanComponent],
  template: `
    <section class="hero">
      <div class="container hero-grid">
        <div class="hero-copy">
          <p class="eyebrow">Diseño de interiores con IA</p>
          <h1>De una foto de tu cuarto a un 3D que puedes recorrer y cambiar.</h1>
          <p class="lead muted">
            La app reconoce puertas, ventanas, muebles y colores, arma tu cuarto con su forma real y te deja amueblarlo, caminarlo y
            llevarte la lista de compras.
          </p>
          <div class="row cta">
            <a class="btn btn-primary btn-lg" [routerLink]="start()">Diseñar mi cuarto</a>
            @if (!auth.isAuthenticated()) {
              <a class="btn btn-lg" routerLink="/entrar">Ya tengo cuenta</a>
            }
          </div>
          <p class="muted fine">Gratis para probar. Con foto o sin ella.</p>
        </div>

        <figure class="demo card">
          <div class="demo-head">
            <span class="label" id="demo-label">Pruébalo: elige una forma</span>
            <div class="row shapes" role="group" aria-labelledby="demo-label">
              @for (s of shapes; track s.id) {
                <button type="button" class="chip" [attr.aria-pressed]="shape() === s.id" (click)="shape.set(s.id)">{{ s.label }}</button>
              }
            </div>
          </div>
          <app-floor-plan class="plan" [shell]="room()" />
          <figcaption class="muted fine">Este es el plano con el que empieza cada proyecto: paredes a medida, ventana, puerta y cotas.</figcaption>
        </figure>
      </div>
    </section>

    <section class="container steps-band" aria-labelledby="how-title">
      <h2 id="how-title">Cómo funciona</h2>
      <ol class="steps">
        <li>
          <span class="n" aria-hidden="true">1</span>
          <h3>Sube una foto o elige la forma</h3>
          <p class="muted">La foto aporta puertas, ventanas, muebles y colores. Sin foto, eliges la forma y las medidas.</p>
        </li>
        <li>
          <span class="n" aria-hidden="true">2</span>
          <h3>Confirma el plano</h3>
          <p class="muted">Ves lo que la app entendió, con cotas, y corriges lo que haga falta antes de seguir.</p>
        </li>
        <li>
          <span class="n" aria-hidden="true">3</span>
          <h3>Amuebla, recorre y comparte</h3>
          <p class="muted">Edita en 3D, camina por el cuarto, pruébalo de noche y comparte un enlace que también se puede recorrer.</p>
        </li>
      </ol>
    </section>

    <section class="container proof" aria-labelledby="proof-title">
      <div class="section-head">
        <h2 id="proof-title">Seis fotos, seis cuartos distintos</h2>
        <p class="muted">
          Cada uno salió de una foto real: medidas, ventanas en su pared, color de paredes y piso, y los muebles que había en la imagen.
        </p>
      </div>
      <img class="shot wide" src="landing/cuartos.jpg" width="1600" height="830" loading="lazy" alt="Seis cuartos en 3D generados a partir de seis fotos: una sala, un comedor con tres ventanales, una oficina de paredes azules, una cocina, una sala abierta y un dormitorio de paredes color vino." />
    </section>

    <section class="container features" aria-labelledby="features-title">
      <h2 id="features-title" class="visually-hidden">Lo que puedes hacer</h2>
      <article class="feature">
        <img class="shot" src="landing/recorrido.jpg" width="844" height="624" loading="lazy" alt="Vista desde dentro de una sala, a la altura de los ojos, con una butaca, un mueble bajo y la puerta al fondo." />
        <div>
          <h3>Recorre tu cuarto a pie</h3>
          <p class="muted">
            La cámara baja a la altura de tus ojos y caminas con el teclado, sin atravesar paredes ni muebles. Arrastra para mirar o haz
            doble clic para ir a un punto.
          </p>
        </div>
      </article>
      <article class="feature flip">
        <div class="pair">
          <img class="shot" src="landing/dia.jpg" width="844" height="624" loading="lazy" alt="Una sala en forma de L vista desde arriba con luz de día." />
          <img class="shot" src="landing/noche.jpg" width="844" height="624" loading="lazy" alt="La misma sala de noche, iluminada por su lámpara de pie y su lámpara colgante." />
        </div>
        <div>
          <h3>De día y de noche</h3>
          <p class="muted">
            Las lámparas que colocas alumbran de verdad. Cambia a modo noche para ver cómo queda el cuarto solo con su propia luz.
          </p>
        </div>
      </article>
      <article class="feature text-only">
        <div>
          <h3>Otra distribución con un clic</h3>
          <p class="muted">Pide otra forma de acomodar los muebles: cambia de pared y de piezas, pero nunca tapa una ventana ni bloquea la puerta.</p>
        </div>
        <div>
          <h3>Un asistente que entiende el espacio</h3>
          <p class="muted">Escribe "pon una lámpara junto al sofá" o "pinta la pared del fondo de verde". Él elige la pieza y la app calcula dónde cabe.</p>
        </div>
        <div>
          <h3>Muebles a tu medida</h3>
          <p class="muted">Cambia ancho, alto y material de cada pieza y llévate la lista de compras con lo que quedó.</p>
        </div>
      </article>
    </section>

    <section class="container styles" aria-labelledby="styles-title">
      <h2 id="styles-title">Seis estilos para empezar</h2>
      <ul class="style-grid">
        @for (s of styles; track s.id) {
          <li class="style-card">
            <div class="swatches" aria-hidden="true">
              @for (c of s.palette; track c) {
                <span [style.background]="c"></span>
              }
            </div>
            <h3>{{ s.label }}</h3>
            <p class="muted">{{ s.description }}</p>
          </li>
        }
      </ul>
    </section>

    <section class="container faq" aria-labelledby="faq-title">
      <h2 id="faq-title">Preguntas frecuentes</h2>
      <div class="faq-list">
        @for (item of faq; track item.q) {
          <details>
            <summary>{{ item.q }}</summary>
            <p class="muted">{{ item.a }}</p>
          </details>
        }
      </div>
    </section>

    <section class="container closing">
      <h2>Empieza con el cuarto que tienes</h2>
      <p class="muted">Una foto o cuatro medidas bastan para verlo en 3D.</p>
      <a class="btn btn-primary btn-lg" [routerLink]="start()">Diseñar mi cuarto</a>
    </section>
  `,
  styles: `
    h2 {
      font-size: clamp(1.5rem, 2.4vw, 2rem);
      margin: 0;
    }
    h3 {
      font-size: 1.1rem;
      margin: 0;
    }
    section {
      padding-block: var(--space-7);
    }
    .fine {
      font-size: 0.85rem;
      margin: 0;
    }
    .hero {
      padding-block: clamp(var(--space-6), 6vw, 72px) var(--space-6);
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.05fr 1fr;
      gap: var(--space-7);
      align-items: center;
    }
    .hero-copy {
      display: grid;
      gap: var(--space-4);
      justify-items: start;
    }
    .eyebrow {
      margin: 0;
      color: var(--primary);
      font-weight: 600;
      font-size: 0.9rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: clamp(2rem, 4.4vw, 3.2rem);
      line-height: 1.08;
    }
    .lead {
      margin: 0;
      font-size: 1.1rem;
      max-width: 52ch;
    }
    .cta {
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .demo {
      margin: 0;
      display: grid;
      gap: var(--space-3);
    }
    .demo-head {
      display: grid;
      gap: var(--space-2);
    }
    .shapes {
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .plan {
      aspect-ratio: 4 / 3;
      width: 100%;
    }
    .steps {
      list-style: none;
      padding: 0;
      margin: var(--space-5) 0 0;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-5);
    }
    .steps li {
      display: grid;
      gap: var(--space-2);
      align-content: start;
      padding-top: var(--space-4);
      border-top: 2px solid var(--border);
    }
    .steps p,
    .feature p,
    .style-card p,
    .section-head p {
      margin: 0;
    }
    .n {
      font-family: var(--font-display);
      font-size: 1.6rem;
      color: var(--primary);
      line-height: 1;
    }
    .section-head {
      display: grid;
      gap: var(--space-2);
      max-width: 62ch;
      margin-bottom: var(--space-5);
    }
    .shot {
      display: block;
      width: 100%;
      height: auto;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface-2);
    }
    .features {
      display: grid;
      gap: var(--space-7);
    }
    .feature {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: var(--space-6);
      align-items: center;
    }
    .feature > div:not(.pair) {
      display: grid;
      gap: var(--space-2);
    }
    .feature.flip > .pair {
      order: 2;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-3);
    }
    .feature.text-only {
      grid-template-columns: repeat(3, 1fr);
      align-items: start;
      padding-top: var(--space-5);
      border-top: 1px solid var(--border);
    }
    .style-grid {
      list-style: none;
      padding: 0;
      margin: var(--space-5) 0 0;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-5) var(--space-6);
    }
    .style-card {
      display: grid;
      gap: var(--space-2);
      align-content: start;
    }
    .swatches {
      display: flex;
      height: 10px;
      border-radius: 99px;
      overflow: hidden;
      max-width: 160px;
    }
    .swatches span {
      flex: 1;
    }
    .faq-list {
      margin-top: var(--space-4);
      max-width: 760px;
    }
    details {
      border-bottom: 1px solid var(--border);
      padding-block: var(--space-3);
    }
    summary {
      cursor: pointer;
      font-weight: 600;
    }
    details p {
      margin: var(--space-2) 0 0;
    }
    .closing {
      display: grid;
      gap: var(--space-3);
      justify-items: center;
      text-align: center;
      padding-bottom: 72px;
    }
    .closing p {
      margin: 0;
    }
    @media (max-width: 860px) {
      .hero-grid,
      .feature,
      .feature.text-only,
      .steps,
      .style-grid {
        grid-template-columns: 1fr;
      }
      .feature.flip > .pair {
        order: 0;
      }
      section {
        padding-block: var(--space-6);
      }
    }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  protected readonly styles = Object.values(STYLES);
  protected readonly faq = FAQ;
  protected readonly shapes = ROOM_SHAPE_IDS.map((id) => ({ id, label: ROOM_TEMPLATES[id].label }));

  protected readonly shape = signal<RoomShapeId>('L');
  /** El cuarto de muestra con la forma elegida: lo construye el mismo código que crea los proyectos. */
  protected readonly room = computed(() => buildRoomFromSpec({ shape: this.shape(), ...DEMO_ROOM }));
  protected readonly start = computed(() => (this.auth.isAuthenticated() ? '/proyectos/nuevo' : '/registro'));
}
