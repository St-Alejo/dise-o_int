import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/ui/icon.component';

/** Un capítulo de la película: el tramo del scroll que ocupa y lo que se lee encima. */
export interface Chapter {
  id: string;
  name: string;
  /** Inicio del tramo, de 0 a 1 sobre todo el recorrido. */
  from: number;
  lines: string[];
  text: string;
  meta?: string;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    id: 'foto',
    name: 'La foto',
    from: 0,
    lines: ['De una foto', 'a tu cuarto'],
    text: 'Sube una foto o escribe tres medidas. La app levanta el cuarto en 3D, lo amuebla a tu estilo y te entrega la lista de compras y los planos.',
  },
  {
    id: 'plano',
    name: 'El plano',
    from: 0.17,
    lines: ['Lo mide'],
    text: 'Lee puertas, ventanas y medidas de la foto, y te deja corregir cada cota antes de seguir.',
    meta: '5,00 × 4,20 m · 2,60 m de alto · 1 ventana · 1 puerta',
  },
  {
    id: 'volumen',
    name: 'El volumen',
    from: 0.32,
    lines: ['Lo levanta', 'en 3D'],
    text: 'Paredes, piso y techo con sus medidas reales. Lo giras, lo recorres a pie y lo cambias con el dedo.',
    meta: '21,0 m² · planta rectangular',
  },
  {
    id: 'casa',
    name: 'La casa',
    from: 0.47,
    lines: ['Lo amuebla'],
    text: 'Propone muebles reales del catálogo, con sus medidas y su precio, sin tapar puertas ni ventanas.',
    meta: '11 piezas · total aproximado $4.540',
  },
  {
    id: 'vidas',
    name: 'Seis estilos',
    from: 0.62,
    lines: ['Seis estilos', 'un cuarto'],
    text: 'Escandinavo, minimalista, industrial, bohemio, moderno o clásico: el mismo espacio, otra vida, en un clic.',
  },
  {
    id: 'noche',
    name: 'La noche',
    from: 0.86,
    lines: ['Vívelo antes', 'de comprarlo'],
    text: 'Pruébalo de noche, compártelo con un enlace y llévate los planos para la obra.',
  },
];

/** Cuánto se ha recorrido el tramo fijo (0 al entrar, 1 al salir). */
export function scrollProgress(top: number, height: number, viewport: number): number {
  const run = height - viewport;
  if (run <= 0) return 0;
  return Math.min(1, Math.max(0, -top / run));
}

/** El fotograma que toca a un progreso dado. */
export function frameAt(progress: number, count: number): number {
  if (count <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * (count - 1));
}

/** El capítulo en curso: el último cuyo inicio ya pasó. */
export function chapterAt(progress: number, chapters: readonly Pick<Chapter, 'from'>[]): number {
  let at = 0;
  chapters.forEach((c, i) => {
    if (progress >= c.from) at = i;
  });
  return at;
}

/**
 * En qué orden se piden los fotogramas: primero uno de cada ocho (la película ya se puede recorrer a
 * saltos), luego uno de cada cuatro, de cada dos y el resto. Cada índice aparece una sola vez.
 */
export function loadOrder(count: number): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const add = (i: number) => {
    if (!seen.has(i)) {
      seen.add(i);
      order.push(i);
    }
  };
  if (count > 0) {
    add(0);
    add(count - 1);
  }
  for (const step of [8, 4, 2, 1]) {
    for (let i = 0; i < count; i += step) add(i);
  }
  return order;
}

/** El fotograma cargado más cercano al pedido (o -1 si no hay ninguno). */
export function nearestLoaded(target: number, loaded: readonly boolean[]): number {
  for (let d = 0; d < loaded.length; d++) {
    if (loaded[target - d]) return target - d;
    if (loaded[target + d]) return target + d;
  }
  return -1;
}

export function framePath(set: string, index: number): string {
  return `cine/${set}/f${String(index).padStart(3, '0')}.webp`;
}

/**
 * La portada es una película: un plano de cámara que va de la foto del cuarto vacío al cuarto
 * terminado de noche. Queda fija a pantalla completa y el scroll la hace avanzar o retroceder
 * fotograma a fotograma; encima, el capítulo en curso en letras grandes. Con movimiento reducido no
 * hay película: cada capítulo se lee con su fotograma fijo.
 */
