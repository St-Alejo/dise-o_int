import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import type { CatalogItem } from '@interiores/shared-types';
import { CatalogApi } from '../../core/api/projects.api';
import { loadMotion, reducedMotion } from './motion';
import { statsOf } from './stats-band.component';

export interface Piece {
  id: string;
  name: string;
  /** Posición y ancho en % del escenario; `depth` es cuánto se mueve con el scroll (más, más cerca). */
  x: number;
  y: number;
  w: number;
  depth: number;
}

/** Las piezas que flotan alrededor del titular: una de cada familia del catálogo. */
export const PIECES: readonly Piece[] = [
  { id: 'sofa', name: 'Sofá de tres puestos', x: 56, y: 78, w: 30, depth: 0.9 },
  { id: 'butaca', name: 'Butaca bouclé', x: 3, y: 4, w: 15, depth: 0.5 },
  { id: 'lampara-arco', name: 'Lámpara de arco', x: 82, y: 0, w: 14, depth: 0.35 },
  { id: 'colgante', name: 'Lámpara colgante', x: 42, y: -6, w: 9, depth: 0.2 },
  { id: 'silla', name: 'Silla de roble', x: 3, y: 54, w: 11, depth: 1.1 },
  { id: 'monstera', name: 'Monstera', x: 87, y: 50, w: 11, depth: 0.7 },
  { id: 'aparador', name: 'Aparador de nogal', x: 16, y: 80, w: 22, depth: 0.6 },
  { id: 'mesa', name: 'Mesa de travertino', x: 62, y: 6, w: 12, depth: 0.25 },
];

/** Palabras del titular: cada una entra desenfocada y se asienta, como un objeto que cae en su sitio. */
const HEADLINE = ['Cada', 'pieza,', 'a', 'escala.'];

/**
 * El catálogo: un titular enorme y las piezas flotando a su alrededor a distintas profundidades, como
 * recortes sobre la mesa de un interiorista. Debajo, las cifras reales del catálogo.
 */
@Component({
  selector: 'app-pieces',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section #root class="pieces" [class.still]="still()" aria-labelledby="pieces-title">
      <div class="stage">
        @for (p of pieces; track p.id) {
          <img
            class="piece"
            [attr.data-depth]="p.depth"
            [src]="'landing/piezas/' + p.id + '.webp'"
            [alt]="p.name"
            [style.left.%]="p.x"
            [style.top.%]="p.y"
            [style.width.%]="p.w"
            width="800"
            height="800"
            loading="lazy"
            decoding="async"
            (error)="hide($event)"
          />
        }
        <div class="copy">
          <p class="kicker">04 · El catálogo</p>
          <h2 id="pieces-title" class="big">
            @for (w of words; track $index) {
              <span class="w">{{ w }}</span>{{ ' ' }}
            }
          </h2>
          <p class="lead">Cada mueble del editor tiene sus medidas reales: si no cabe, la app no lo pone. Al terminar, la lista de compras sale con medidas y precio estimado.</p>
        </div>
      </div>

      <dl class="numbers">
        @for (s of stats(); track s.label) {
          <div>
            <dt>{{ s.value }}</dt>
            <dd>{{ s.label }}</dd>
          </div>
        }
      </dl>
    </section>
  `,
  styles: `
    :host {
      display: block;
      --ink: #2a211b;
      --paper: #efe7da;
      --brass: #8a6a3a;
    }
    .pieces {
      position: relative;
      /* Yeso a la cal con luz rasante, aclarado: la pared de fondo sobre la que flotan las piezas. */
      background:
        linear-gradient(rgb(239 231 218 / 74%), rgb(239 231 218 / 86%)),
        image-set(url('/landing/yeso-1000.webp') 1x, url('/landing/yeso-2000.webp') 2x) center / cover,
        var(--paper);
      color: var(--ink);
      padding: clamp(80px, 12vh, 140px) clamp(16px, 4vw, 56px) clamp(64px, 10vh, 120px);
      overflow: hidden;
    }
    .stage {
      position: relative;
      min-height: min(120svh, 1100px);
      display: grid;
      place-items: center;
    }
    .piece {
      position: absolute;
      height: auto;
      will-change: transform;
      filter: drop-shadow(0 30px 30px rgb(42 33 27 / 18%));
    }
    .copy {
      position: relative;
      z-index: 2;
      text-align: center;
      max-width: 62rem;
    }
    .kicker {
      margin: 0 0 18px;
      color: var(--brass);
      font-size: var(--text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .big {
      margin: 0 0 24px;
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 700;
      font-size: clamp(3.4rem, 13vw, 13rem);
      line-height: 0.82;
      text-transform: uppercase;
      letter-spacing: -0.01em;
      color: var(--ink);
    }
    .w {
      display: inline-block;
    }
    .lead {
      margin: 0 auto;
      max-width: 44ch;
      font-size: var(--text-lg);
      line-height: 1.45;
      background: rgb(239 231 218 / 80%);
    }
    .numbers {
      position: relative;
      z-index: 2;
      margin: clamp(48px, 8vh, 96px) 0 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 32px;
      border-top: 2px solid var(--ink);
      padding-top: 28px;
    }
    .numbers dt {
      font-family: var(--font-display);
      font-stretch: 62%;
      font-weight: 300;
      font-size: clamp(3rem, 6vw, 5.5rem);
      line-height: 0.9;
      font-variant-numeric: tabular-nums;
    }
    .numbers dd {
      margin: 8px 0 0;
      max-width: 22ch;
    }

    @media (max-width: 860px) {
      .stage {
        min-height: 110svh;
        align-items: start;
        padding-top: 22svh;
      }
      .piece {
        min-width: 26vw;
      }
    }
  `,
})
export class PiecesComponent {
  protected readonly pieces = PIECES;
  protected readonly words = HEADLINE;
  protected readonly still = signal(false);
  private readonly catalog = signal<CatalogItem[] | null>(null);
  protected readonly stats = computed(() => statsOf(this.catalog()));
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');

  constructor() {
    inject(CatalogApi)
      .all()
      .then((items) => this.catalog.set(items))
      .catch(() => undefined);
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
      void loadMotion().then(({ gsap }) => {
        const root = this.root()?.nativeElement;
        if (!alive || !root) return;
        const ctx = gsap.context(() => {
          // El titular: palabra a palabra, del desenfoque a la nitidez.
          gsap.from(root.querySelectorAll('.w'), {
            yPercent: 40,
            opacity: 0,
            filter: 'blur(18px)',
            duration: 1.1,
            ease: 'power3.out',
            stagger: 0.12,
            scrollTrigger: { trigger: root, start: 'top 60%' },
          });
          // Las piezas: cada una a su profundidad, y una leve rotación al pasar.
          root.querySelectorAll<HTMLElement>('.piece').forEach((el, i) => {
            const depth = Number(el.dataset['depth'] ?? 0.5);
            gsap.fromTo(
              el,
              { yPercent: 60 * depth, rotate: i % 2 ? -4 : 4 },
              {
                yPercent: -90 * depth,
                rotate: i % 2 ? 3 : -3,
                ease: 'none',
                scrollTrigger: { trigger: root, start: 'top bottom', end: 'bottom top', scrub: 0.5 },
              },
            );
          });
        }, root);
        kill = () => ctx.revert();
      });
    });
  }

  protected hide(event: Event): void {
    (event.target as HTMLElement).style.display = 'none';
  }
}
