import { ChangeDetectionStrategy, Component, ElementRef, computed, signal, viewChildren } from '@angular/core';
import { IconComponent, type IconName } from '../../shared/ui/icon.component';

interface Shot {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface Feature {
  id: string;
  label: string;
  icon: IconName;
  title: string;
  text: string;
  points: readonly string[];
  /** Teclas que sirven en esa parte de la app. */
  keys: readonly { keys: string; does: string }[];
  shots: readonly Shot[];
}

/** Lo que se enseña en la galería: capturas de la app real, una pestaña por tema. */
export const FEATURES: readonly Feature[] = [
  {
    id: 'editar',
    label: 'Editar en 3D',
    icon: 'cube',
    title: 'El plano y el 3D, lado a lado',
    text: 'Lo que mueves en uno se mueve en el otro. Cada pieza se alinea con las demás, se pega a las paredes y te dice cuánto espacio le queda.',
    points: [
      'Un aro para girar el mueble y tiradores para cambiarle el tamaño.',
      'Selecciona varios con Mayús y alinéalos o repártelos.',
      'Cada cambio se guarda solo y se puede deshacer.',
    ],
    keys: [
      { keys: 'R', does: 'girar' },
      { keys: 'Supr', does: 'quitar' },
      { keys: 'Ctrl + Z', does: 'deshacer' },
    ],
    shots: [
      {
        src: 'landing/g-editar.webp',
        alt: 'El editor con el plano a la izquierda, el cuarto en 3D en el centro con una alfombra seleccionada y sus cotas, y a la derecha el panel con sus medidas y acciones.',
        width: 1200,
        height: 721,
      },
    ],
  },
  {
    id: 'recorrer',
    label: 'Recorrer',
    icon: 'walk',
    title: 'Camina por tu cuarto antes de comprar nada',
    text: 'La cámara baja a la altura de tus ojos y caminas sin atravesar paredes ni muebles. Sin salir del recorrido puedes mover, girar y pintar.',
    points: [
      'Arrastra un mueble para moverlo; arrastra el fondo para mirar.',
      'Doble clic en el piso para ir hasta ese punto.',
      'El enlace que compartes también se puede recorrer.',
    ],
    keys: [
      { keys: 'W A S D', does: 'caminar' },
      { keys: 'Q E', does: 'girar la vista' },
      { keys: 'Esc', does: 'salir' },
    ],
    shots: [
      {
        src: 'landing/g-recorrer.webp',
        alt: 'Una sala vista desde dentro, a la altura de los ojos: un sofá gris en L bajo la ventana, una butaca de cuero y una lámpara colgante.',
        width: 844,
        height: 675,
      },
    ],
  },
  {
    id: 'luz',
    label: 'Día y noche',
    icon: 'moon',
    title: 'Las lámparas que colocas alumbran de verdad',
    text: 'De día el sol entra por la ventana más grande. De noche el cuarto queda solo con su propia luz, para que veas si hace falta otra lámpara.',
    points: [
      'Lámparas de pie, de mesa y colgantes.',
      'Sombras suaves y penumbra en los rincones.',
      'Las pantallas se encienden al pasar a modo noche.',
    ],
    keys: [],
    shots: [
      { src: 'landing/hero-L.webp', alt: 'Una sala en forma de L vista desde arriba con luz de día.', width: 844, height: 675 },
      {
        src: 'landing/g-noche.webp',
        alt: 'La misma sala de noche, iluminada por su lámpara colgante y su lámpara de pie.',
        width: 844,
        height: 675,
      },
    ],
  },
  {
    id: 'plano',
    label: 'Plano y medidas',
    icon: 'ruler',
    title: 'Un plano con cotas que puedes corregir',
    text: 'Cada pared lleva su medida y cada mueble, la distancia a las paredes. Mueve una pared, desliza una ventana o añade una esquina y el 3D se rehace.',
    points: [
      'Formas rectangular, en L, en T y en U.',
      'Añade, mueve y cambia de tamaño puertas y ventanas.',
      'Exporta el plano para imprimirlo.',
    ],
    keys: [
      { keys: 'W', does: 'paredes' },
      { keys: 'M', does: 'medir' },
    ],
    shots: [
      {
        src: 'landing/g-plano.webp',
        alt: 'El plano de una sala en L con la medida de cada pared, los muebles con su nombre y las distancias de la alfombra seleccionada a las paredes.',
        width: 1200,
        height: 721,
      },
    ],
  },
  {
    id: 'pintar',
    label: 'Pintar y materiales',
    icon: 'palette',
    title: 'Un clic en la pared y cambia de color',
    text: 'Elige la herramienta de pintar y toca una pared, el piso, el techo o un mueble. Los pisos tienen madera, cerámica y piedra con su textura.',
    points: [
      'Pinta una sola pared o todas a la vez.',
      'Cambia el material de cada mueble: tela, cuero, madera, metal.',
      'Pruébalo con la luz de día y la de noche.',
    ],
    keys: [{ keys: 'B', does: 'pintar' }],
    shots: [
      {
        src: 'landing/g-pintar.webp',
        alt: 'Un dormitorio de paredes color terracota con la paleta de colores abierta sobre una pared.',
        width: 844,
        height: 675,
      },
    ],
  },
];

/** La pestaña a la que lleva una tecla desde la pestaña `index`, o null si la tecla no navega. */
export function tabAfterKey(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Galería por pestañas de lo que hace la app, con capturas reales. */
@Component({
  selector: 'app-feature-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="tabs" role="tablist" aria-label="Lo que puedes hacer">
      @for (f of features; track f.id; let i = $index) {
        <button
          #tab
          type="button"
          role="tab"
          class="tab"
          [id]="'feature-tab-' + f.id"
          [attr.aria-selected]="i === index()"
          [attr.aria-controls]="'feature-panel-' + f.id"
          [attr.tabindex]="i === index() ? 0 : -1"
          (click)="index.set(i)"
          (keydown)="onKey($event, i)"
        >
          <app-icon [name]="f.icon" /> {{ f.label }}
        </button>
      }
    </div>

    <div class="panel" role="tabpanel" [id]="'feature-panel-' + current().id" [attr.aria-labelledby]="'feature-tab-' + current().id" tabindex="0">
      <div class="shots" [class.pair]="current().shots.length > 1">
        @for (shot of current().shots; track shot.src) {
          <img [src]="shot.src" [alt]="shot.alt" [attr.width]="shot.width" [attr.height]="shot.height" loading="lazy" decoding="async" />
        }
      </div>
      <div class="copy">
        <h3>{{ current().title }}</h3>
        <p class="muted">{{ current().text }}</p>
        <ul class="points">
          @for (point of current().points; track point) {
            <li><app-icon name="check" /> {{ point }}</li>
          }
        </ul>
        @if (current().keys.length) {
          <p class="keys">
            @for (k of current().keys; track k.keys) {
              <span><kbd>{{ k.keys }}</kbd> {{ k.does }}</span>
            }
          </p>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .tabs {
      display: flex;
      gap: var(--space-2);
      overflow-x: auto;
      padding-bottom: var(--space-2);
      margin-bottom: var(--space-4);
      scrollbar-width: thin;
    }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      flex: none;
      min-height: 44px;
      padding: 0 var(--space-4);
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      font: inherit;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition:
        background 0.15s var(--ease),
        color 0.15s var(--ease);
    }
    .tab:hover {
      color: var(--text);
      border-color: var(--primary);
    }
    .tab[aria-selected='true'] {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--on-primary);
    }
    .panel {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: var(--space-6);
      align-items: center;
      padding: var(--space-5);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }
    .shots {
      display: grid;
      gap: var(--space-3);
    }
    .shots.pair {
      grid-template-columns: 1fr 1fr;
    }
    img {
      width: 100%;
      height: auto;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface-2);
    }
    .copy {
      display: grid;
      gap: var(--space-3);
      align-content: center;
    }
    h3 {
      margin: 0;
      font-size: var(--text-xl);
    }
    p {
      margin: 0;
    }
    .points {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .points li {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-2);
    }
    .points app-icon {
      color: var(--primary);
      margin-top: 0.2em;
    }
    .keys {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    kbd {
      font: inherit;
      font-weight: 600;
      color: var(--text);
      padding: 2px 8px;
      border-radius: 6px;
      border: 1px solid var(--border);
      border-bottom-width: 2px;
      background: var(--surface-2);
    }
    @media (max-width: 900px) {
      .panel {
        grid-template-columns: 1fr;
        padding: var(--space-4);
      }
    }
  `,
})
export class FeatureGalleryComponent {
  protected readonly features = FEATURES;
  protected readonly index = signal(0);
  protected readonly current = computed(() => FEATURES[this.index()]!);
  private readonly tabs = viewChildren<ElementRef<HTMLButtonElement>>('tab');

  /** Flechas, Inicio y Fin cambian de pestaña y llevan el foco con ellas. */
  protected onKey(event: KeyboardEvent, from: number): void {
    const next = tabAfterKey(event.key, from, FEATURES.length);
    if (next === null) return;
    event.preventDefault();
    this.index.set(next);
    this.tabs()[next]?.nativeElement.focus();
  }
}
