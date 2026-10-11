import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/** Cómo se lee en voz alta la posición del deslizador. */
export function sliderText(percent: number, before: string, after: string): string {
  if (percent <= 2) return `Solo ${after}`;
  if (percent >= 98) return `Solo ${before}`;
  return `${Math.round(percent)} % ${before}, ${Math.round(100 - percent)} % ${after}`;
}

/**
 * Antes y después con un deslizador: dos imágenes del mismo encuadre, una encima de la otra, y una
 * raya que descubre más de una o de otra. Es un `input type="range"` de verdad, así que funciona
 * con el ratón, con el dedo y con las flechas del teclado.
 */
@Component({
  selector: 'app-before-after',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame" [style.--pos]="position() + '%'">
      <img class="after" [attr.srcset]="srcset(after())" [src]="after() + '-1600.webp'" sizes="(max-width: 1232px) 100vw, 1200px" [alt]="afterAlt()" width="1600" height="1000" loading="lazy" decoding="async" />
      <img class="before" [attr.srcset]="srcset(before())" [src]="before() + '-1600.webp'" sizes="(max-width: 1232px) 100vw, 1200px" [alt]="beforeAlt()" width="1600" height="1000" loading="lazy" decoding="async" />
      <span class="tag left" aria-hidden="true">{{ beforeLabel() }}</span>
      <span class="tag right" aria-hidden="true">{{ afterLabel() }}</span>
      <span class="divider" aria-hidden="true"><span class="knob"></span></span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        [value]="position()"
        [attr.aria-label]="'Comparar: ' + beforeLabel() + ' y ' + afterLabel()"
        [attr.aria-valuetext]="text()"
        (input)="position.set(+$any($event.target).value)"
      />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .frame {
      position: relative;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border-radius: var(--radius-lg);
      background: var(--surface-2);
      --pos: 50%;
    }
    img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    /* La de "antes" va encima y se recorta por la derecha hasta la raya. */
    .before {
      clip-path: inset(0 calc(100% - var(--pos)) 0 0);
    }
    .tag {
      position: absolute;
      top: var(--space-4);
      padding: 6px 12px;
      border-radius: 999px;
      background: color-mix(in srgb, #10201f 72%, transparent);
      color: #f5f1e8;
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      pointer-events: none;
    }
    .left {
      left: var(--space-4);
    }
    .right {
      right: var(--space-4);
    }
    .divider {
      position: absolute;
      top: 0;
      bottom: 0;
      left: var(--pos);
      width: 2px;
      margin-left: -1px;
      background: #f5f1e8;
      box-shadow: 0 0 0 1px rgb(16 32 31 / 25%);
      pointer-events: none;
    }
    .knob {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 44px;
      height: 44px;
      margin: -22px 0 0 -22px;
      border-radius: 50%;
      background: #f5f1e8;
      box-shadow: 0 2px 10px rgb(16 32 31 / 35%);
    }
    /* Dos puntas de flecha dibujadas con bordes: no hace falta un icono. */
    .knob::before,
    .knob::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 8px;
      height: 8px;
      border: solid #10201f;
      border-width: 0 0 2px 2px;
    }
    .knob::before {
      left: 12px;
      transform: translateY(-50%) rotate(45deg);
    }
    .knob::after {
      right: 12px;
      transform: translateY(-50%) rotate(-135deg);
    }
    /* El control real cubre toda la imagen y es invisible: se arrastra desde cualquier punto. */
    input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      opacity: 0;
      cursor: ew-resize;
      touch-action: pan-y;
    }
    .frame:has(input:focus-visible) .knob {
      outline: 3px solid var(--focus);
      outline-offset: 3px;
    }
    @media (max-width: 860px) {
      .frame {
        aspect-ratio: 4 / 3;
      }
    }
  `,
})
export class BeforeAfterComponent {
  /** Ruta de cada imagen sin el sufijo de ancho (`-800.webp`, `-1600.webp`). */
  readonly before = input.required<string>();
  readonly after = input.required<string>();
  readonly beforeLabel = input.required<string>();
  readonly afterLabel = input.required<string>();
  readonly beforeAlt = input.required<string>();
  readonly afterAlt = input.required<string>();

  /** Cuánto de la imagen de "antes" se ve, en porcentaje desde la izquierda. */
  protected readonly position = signal(50);

  protected srcset(base: string): string {
    return `${base}-800.webp 800w, ${base}-1600.webp 1600w`;
  }

  protected text(): string {
    return sliderText(this.position(), this.beforeLabel().toLowerCase(), this.afterLabel().toLowerCase());
  }
}
