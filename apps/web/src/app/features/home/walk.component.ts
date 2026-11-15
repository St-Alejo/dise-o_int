import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { STYLES, type StyleId } from '@interiores/shared-types';
import { cycleFrame, loadMotion, reducedMotion, stepAt } from './motion';

/** Los seis estilos en el orden del paseo: de la luz de la mañana a la sala de noche. */
export const WALK: readonly { id: StyleId; line: string }[] = [
  { id: 'escandinavo', line: 'Roble claro, lino y una manta de lana sobre el sofá.' },
  { id: 'minimalista', line: 'Tres piezas, una pared desnuda y el piso entero a la vista.' },
  { id: 'industrial', line: 'Acero negro, cuero gastado y bombillas a la vista.' },
  { id: 'moderno', line: 'Líneas rectas, un sofá bajo y un solo color fuerte.' },
  { id: 'clasico', line: 'Molduras, simetría y maderas oscuras con brillo.' },
  { id: 'bohemio', line: 'Ratán, plantas, terracota y alfombras una sobre otra.' },
];

/**
 * Fotogramas de un paso completo de la persona (`landing/paseo/pNN.webp`, recortados sobre
 * transparente): salen de un vídeo de Seedance sobre croma. Con 0 el paseo se hace sin ella.
 */
export const WALKER_FRAMES = 38;
/** Píxeles de scroll por fotograma del paso: a más, más despacio camina. */
const PX_PER_FRAME = 14;

/**
 * «Recórrelo a pie»: la misma sala en sus seis vidas, una detrás de otra como habitaciones de una
 * casa, y una persona que las atraviesa caminando al ritmo del scroll.
 */