@Component({
  selector: 'app-film',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    @if (still()) {
      <div class="stills">
        @for (c of chapters; track c.id; let i = $index) {
          <section class="still" [attr.aria-labelledby]="'ch-' + c.id">
            <img [src]="stillOf(i)" alt="" width="1280" height="720" [attr.loading]="i === 0 ? 'eager' : 'lazy'" />
            <div class="copy">
              @if (i === 0) {
                <h1 [id]="'ch-' + c.id" class="big">{{ c.lines.join(' ') }}</h1>
              } @else {
                <h2 [id]="'ch-' + c.id" class="big">{{ c.lines.join(' ') }}</h2>
              }
              <p class="text">{{ c.text }}</p>
              @if (i === 0 || i === chapters.length - 1) {
                <div class="cta">
                  <a class="btn btn-primary btn-lg" [routerLink]="start()">Diseñar mi cuarto</a>
                  <a class="btn btn-ghost btn-lg" [routerLink]="['/demo', demo]">Probar sin cuenta <app-icon name="arrowRight" /></a>
                </div>
              }
            </div>
          </section>
        }
      </div>
    } @else {
      <section #run class="run" aria-label="De una foto a tu cuarto, en seis capítulos">
        <span id="estilos" class="anchor" aria-hidden="true"></span>
        <div class="stage">
          <img class="poster" [src]="poster" alt="" width="1280" height="720" fetchpriority="high" [class.gone]="drawn()" />
          <canvas #canvas aria-hidden="true"></canvas>
          <div class="shade" aria-hidden="true"></div>

          @for (c of chapters; track c.id; let i = $index) {
            <div class="chapter" [class.on]="chapter() === i" [attr.aria-hidden]="chapter() === i ? null : 'true'">
              @if (i === 0) {
                <h1 class="big">
                  @for (l of c.lines; track l; let j = $index) {
                    <span class="line"><span [style.--d]="j">{{ l }}</span></span>
                  }
                </h1>
              } @else {
                <h2 class="big">
                  @for (l of c.lines; track l; let j = $index) {
                    <span class="line"><span [style.--d]="j">{{ l }}</span></span>
                  }
                </h2>
              }
              <p class="text">{{ c.text }}</p>
              @if (c.meta) {
                <p class="meta">{{ c.meta }}</p>
              }
              @if (i === 0 || i === chapters.length - 1) {
                <div class="cta">
                  <a class="btn btn-primary btn-lg" [routerLink]="start()" [attr.tabindex]="chapter() === i ? null : -1">Diseñar mi cuarto</a>
                  <a class="btn btn-ghost btn-lg" [routerLink]="['/demo', demo]" [attr.tabindex]="chapter() === i ? null : -1"
                    >Probar sin cuenta <app-icon name="arrowRight"
                  /></a>
                </div>
              }
            </div>
          }

          <nav class="rail" aria-label="Capítulos">
            @for (c of chapters; track c.id; let i = $index) {
              <button type="button" [class.on]="chapter() === i" [attr.aria-current]="chapter() === i ? 'step' : null" (click)="go(i)">
                <span>{{ c.name }}</span>
              </button>
            }
          </nav>
          <div class="progress" aria-hidden="true"><span [style.transform]="'scaleX(' + progress() + ')'"></span></div>
          @if (progress() < 0.02) {
            <p class="hint" aria-hidden="true">Baja para verlo</p>
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      --film-len: 8;
      background: #100f0e;
      color: #f3eee6;
    }
    .run {
      position: relative;
      height: calc(var(--film-len) * 100svh);
    }
    /* Destino de "Estilos" en la cabecera: el capítulo de los seis estilos. */
    .anchor {
      position: absolute;
      top: calc(0.63 * (var(--film-len) - 1) * 100svh);
    }
    .stage {
      position: sticky;
      top: 0;
      height: 100svh;
      overflow: hidden;
    }
    canvas,
    .poster {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .poster.gone {
      visibility: hidden;
    }
    /* Sombra a la izquierda y abajo: el texto blanco se lee sobre cualquier fotograma. */
    .shade {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgb(12 10 9 / 72%) 0%, rgb(12 10 9 / 30%) 42%, rgb(12 10 9 / 0%) 70%),
        linear-gradient(0deg, rgb(12 10 9 / 55%) 0%, rgb(12 10 9 / 0%) 30%);
    }
    .chapter {
      position: absolute;
      left: clamp(20px, 5vw, 80px);
      bottom: clamp(88px, 14vh, 160px);
      max-width: min(720px, 86vw);
      display: grid;
      gap: 20px;
      pointer-events: none;
    }
    .chapter.on {
      pointer-events: auto;
    }
    .big {
      margin: 0;
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 300;
      font-size: clamp(3.4rem, 10.5vw, 9.5rem);
      line-height: 0.86;
      letter-spacing: -0.01em;
      text-transform: uppercase;
      color: #f6f1e9;
    }
    .line {
      display: block;
      overflow: hidden;
      padding-bottom: 0.04em;
    }
    .line > span {
      display: block;
      transform: translateY(105%);
      transition: transform 0.8s cubic-bezier(0.2, 0.7, 0.1, 1);
      transition-delay: calc(var(--d) * 90ms);
    }
    .chapter.on .line > span {
      transform: none;
    }
    .text,
    .meta,
    .cta {
      opacity: 0;
      transform: translateY(14px);
      transition:
        opacity 0.6s ease,
        transform 0.6s ease;
    }
    .chapter.on .text,
    .chapter.on .meta,
    .chapter.on .cta {
      opacity: 1;
      transform: none;
      transition-delay: 0.25s;
    }
    .text {
      margin: 0;
      max-width: 46ch;
      font-size: clamp(1rem, 1.3vw, 1.2rem);
      line-height: 1.55;
      color: #ece6dc;
    }
    .meta {
      margin: 0;
      font-stretch: 125%;
      font-size: 0.8rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #d9c39c;
    }
    .cta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .cta .btn-primary {
      background: #f3eee6;
      color: #100f0e;
      border-color: #f3eee6;
    }
    .cta .btn-ghost {
      color: #f3eee6;
      border-color: rgb(243 238 230 / 45%);
    }
    .rail {
      position: absolute;
      right: clamp(12px, 3vw, 48px);
      top: 50%;
      transform: translateY(-50%);
      display: grid;
      gap: 2px;
    }
    .rail button {
      min-height: 44px;
      padding: 0 0 0 28px;
      border: 0;
      background: none;
      color: rgb(243 238 230 / 55%);
      font: inherit;
      font-stretch: 125%;
      font-size: 0.72rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      text-align: right;
      cursor: pointer;
      position: relative;
      transition: color 0.3s ease;
    }
    .rail button::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      width: 16px;
      height: 2px;
      background: currentColor;
      transform-origin: left;
      transform: scaleX(0.5);
      transition: transform 0.3s ease;
    }
    .rail button.on,
    .rail button:hover {
      color: #f6f1e9;
    }
    .rail button.on::before {
      transform: scaleX(1);
    }
    .progress {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 3px;
      background: rgb(243 238 230 / 12%);
    }
    .progress span {
      display: block;
      height: 100%;
      background: #d9b27a;
      transform-origin: left;
    }
    .hint {
      position: absolute;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      margin: 0;
      font-stretch: 125%;
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgb(243 238 230 / 70%);
    }
    .stills {
      display: grid;
    }
    .still {
      position: relative;
      min-height: 80svh;
      display: grid;
      align-items: end;
    }
    .still img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: brightness(0.55);
    }
    .still .copy {
      position: relative;
      display: grid;
      gap: 16px;
      padding: 96px clamp(20px, 5vw, 80px) 64px;
      max-width: 760px;
    }
    @media (max-width: 760px) {
      .rail {
        display: none;
      }
      .chapter {
        bottom: 56px;
      }
      .shade {
        background: linear-gradient(0deg, rgb(12 10 9 / 80%) 0%, rgb(12 10 9 / 30%) 55%, rgb(12 10 9 / 0%) 80%);
      }
    }
  `,
})
export class FilmComponent {
  readonly start = input.required<string>();
  protected readonly chapters = CHAPTERS;
  protected readonly demo = 'sala-escandinava';
  /** Cuántos fotogramas tiene la película de cada tamaño. */
  private readonly count = 180;
  private readonly set = 'desk';
  protected readonly poster = framePath(this.set, 0);
  protected readonly progress = signal(0);
  protected readonly chapter = computed(() => chapterAt(this.progress(), this.chapters));
  protected readonly drawn = signal(false);
  protected readonly still = signal(false);
  private readonly run = viewChild<ElementRef<HTMLElement>>('run');
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.still.set(true);
        return;
      }
      const canvas = this.canvas()?.nativeElement;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        this.still.set(true);
        return;
      }
      const frames: HTMLImageElement[] = [];
      const loaded: boolean[] = new Array(this.count).fill(false);
      let shown = -1;
      let frame = 0;
      let alive = true;

      const fit = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(canvas.clientWidth * dpr);
        canvas.height = Math.round(canvas.clientHeight * dpr);
        shown = -1;
      };
      const draw = () => {
        frame = 0;
        const run = this.run()?.nativeElement;
        if (!run) return;
        const rect = run.getBoundingClientRect();
        const p = scrollProgress(rect.top, rect.height, window.innerHeight);
        this.progress.set(p);
        const index = nearestLoaded(frameAt(p, this.count), loaded);
        if (index < 0 || index === shown) return;
        const img = frames[index]!;
        // Como object-fit: cover.
        const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        shown = index;
        if (!this.drawn()) this.drawn.set(true);
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(draw);
      };
      const onResize = () => {
        fit();
        schedule();
      };

      // Se piden de a seis a la vez, en el orden que deja recorrer la película cuanto antes.
      const queue = loadOrder(this.count);
      const next = () => {
        const i = queue.shift();
        if (i === undefined || !alive) return;
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          loaded[i] = true;
          schedule();
          next();
        };
        img.onerror = () => next();
        img.src = framePath(this.set, i);
        frames[i] = img;
      };
      for (let k = 0; k < 6; k++) next();

      fit();
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', onResize, { passive: true });
      draw();
      destroy.onDestroy(() => {
        alive = false;
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', onResize);
        if (frame) cancelAnimationFrame(frame);
      });
    });
  }

  protected stillOf(i: number): string {
    const c = this.chapters[i]!;
    const end = this.chapters[i + 1]?.from ?? 1;
    return framePath(this.set, frameAt((c.from + end) / 2, this.count));
  }

  /** Salta al inicio de un capítulo. */
  protected go(i: number): void {
    const run = this.run()?.nativeElement;
    if (!run) return;
    const top = run.getBoundingClientRect().top + window.scrollY;
    const travel = run.offsetHeight - window.innerHeight;
    const at = (this.chapters[i]!.from + (i ? 0.01 : 0)) * travel;
    window.scrollTo({ top: top + at, behavior: 'smooth' });
  }
}
