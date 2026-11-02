import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/ui/icon.component';

export interface HeroFrame {
  id: string;
  label: string;
  /** Imagen en dos anchos (`<base>-800.webp`, `<base>-1600.webp`); sin ella, es el plano. */
  base: string | null;
  alt: string;
}

/**
 * Lo que recorre el encabezado al bajar: cuatro cuartos amueblados con la app (capturas reales del
 * visor) y, al final, el plano de amoblamiento de la primera sala dibujado por el Modo Pro.
 */
export const HERO_FRAMES: readonly HeroFrame[] = [
  { id: 'sala', label: 'Sala', base: 'landing/cuarto-tarde', alt: 'Sala amueblada en 3D con luz de tarde: sofá en L bajo la ventana, mesa de centro, butaca de cuero y estantería.' },
  { id: 'cocina', label: 'Cocina', base: 'landing/secuencia-cocina-minimalista', alt: 'Cocina minimalista en 3D: hilera de gabinetes, isla central y taburetes.' },
  { id: 'comedor', label: 'Comedor', base: 'landing/secuencia-comedor-moderno', alt: 'Comedor moderno en 3D: mesa para seis y un aparador contra la pared.' },
  { id: 'dormitorio', label: 'Dormitorio', base: 'landing/secuencia-dormitorio-luminoso', alt: 'Dormitorio luminoso en 3D: cama doble con mesas de noche, lino y madera clara.' },
  { id: 'plano', label: 'Plano', base: null, alt: 'Plano de amoblamiento a escala de la misma sala, con muros, ventana, puerta y cada mueble.' },
];

/** Plantilla que abre "Probar sin cuenta": la sala del primer cuadro. */
export const HERO_TEMPLATE = 'sala-escandinava';

/** Qué cuadro toca y cuánto se ha fundido con el siguiente, para un avance de 0 a 1. */
export function heroFrameAt(progress: number, count: number): { index: number; mix: number } {
  const t = Math.min(Math.max(progress, 0), 1) * (count - 1);
  const index = Math.min(Math.floor(t), count - 1);
  return { index, mix: index === count - 1 ? 0 : t - index };
}

/**
 * Encabezado de la página de inicio, a pantalla completa. Al bajar, el cuarto cambia (sala, cocina,
 * comedor, dormitorio) y termina en el plano técnico de la sala: lo que la app hace, en orden. Los
 * nombres de abajo a la derecha llevan a cada cuadro. Sin animaciones, es una sola imagen con botones.
 */
