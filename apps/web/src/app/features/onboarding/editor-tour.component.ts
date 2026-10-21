import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface TourStep {
  title: string;
  text: string;
  /** Solo con cuenta (Recomendar y el asistente necesitan el servidor; la demo no los tiene). */
  account?: boolean;
}

/** Los pasos de la primera visita: lo mínimo para empezar a usar el editor. */
export const TOUR_STEPS: readonly TourStep[] = [
  { title: 'Mueve y gira', text: 'Arrastra un mueble en el 3D o en el plano. Con uno seleccionado, gira su aro o estira sus tiradores.' },
  { title: 'Recomendar', text: 'El botón ✨ Recomendar propone estilo, colores, luz y muebles. Con 👍 y 👎 aprende lo que te gusta; Deshacer vuelve atrás.', account: true },
  { title: 'Fija lo que te gusta', text: 'En "Lo que pediste" pon el candado al piso, al estilo o a la luz: Recomendar ya no los cambia.', account: true },
  { title: 'Pídelo con palabras', text: 'En Asistente IA escribe "piso de baldosa brillante azul claro con verde" o adjunta una foto que te guste y la replico.', account: true },
  { title: 'Cambia el cuarto', text: 'Paredes (W) mueve una pared o desliza una ventana; Pintar (B) cambia el color con un clic; Medir (M) saca una distancia.' },
  { title: 'Míralo de otra forma', text: 'Recorrer te mete dentro a la altura de los ojos, y Luz lo enseña de día, de tarde y de noche.' },
  { title: 'No pierdes nada', text: 'Se guarda solo y todo se deshace con Ctrl+Z. Pulsa ? para ver los atajos, y Exportar o Presentar para enseñarlo.' },
];

const SEEN_KEY = 'interiores.tour.visto';

export function tourSeen(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // sin almacenamiento no se puede recordar: mejor no repetirlo en cada visita
  }
}

export function markTourSeen(storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(SEEN_KEY, '1');
  } catch {
    // Sin almacenamiento, volverá a salir: no pasa nada.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Primeros pasos: la primera vez que se abre el editor, una franja con unos pocos consejos, uno cada
 * vez. No tapa nada ni bloquea: se puede seguir trabajando, avanzar o cerrarla, y no vuelve a salir.
 */
@Component({
  selector: 'app-editor-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <aside class="tour" aria-label="Primeros pasos">
        <p class="count">Primeros pasos · {{ index() + 1 }} de {{ steps().length }}</p>
        <p class="text" aria-live="polite"><strong>{{ step().title }}.</strong> {{ step().text }}</p>
        <div class="actions">
          <button type="button" class="btn btn-sm btn-ghost" (click)="close()">Saltar</button>
          <button type="button" class="btn btn-sm btn-primary" (click)="next()">{{ last() ? 'Entendido' : 'Siguiente' }}</button>
        </div>
      </aside>
    }
  `,
  styles: `
    .tour {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      align-items: center;
      margin-bottom: 12px;
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      background: var(--primary-soft);
      color: var(--text);
    }
    p {
      margin: 0;
    }
    .count {
      flex: none;
      font-size: var(--text-xs);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--primary-strong);
    }
    .text {
      flex: 1 1 320px;
      font-size: var(--text-sm);
    }
    .actions {
      display: flex;
      gap: var(--space-2);
      margin-left: auto;
    }
  `,
})
export class EditorTourComponent {
  /** En la demo sin cuenta se saltan los pasos de lo que solo existe con cuenta. */
  readonly demo = input(false);
  protected readonly steps = computed(() => TOUR_STEPS.filter((s) => !s.account || !this.demo()));
  protected readonly open = signal(!tourSeen());
  protected readonly index = signal(0);
  protected readonly step = computed(() => this.steps()[this.index()]!);
  protected readonly last = computed(() => this.index() === this.steps().length - 1);

  protected next(): void {
    if (this.last()) this.close();
    else this.index.update((i) => i + 1);
  }

  protected close(): void {
    this.open.set(false);
    markTourSeen();
  }
}