@Component({
  selector: 'app-walk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section #root class="walk" [class.still]="still()" aria-labelledby="walk-title">
      <div class="pin">
        <header class="head">
          <p class="kicker">03 · Seis vidas</p>
          <h2 id="walk-title" class="big">La misma sala,<br />seis casas.</h2>
          <p class="lead">Las paredes, la puerta y la ventana no se mueven. Cambia el estilo y la app vuelve a amueblar todo el cuarto.</p>
        </header>

        <div #track class="track">
          @for (w of rooms; track w.id; let i = $index) {
            <article class="room" [class.on]="active() === i">
              <span class="ghost" aria-hidden="true">{{ styles[w.id].label }}</span>
              <img
                [src]="'landing/vida-' + w.id + '-1200.webp'"
                [srcset]="'landing/vida-' + w.id + '-700.webp 700w, landing/vida-' + w.id + '-1200.webp 1200w'"
                sizes="(max-width: 860px) 78vw, 34vw"
                [alt]="'La sala amueblada en estilo ' + styles[w.id].label.toLowerCase() + '.'"
                width="1200"
                height="1500"
                loading="lazy"
                decoding="async"
              />
              <div class="meta">
                <p class="n">{{ '0' + (i + 1) }}</p>
                <h3>{{ styles[w.id].label }}</h3>
                <p class="line">{{ w.line }}</p>
                <ul class="swatches" aria-label="Paleta">
                  @for (c of styles[w.id].palette; track c) {
                    <li [style.background]="c"><span class="sr-only">{{ c }}</span></li>
                  }
                </ul>
              </div>
            </article>
          }
        </div>

        @if (walker) {
          <img #walkerImg class="walker" src="landing/paseo/p00.webp" alt="" aria-hidden="true" width="459" height="640" />
        }
        <div class="floorline" aria-hidden="true"></div>
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
    .walk {
      position: relative;
      height: 520svh;
      background: #191612;
      color: var(--ink);
    }
    .pin {
      position: sticky;
      top: 0;
      height: 100svh;
      overflow: hidden;
    }
    /* Las salas que ya pasaron se funden bajo el titular en vez de cruzarlo. */
    .pin::after {
      content: '';
      position: absolute;
      z-index: 1;
      inset: 0 auto 0 0;
      width: 44vw;
      pointer-events: none;
      background: linear-gradient(90deg, #191612 0%, #191612 62%, rgb(25 22 18 / 0%) 100%);
    }
    .head {
      position: absolute;
      z-index: 2;
      top: calc(var(--header-h) + 24px);
      left: clamp(16px, 4vw, 56px);
      max-width: 30rem;
    }
    .kicker {
      margin: 0 0 12px;
      color: var(--brass);
      font-size: var(--text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .big {
      margin: 0 0 16px;
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 300;
      font-size: clamp(2.4rem, 5vw, 4.6rem);
      line-height: 0.9;
      text-transform: uppercase;
      color: var(--ink);
    }
    .lead {
      margin: 0;
      max-width: 34ch;
      color: var(--ink);
    }

    /* La fila de salas: empieza fuera de la pantalla, a la derecha del titular. */
    .track {
      position: absolute;
      left: 0;
      bottom: 13svh;
      display: flex;
      gap: clamp(48px, 7vw, 120px);
      padding-left: max(46vw, 520px);
      padding-right: 20vw;
      will-change: transform;
    }
    .room {
      position: relative;
      flex: none;
      display: grid;
      grid-template-columns: auto 15rem;
      gap: 28px;
      align-items: end;
    }
    .room img {
      height: 62svh;
      width: auto;
      aspect-ratio: 4 / 5;
      object-fit: cover;
      display: block;
      filter: saturate(0.85) brightness(0.8);
      transition: filter 0.6s var(--ease);
    }
    .room.on img {
      filter: none;
    }
    .ghost {
      position: absolute;
      z-index: -1;
      left: -0.06em;
      top: -0.62em;
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 200;
      font-size: clamp(5rem, 13vw, 12rem);
      line-height: 1;
      text-transform: uppercase;
      color: transparent;
      -webkit-text-stroke: 1px rgb(201 164 106 / 45%);
      white-space: nowrap;
      opacity: 0;
      transform: translateX(-4%);
      transition: opacity 0.6s var(--ease), transform 0.8s var(--ease);
    }
    .room.on .ghost {
      opacity: 1;
      transform: none;
    }
    .meta {
      padding-bottom: 6px;
    }
    .n {
      margin: 0 0 8px;
      color: var(--brass);
      font-variant-numeric: tabular-nums;
    }
    .meta h3 {
      margin: 0 0 10px;
      font-family: var(--font-display);
      font-stretch: 70%;
      font-weight: 400;
      font-size: var(--text-2xl);
      text-transform: uppercase;
      color: var(--ink);
    }
    .line {
      margin: 0 0 16px;
      color: var(--ink);
    }
    .swatches {
      display: flex;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .swatches li {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      outline: 1px solid rgb(243 238 230 / 30%);
    }
    .walker {
      position: absolute;
      z-index: 3;
      left: 34vw;
      bottom: 6svh;
      height: 46svh;
      width: auto;
      pointer-events: none;
      filter: drop-shadow(0 18px 18px rgb(0 0 0 / 45%));
    }
    .floorline {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 8svh;
      border-top: 1px solid rgb(201 164 106 / 35%);
    }

    /* Sin movimiento: la fila se vuelve una columna normal. */
    .walk.still {
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
      margin-bottom: 48px;
    }
    .still .track {
      position: static;
      flex-direction: column;
      padding: 0;
    }
    .still .room img {
      filter: none;
    }
    .still .walker,
    .still .pin::after,
    .still .floorline {
      display: none;
    }

    @media (max-width: 860px) {
      .track {
        padding-left: 100vw;
        bottom: 3svh;
        gap: 40px;
      }
      .floorline {
        display: none;
      }
      .room {
        grid-template-columns: auto;
      }
      .room img {
        height: 30svh;
      }
      .meta h3 {
        font-size: var(--text-xl);
      }
      .meta {
        width: 0;
        min-width: 100%;
      }
      .ghost {
        display: none;
      }
      .pin::after {
        display: none;
      }
      .head {
        right: 16px;
      }
      /* En el celular no hay hueco libre: taparía el nombre y el texto de cada estilo. */
      .walker {
        display: none;
      }
      .still .room img {
        width: 100%;
        height: auto;
      }
    }
  `,
})
export class WalkComponent {
  protected readonly rooms = WALK;
  protected readonly styles = STYLES;
  protected readonly walker = WALKER_FRAMES > 0;
  protected readonly active = signal(0);
  protected readonly still = signal(false);
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  private readonly walkerImg = viewChild<ElementRef<HTMLImageElement>>('walkerImg');

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
        const track = this.track()?.nativeElement;
        if (!alive || !root || !track) return;
        const distance = (): number => Math.max(0, track.scrollWidth - window.innerWidth);
        let shown = -1;
        const tween = gsap.to(track, {
          x: () => -distance(),
          ease: 'none',
          scrollTrigger: {
            trigger: root,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.6,
            invalidateOnRefresh: true,
            onUpdate: (st) => {
              this.active.set(stepAt(st.progress * 1.08 - 0.04, WALK.length));
              const img = this.walkerImg()?.nativeElement;
              if (!img) return;
              const f = cycleFrame(st.progress * distance(), WALKER_FRAMES, PX_PER_FRAME);
              if (f !== shown) {
                shown = f;
                img.src = walkerSrc(f);
              }
              // Camina hacia donde va el scroll: de espaldas al subir.
              img.style.transform = st.direction < 0 ? 'scaleX(-1)' : '';
            },
          },
        });
        // El paso completo se precarga cuando el paseo está a unas pantallas, no al abrir la página:
        // así no compite con la película y el cambio de fotograma nunca parpadea.
        const preload = this.walker
          ? ScrollTrigger.create({
              trigger: root,
              start: 'top 300%',
              once: true,
              onEnter: () => {
                for (let i = 0; i < WALKER_FRAMES; i++) new Image().src = walkerSrc(i);
              },
            })
          : null;
        kill = () => {
          preload?.kill();
          tween.scrollTrigger?.kill();
          tween.kill();
        };
        ScrollTrigger.refresh();
      });
    });
  }
}

function walkerSrc(i: number): string {
  return `landing/paseo/p${String(i).padStart(2, '0')}.webp`;
}
