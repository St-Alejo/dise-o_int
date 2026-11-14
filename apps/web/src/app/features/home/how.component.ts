import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, signal, viewChild, viewChildren } from '@angular/core';
import { IconComponent } from '../../shared/ui/icon.component';
import { activeLife } from './cover.component';

export const STEPS: readonly { title: string; text: string }[] = [
  { title: 'Primero, una foto o tres medidas.', text: 'La foto aporta puertas, ventanas, muebles y colores. Sin foto, eliges la forma del cuarto y escribes sus medidas.' },
  { title: 'Luego confirmas el plano.', text: 'Ves lo que la app entendió, con sus cotas, y corriges lo que haga falta antes de seguir.' },
  { title: 'Al final, lo amueblas y lo recorres.', text: 'Editas en 3D, caminas por el cuarto, lo pruebas de noche y compartes un enlace que también se puede recorrer.' },
];

/**
 * Cómo funciona, en tres frases que se leen de una en una. A la derecha, un trozo de la app que no se
 * mueve y cambia de estado con cada frase: el formulario de medidas, el plano con sus cotas y el
 * cuarto en 3D. Los dos primeros están hechos en HTML, como en la app; el tercero es una captura.
 */
@Component({
  selector: 'app-how',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="container how">
      <div class="steps">
        <h2 id="how-title">Tres pasos hasta tu cuarto.</h2>
        <ol>
          @for (step of steps; track step.title; let i = $index) {
            <li #step [class.on]="active() === i">
              <h3>{{ step.title }}</h3>
              <p>{{ step.text }}</p>
            </li>
          }
        </ol>
      </div>
      <div #stage class="stage" aria-hidden="true">
        <div class="frag frag-measure" [class.on]="active() === 0">
          <div class="drop">
            <app-icon name="camera" />
            <span><strong>sala.jpg</strong> · 2,4 MB · sin ubicación GPS</span>
          </div>
          <p class="or">o escribe las medidas</p>
          <div class="fields">
            <div class="f"><span>Ancho</span><b>5,00 m</b></div>
            <div class="f"><span>Fondo</span><b>4,20 m</b></div>
            <div class="f"><span>Alto</span><b>2,60 m</b></div>
          </div>
          <span class="btn btn-primary">Analizar el cuarto</span>
        </div>
        <div class="frag frag-plan" [class.on]="active() === 1">
          <img src="landing/plano-sala.svg" alt="" width="740" height="670" loading="lazy" decoding="async" />
          <div class="confirm">
            <span>5,00 × 4,20 m · 1 ventana · 1 puerta</span>
            <span class="btn btn-primary btn-sm">Confirmar el plano</span>
          </div>
        </div>
        <div class="frag frag-room" [class.on]="active() === 2">
          <img
            src="landing/cuarto-tarde-800.webp"
            srcset="landing/cuarto-tarde-800.webp 800w, landing/cuarto-tarde-1600.webp 1600w"
            sizes="(max-width: 860px) 100vw, 46vw"
            alt=""
            width="1600"
            height="1000"
            loading="lazy"
            decoding="async"
          />
          <div class="tools">
            <span class="on"><app-icon name="cube" /> Mover</span>
            <span><app-icon name="palette" /> Pintar</span>
            <span><app-icon name="walk" /> Recorrer</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .how {
      display: grid;
      grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
      gap: clamp(32px, 6vw, 96px);
    }
    h2 {
      font-size: var(--text-2xl);
      margin: 0;
      padding-top: 14vh;
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      min-height: 72vh;
      display: grid;
      align-content: center;
      gap: var(--space-3);
      max-width: 30ch;
    }
    li h3 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 400;
      font-size: var(--text-2xl);
      line-height: 1.05;
      color: var(--text-muted);
      transition: color 0.5s var(--ease);
    }
    li.on h3 {
      color: var(--text);
    }
    li p {
      margin: 0;
      font-size: var(--text-base);
    }
    .stage {
      position: sticky;
      top: 14vh;
      height: min(72vh, 620px);
      margin-top: 14vh;
      border-radius: var(--radius-lg);
      background: var(--tint-1);
      overflow: hidden;
    }
    .frag {
      position: absolute;
      inset: clamp(20px, 3vw, 40px);
      display: grid;
      align-content: center;
      gap: var(--space-4);
      opacity: 0;
      transform: translateY(16px);
      transition:
        opacity 0.6s var(--ease),
        transform 0.6s var(--ease);
    }
    .frag.on {
      opacity: 1;
      transform: none;
    }
    .drop {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: 28px 20px;
      border: 2px dashed var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      font-size: var(--text-sm);
    }
    .drop app-icon {
      font-size: 1.6rem;
      color: var(--primary);
    }
    .or {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .fields {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-3);
    }
    .fields .f {
      display: grid;
      gap: 4px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .fields b {
      color: var(--text);
      font-size: var(--text-base);
      font-variant-numeric: tabular-nums;
    }
    .frag-measure .btn {
      justify-self: start;
    }
    .frag-plan {
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .frag-plan img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: var(--surface);
      border-radius: var(--radius);
      padding: 12px;
    }
    .confirm {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: 8px 8px 8px 16px;
      border-radius: var(--radius);
      background: var(--surface);
      font-size: var(--text-sm);
      font-variant-numeric: tabular-nums;
    }
    .frag-room {
      inset: 0;
      align-content: stretch;
    }
    .frag-room img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .tools {
      position: absolute;
      left: 16px;
      bottom: 16px;
      display: flex;
      gap: 4px;
      padding: 4px;
      border-radius: 999px;
      background: var(--surface);
      font-size: var(--text-sm);
      font-weight: 600;
    }
    .tools span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 999px;
    }
    .tools .on {
      background: var(--text);
      color: var(--bg);
    }
    @media (max-width: 860px) {
      .how {
        grid-template-columns: 1fr;
      }
      /* En el celular el escenario se queda arriba y las frases pasan por debajo de él. */
      .stage {
        order: -1;
        top: 8px;
        height: 42svh;
        margin-top: 0;
        z-index: 1;
        box-shadow: 0 -8px 0 8px var(--bg);
      }
      h2 {
        padding-top: 32px;
      }
      li {
        min-height: 46svh;
      }
    }
  `,
})
export class HowComponent {
  protected readonly steps = STEPS;
  protected readonly active = signal(0);
  private readonly items = viewChildren<ElementRef<HTMLElement>>('step');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      let frame = 0;
      const measure = () => {
        frame = 0;
        const rects = this.items().map((i) => i.nativeElement.getBoundingClientRect());
        // En el celular el escenario tapa la parte de arriba: manda la frase en el centro de lo que queda.
        const narrow = window.matchMedia('(max-width: 860px)').matches;
        const centre = narrow ? (this.stage().nativeElement.getBoundingClientRect().bottom + window.innerHeight) / 2 : window.innerHeight / 2;
        if (rects.length) this.active.set(activeLife(rects.map((r) => r.top + r.height / 2), centre));
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
        if (frame) cancelAnimationFrame(frame);
      });
    });
  }
}
