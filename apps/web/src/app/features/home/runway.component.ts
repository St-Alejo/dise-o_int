import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { loadMotion, reducedMotion, stepAt } from './motion';

export interface Station {
  id: string;
  name: string;
  value: string;
  text: string;
  /** Captura de la app (public/landing) o, si no hay, una placa dibujada. */
  shot?: string;
  /** Cota que se dibuja junto a la pieza, como en un plano. */
  dim: string;
}

/** Lo que hace el editor, en el orden en que lo usarías: cada cosa es una pieza tendida en el plano. */
export const STATIONS: readonly Station[] = [
  { id: 'plano', name: 'Plano a escala', value: 'al centímetro', text: 'Paredes, puerta y ventana con sus cotas. Escribe una medida real y todo se ajusta.', shot: 'landing/editor-plano.webp', dim: '5,00 m' },
  { id: 'editar', name: 'Otra distribución', value: 'un clic', text: 'Cambia de pared y de piezas, pero nunca tapa una ventana ni bloquea la puerta.', shot: 'landing/editor-editar.webp', dim: '4,20 m' },
  { id: 'pintar', name: 'Paredes y piso', value: 'colores reales', text: 'Pinta, cambia el piso y el material de cada mueble; el 3D lo muestra al instante.', shot: 'landing/editor-pintar.webp', dim: '2,60 m' },
  { id: 'recorrer', name: 'Recorrido a pie', value: 'a 1,60 m', text: 'Entra al cuarto a la altura de tus ojos y camina entre los muebles.', shot: 'landing/editor-recorrer.webp', dim: '0,90 m' },
  { id: 'noche', name: 'Día, tarde y noche', value: 'tres luces', text: 'La misma sala con el sol de la mañana, la tarde dorada o las lámparas encendidas.', shot: 'landing/editor-noche.webp', dim: '1,20 m' },
  { id: 'revision', name: 'Revisión del diseño', value: '70 cm de paso', text: 'Avisa si un pasillo se estrecha, si una puerta no abre o si algo tapa la luz.', dim: '0,70 m' },
  { id: 'asistente', name: 'Asistente', value: 'en español', text: 'Escribe «pon una lámpara junto al sofá»: elige la pieza y calcula dónde cabe.', dim: '2,10 m' },
  { id: 'pro', name: 'Planos de obra', value: 'PDF y DXF', text: 'Planta, amoblamiento, cielo raso, acabados, alzados y corte, con cajetín.', dim: '3,40 m' },
  { id: 'presupuesto', name: 'Presupuesto', value: 'AIU y cronograma', text: 'Cantidades, materiales en cajas y galones, y el tiempo de cada tarea.', dim: '1,80 m' },
];

const GAP = 960;

/**
 * «El plano es la pista»: el plano de la sala tendido en perspectiva, y la cámara avanza sobre él con
 * el scroll. Cada herramienta del editor está apoyada en el plano como un mueble, con su cota; la que
 * pasa bajo la cámara se lee derecha a un lado.
 */