@Component({
  selector: 'app-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  host: { '[class.still]': 'still()' },
  template: `
    <section class="hero" aria-labelledby="hero-title" [style.--frames]="frames.length">
      <div class="stage">
        @for (f of frames; track f.id; let i = $index) {
          <div class="layer" [class.plan]="!f.base" [style.opacity]="opacity(i)" [attr.aria-hidden]="current() === i ? null : 'true'">
            @if (f.base) {
              <img
                [attr.srcset]="f.base + '-800.webp 800w, ' + f.base + '-1600.webp 1600w'"
                sizes="100vw"
                [src]="f.base + '-1600.webp'"
                [alt]="f.alt"
                width="1600"
                height="1000"
                [attr.loading]="i === 0 ? 'eager' : 'lazy'"
                [attr.fetchpriority]="i === 0 ? 'high' : null"
                decoding="async"
                [style.transform]="'scale(' + zoom(i) + ')'"
              />
            } @else {
              <figure>
                <img src="landing/plano-sala.svg" [alt]="f.alt" width="740" height="670" loading="lazy" decoding="async" />
                <figcaption>La misma sala, en su plano de amoblamiento a escala 1:50. Lo dibuja el Modo Pro y se descarga en PDF o DXF.</figcaption>
              </figure>
            }
          </div>
        }
        <div class="scrim" aria-hidden="true"></div>

        <div class="copy">
          <h1 id="hero-title">Diseña el cuarto. Llévate el plano.</h1>
          <p class="lead">
            Sube una foto o escribe tres medidas: la app levanta el cuarto en 3D, lo amuebla a tu estilo y te entrega la lista de compras y los planos para
            la obra.
          </p>
          <div class="cta">
            <a class="btn btn-lg go" [routerLink]="start()">Diseñar mi cuarto</a>
            <a class="btn btn-lg ghost" [routerLink]="['/demo', template]">Probar sin cuenta <app-icon name="arrowRight" /></a>
          </div>
        </div>

        <nav class="frames" aria-label="Cuartos del encabezado">
          @for (f of frames; track f.id; let i = $index) {
            <button type="button" [class.on]="current() === i" [attr.aria-current]="current() === i ? 'true' : null" (click)="go(i)">{{ f.label }}</button>
          }
        </nav>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      --hero-ink: #f5f1e8;
      --plan-ground: #12201d;
    }
    .hero {
      position: relative;
      /* Un tramo de pantalla por cuadro: el cuarto queda fijo mientras se baja. */
      height: calc(var(--frames) * 85svh);
    }
    :host(.still) .hero {
      height: auto;
    }
    .stage {
      position: sticky;
      top: var(--header-h);
      height: calc(100svh - var(--header-h));
      min-height: 520px;
      overflow: hidden;
      background: var(--plan-ground);
      color: var(--hero-ink);
    }
    :host(.still) .stage {
      position: relative;
      top: 0;
    }
    .layer {
      position: absolute;
      inset: 0;
      will-change: opacity;
    }
    .layer > img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform-origin: 60% 50%;
      will-change: transform;
    }
    .layer.plan {
      background: var(--plan-ground);
      display: grid;
      place-items: center;
      padding: clamp(24px, 5vw, 72px);
    }
    .plan figure {
      margin: 0;
      display: grid;
      justify-items: end;
      gap: var(--space-4);
      width: min(100%, 1100px);
      height: 100%;
      grid-template-rows: auto minmax(0, 1fr);
      padding-left: min(44vw, 560px);
      /* Deja libre la esquina de abajo, donde van los nombres de los cuadros. */
      padding-bottom: 200px;
    }
    .plan figcaption {
      grid-row: 1;
    }
    .plan figure img {
      grid-row: 2;
    }
    .plan figure img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .plan figcaption {
      max-width: 40ch;
      font-size: var(--text-sm);
      color: #cfc8bb;
      text-align: right;
    }
    /* Velo neutro solo donde va el texto, para que se lea sobre cualquier cuarto. */
    .scrim {
      position: absolute;
      inset: auto 0 0 0;
      height: 70%;
      background: linear-gradient(to top, rgb(10 16 14 / 78%), rgb(10 16 14 / 0%));
      pointer-events: none;
    }
    .copy {
      position: absolute;
      left: max(var(--space-5), calc((100vw - 1200px) / 2));
      bottom: clamp(32px, 7vh, 80px);
      width: min(620px, calc(100% - 2 * var(--space-5)));
      display: grid;
      gap: var(--space-5);
    }
    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 500;
      font-size: clamp(2.6rem, 5.6vw, 5.4rem);
      line-height: 0.98;
      letter-spacing: -0.03em;
      color: var(--hero-ink);
    }
    .lead {
      margin: 0;
      max-width: 48ch;
      font-size: clamp(1rem, 0.4vw + 0.9rem, 1.2rem);
      line-height: 1.5;
      color: var(--hero-ink);
    }
    .cta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .btn.go {
      background: var(--hero-ink);
      color: #10201d;
      border-color: var(--hero-ink);
      border-radius: 0;
    }
    .btn.go:hover {
      background: #ffffff;
    }
    .btn.ghost {
      background: transparent;
      color: var(--hero-ink);
      border: 2px solid rgb(245 241 232 / 70%);
      border-radius: 0;
    }
    .btn.ghost:hover {
      background: rgb(245 241 232 / 12%);
      border-color: var(--hero-ink);
    }
    .btn:active {
      transform: translateY(1px);
    }
    .frames {
      position: absolute;
      right: max(var(--space-5), calc((100vw - 1200px) / 2));
      bottom: clamp(32px, 7vh, 80px);
      display: grid;
      justify-items: end;
      gap: 2px;
    }
    .frames button {
      background: none;
      border: 0;
      padding: 6px 0 6px 18px;
      font: inherit;
      font-size: var(--text-base);
      color: rgb(245 241 232 / 62%);
      cursor: pointer;
      transition:
        color 0.25s var(--ease),
        transform 0.25s var(--ease);
    }
    .frames button:hover,
    .frames button:focus-visible {
      color: var(--hero-ink);
    }
    .frames button.on {
      color: var(--hero-ink);
      font-weight: 600;
      transform: translateX(-6px);
    }
    @media (max-width: 860px) {
      .plan figure {
        padding-left: 0;
        padding-bottom: 46vh;
        justify-items: center;
      }
      .plan figcaption {
        display: none;
      }
      .frames {
        top: 0;
        bottom: auto;
        right: 0;
        left: 0;
        padding: var(--space-2) var(--space-4);
        background: rgb(10 16 14 / 72%);
        display: flex;
        justify-content: flex-start;
        flex-wrap: wrap;
        gap: 0 var(--space-4);
      }
      .frames button {
        padding: 8px 0;
        font-size: var(--text-sm);
      }
      .frames button.on {
        transform: none;
        text-decoration: underline;
        text-underline-offset: 6px;
      }
      .copy {
        left: var(--space-4);
        width: calc(100% - 2 * var(--space-4));
        bottom: var(--space-6);
      }
      .scrim {
        height: 85%;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .layer,
      .layer > img {
        will-change: auto;
      }
      .frames button {
        transition: none;
      }
    }
  `,
})
export class HeroComponent {
  /** A dónde lleva "Diseñar mi cuarto": al asistente o, sin sesión, al registro. */
  readonly start = input.required<string>();
  protected readonly frames = HERO_FRAMES;
  protected readonly template = HERO_TEMPLATE;

  /** Avance del recorrido (0 al empezar el encabezado, 1 al terminarlo). */
  private readonly progress = signal(0);
  /** Sin movimiento (o sin poder medir): una imagen fija que cambia con los botones. */
  protected readonly still = signal(false);
  /** Cuadro elegido con los botones cuando no hay recorrido. */
  private readonly picked = signal(0);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly at = computed(() => (this.still() ? { index: this.picked(), mix: 0 } : heroFrameAt(this.progress(), HERO_FRAMES.length)));
  protected readonly current = computed(() => {
    const { index, mix } = this.at();
    return mix > 0.5 ? index + 1 : index;
  });

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      const apply = () => this.still.set(reduced.matches);
      apply();
      reduced.addEventListener('change', apply);
      let frame = 0;
      const measure = () => {
        frame = 0;
        const section = this.host.nativeElement.querySelector<HTMLElement>('.hero');
        if (!section || this.still()) return;
        const rect = section.getBoundingClientRect();
        const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 60;
        const span = section.offsetHeight - (window.innerHeight - header);
        this.progress.set(span > 0 ? Math.min(Math.max((header - rect.top) / span, 0), 1) : 0);
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
        reduced.removeEventListener('change', apply);
        if (frame) cancelAnimationFrame(frame);
      });
    });
  }

  /** Opacidad de cada capa: la actual entera y la siguiente entrando encima. */
  protected opacity(i: number): number {
    const { index, mix } = this.at();
    if (i < index) return 0;
    if (i === index) return 1;
    if (i === index + 1) return mix;
    return 0;
  }

  /** Un acercamiento lento mientras la imagen está en pantalla. */
  protected zoom(i: number): number {
    if (this.still()) return 1;
    const t = this.progress() * (HERO_FRAMES.length - 1) - i;
    return 1.08 - 0.08 * Math.min(Math.max((t + 1) / 2, 0), 1);
  }

  /** Lleva al cuadro elegido: baja hasta su tramo o, sin recorrido, lo muestra. */
  protected go(i: number): void {
    if (this.still()) {
      this.picked.set(i);
      return;
    }
    const section = this.host.nativeElement.querySelector<HTMLElement>('.hero');
    if (!section) return;
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 60;
    const span = section.offsetHeight - (window.innerHeight - header);
    const top = section.getBoundingClientRect().top + window.scrollY - header + (span * i) / (HERO_FRAMES.length - 1);
    window.scrollTo({ top: Math.ceil(top) + 1, behavior: 'smooth' });
  }
}