@Component({
  selector: 'app-runway',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section #root class="runway" [class.still]="still()" [style.--n]="stations.length" aria-labelledby="runway-title">
      <div class="pin">
        <header class="head">
          <p class="kicker">02 · El editor</p>
          <h2 id="runway-title" class="big"><span>El plano</span> <span>es la pista</span></h2>
        </header>

        <div class="scene" aria-hidden="true">
          <div #floor class="floor" [style.height.px]="floorLength">
            <img class="plan" src="landing/plano-sala.svg" alt="" width="740" height="670" />
            @for (s of stations; track s.id; let i = $index) {
              <div class="piece" [class.on]="active() === i" [style.bottom.px]="760 + i * gap">
                @if (s.shot) {
                  <img [src]="s.shot" alt="" width="1400" height="1120" loading="lazy" decoding="async" />
                } @else {
                  <div class="plaque">
                    <span class="plaque-n">{{ i + 1 < 10 ? '0' + (i + 1) : i + 1 }}</span>
                    <span class="plaque-v">{{ s.value }}</span>
                  </div>
                }
                <span class="dim dim-w">{{ s.dim }}</span>
                <span class="tag">{{ i + 1 < 10 ? '0' + (i + 1) : i + 1 }} · {{ s.name }}</span>
              </div>
            }
          </div>
          <div class="fog"></div>
        </div>

        <ol class="rail">
          @for (s of stations; track s.id; let i = $index) {
            <li [class.on]="active() === i">{{ s.name }}</li>
          }
        </ol>

        <div class="captions">
          @for (s of stations; track s.id; let i = $index) {
            <article class="caption" [class.on]="active() === i" [attr.aria-hidden]="active() === i ? null : 'true'">
              <p class="c-n">{{ i + 1 < 10 ? '0' + (i + 1) : i + 1 }} / {{ stations.length }}</p>
              <h3>{{ s.name }}</h3>
              <p class="c-v">{{ s.value }}</p>
              <p class="c-t">{{ s.text }}</p>
            </article>
          }
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
    }
    .runway {
      position: relative;
      height: calc((var(--n) * 62 + 100) * 1svh);
      background: var(--night);
      color: var(--ink);
    }
    .pin {
      position: sticky;
      top: 0;
      height: 100svh;
      overflow: hidden;
    }
    .head {
      position: absolute;
      z-index: 3;
      top: calc(var(--header-h) + 24px);
      left: clamp(16px, 4vw, 56px);
    }
    .kicker {
      margin: 0 0 12px;
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
      line-height: 0.86;
      text-transform: uppercase;
      letter-spacing: -0.01em;
      color: var(--ink);
    }
    .big span {
      display: block;
    }

    /* La pista: el plano tendido, que se acerca con el scroll. */
    .scene {
      position: absolute;
      inset: 0;
      perspective: 1100px;
      perspective-origin: 50% 18%;
    }
    .floor {
      position: absolute;
      left: 44%;
      bottom: -6svh;
      width: 1180px;
      margin-left: -590px;
      transform-origin: 50% 100%;
      transform: rotateX(64deg) translate3d(0, var(--y, 0px), 0);
      background-color: #14120f;
      background-image:
        linear-gradient(rgb(201 164 106 / 16%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(201 164 106 / 16%) 1px, transparent 1px),
        linear-gradient(rgb(243 238 230 / 5%) 1px, transparent 1px),
        linear-gradient(90deg, rgb(243 238 230 / 5%) 1px, transparent 1px);
      background-size: 240px 240px, 240px 240px, 48px 48px, 48px 48px;
      border-inline: 1px solid rgb(201 164 106 / 45%);
      will-change: transform;
    }
    .plan {
      position: absolute;
      left: 50%;
      bottom: 40px;
      width: 760px;
      height: auto;
      margin-left: -380px;
      opacity: 0.9;
    }
    .piece {
      position: absolute;
      left: 50%;
      width: 720px;
      margin-left: -360px;
      aspect-ratio: 5 / 4;
      outline: 1px solid rgb(201 164 106 / 55%);
      outline-offset: 14px;
      transition: outline-color 0.4s var(--ease);
    }
    .piece:nth-child(odd of .piece) {
      margin-left: -420px;
    }
    .piece:nth-child(even of .piece) {
      margin-left: -300px;
    }
    .piece img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      box-shadow: 0 40px 80px rgb(0 0 0 / 60%);
    }
    .piece.on {
      outline-color: var(--brass);
    }
    .plaque {
      width: 100%;
      height: 100%;
      display: grid;
      place-content: center;
      text-align: center;
      background:
        repeating-linear-gradient(45deg, transparent 0 14px, rgb(201 164 106 / 12%) 14px 15px),
        #1b1814;
      border: 2px solid var(--brass);
    }
    .plaque-n {
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 200;
      font-size: 220px;
      line-height: 0.8;
      color: var(--brass);
    }
    .plaque-v {
      margin-top: 18px;
      font-family: var(--font-display);
      font-stretch: 75%;
      font-size: 54px;
      text-transform: uppercase;
      color: var(--ink);
    }
    .dim {
      position: absolute;
      color: var(--brass);
      font-size: 26px;
      font-variant-numeric: tabular-nums;
    }
    .dim-w {
      left: 0;
      right: 0;
      top: -64px;
      text-align: center;
      border-bottom: 2px solid var(--brass);
      padding-bottom: 6px;
    }
    .dim-w::before,
    .dim-w::after {
      content: '';
      position: absolute;
      bottom: -10px;
      width: 2px;
      height: 18px;
      background: var(--brass);
    }
    .dim-w::before {
      left: 0;
    }
    .dim-w::after {
      right: 0;
    }
    .tag {
      position: absolute;
      left: 0;
      bottom: -58px;
      font-family: var(--font-display);
      font-stretch: 70%;
      font-size: 30px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--ink);
    }
    .fog {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(var(--night) 0%, rgb(16 15 14 / 85%) 22%, rgb(16 15 14 / 0%) 52%),
        radial-gradient(120% 70% at 50% 100%, transparent 55%, rgb(16 15 14 / 70%));
    }

    /* Índice a la izquierda y la pieza activa, derecha y legible, a la derecha. */
    .rail {
      position: absolute;
      z-index: 3;
      left: clamp(16px, 4vw, 56px);
      bottom: clamp(24px, 6vh, 64px);
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 6px;
      font-size: var(--text-xs);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ink-2);
    }
    .rail li {
      transition: color 0.3s, transform 0.3s var(--ease);
    }
    .rail li.on {
      color: var(--brass);
      transform: translateX(10px);
    }
    .captions {
      position: absolute;
      z-index: 3;
      right: clamp(16px, 4vw, 56px);
      bottom: clamp(24px, 8vh, 96px);
      width: min(340px, 30vw);
      display: grid;
    }
    .caption {
      grid-area: 1 / 1;
      padding: 24px 24px 22px;
      background: rgb(16 15 14 / 72%);
      backdrop-filter: blur(10px);
      border-top: 2px solid var(--brass);
      opacity: 0;
      transform: translateY(16px);
      transition: opacity 0.45s var(--ease), transform 0.45s var(--ease);
    }
    .caption.on {
      opacity: 1;
      transform: none;
    }
    .caption h3 {
      margin: 0;
      font-family: var(--font-display);
      font-stretch: 70%;
      font-weight: 400;
      font-size: var(--text-2xl);
      text-transform: uppercase;
      color: var(--ink);
    }
    .c-n {
      margin: 0 0 10px;
      font-size: var(--text-xs);
      color: var(--ink-2);
      letter-spacing: 0.1em;
    }
    .c-v {
      margin: 6px 0 12px;
      color: var(--brass);
      font-weight: 600;
    }
    .c-t {
      margin: 0;
      color: var(--ink);
      line-height: 1.5;
    }

    /* Movimiento reducido: sin pista, una lista quieta de piezas. */
    .runway.still {
      height: auto;
    }
    .still .pin {
      position: relative;
      height: auto;
      overflow: visible;
      padding: calc(var(--header-h) + 24px) 16px 64px;
    }
    .still .head {
      position: static;
      margin-bottom: 40px;
    }
    .still .scene,
    .still .rail {
      display: none;
    }
    .still .captions {
      position: static;
      width: auto;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .still .caption {
      grid-area: auto;
      opacity: 1;
      transform: none;
    }

    @media (max-width: 860px) {
      .floor {
        left: 50%;
        width: 900px;
        margin-left: -450px;
      }
      .scene {
        perspective-origin: 50% 8%;
      }
      .c-t {
        display: none;
      }
      .rail {
        display: none;
      }
      .captions {
        left: 16px;
        right: 16px;
        width: auto;
        bottom: 20px;
      }
      .caption {
        padding: 18px;
      }
    }
  `,
})
export class RunwayComponent {
  protected readonly stations = STATIONS;
  protected readonly gap = GAP;
  protected readonly floorLength = 760 + STATIONS.length * GAP + 2400;
  protected readonly active = signal(0);
  protected readonly still = signal(false);
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly floor = viewChild<ElementRef<HTMLElement>>('floor');

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      if (reducedMotion()) {
        this.still.set(true);
        return;
      }
      let alive = true;
      let kill = (): void => undefined;
      destroy.onDestroy(() => {
        alive = false;
        kill();
      });
      void loadMotion().then(({ gsap, ScrollTrigger }) => {
        const root = this.root()?.nativeElement;
        const floor = this.floor()?.nativeElement;
        if (!alive || !root || !floor) return;
        const travel = (STATIONS.length - 1) * GAP + 200;
        const tween = gsap.to(floor, {
          '--y': `${travel}px`,
          ease: 'none',
          scrollTrigger: {
            trigger: root,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.8,
            onUpdate: (st) => this.active.set(stepAt(st.progress, STATIONS.length)),
          },
        });
        kill = () => {
          tween.scrollTrigger?.kill();
          tween.kill();
        };
        ScrollTrigger.refresh();
      });
    });
  }
}
