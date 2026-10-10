import { ChangeDetectionStrategy, Component, ElementRef, viewChild } from '@angular/core';

interface ShortcutGroup {
  title: string;
  items: readonly { keys: readonly string[]; does: string }[];
}

/** Todo lo que se puede hacer con el teclado en el editor, agrupado por lo que se está haciendo. */
export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Siempre',
    items: [
      { keys: ['Ctrl', 'Z'], does: 'Deshacer' },
      { keys: ['Ctrl', 'Y'], does: 'Rehacer' },
      { keys: ['?'], does: 'Ver estos atajos' },
    ],
  },
  {
    title: 'Con un mueble seleccionado',
    items: [
      { keys: ['←', '↑', '↓', '→'], does: 'Moverlo 5 cm (con Shift, 25 cm)' },
      { keys: ['R'], does: 'Girarlo 15° (con Shift, al otro lado)' },
      { keys: ['Ctrl', 'D'], does: 'Duplicarlo' },
      { keys: ['Ctrl', 'C'], does: 'Copiarlo' },
      { keys: ['Ctrl', 'V'], does: 'Pegar lo copiado' },
      { keys: ['Supr'], does: 'Quitarlo' },
      { keys: ['F'], does: 'Acercar la cámara a él' },
      { keys: ['Esc'], does: 'Deseleccionar' },
    ],
  },
  {
    title: 'Selección de varios',
    items: [
      { keys: ['Shift', 'clic'], does: 'Añadir o quitar un mueble de la selección' },
      { keys: ['arrastrar'], does: 'En el fondo del plano, dibuja un marco de selección' },
    ],
  },
  {
    title: 'Herramientas del visor 3D',
    items: [
      { keys: ['V'], does: 'Mover muebles (y girar o estirar con el gizmo)' },
      { keys: ['W'], does: 'Paredes, puertas y ventanas' },
      { keys: ['B'], does: 'Pintar una pared o el piso' },
      { keys: ['M'], does: 'Medir entre dos puntos' },
      { keys: ['Alt'], does: 'Al girar con el aro, giro libre (sin pasos de 15°)' },
    ],
  },
  {
    title: 'Recorriendo el cuarto',
    items: [
      { keys: ['W', 'A', 'S', 'D'], does: 'Caminar (también con las flechas)' },
      { keys: ['Shift'], does: 'Correr' },
      { keys: ['doble clic'], does: 'Ir a ese punto' },
      { keys: ['Esc'], does: 'Salir del recorrido' },
    ],
  },
];

@Component({
  selector: 'app-shortcuts-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="modal" aria-labelledby="keys-title">
      <div class="modal-body">
        <h2 id="keys-title">Atajos de teclado</h2>
        <div class="groups">
          @for (group of groups; track group.title) {
            <section>
              <h3>{{ group.title }}</h3>
              <dl>
                @for (item of group.items; track item.does) {
                  <div class="line">
                    <dt>
                      @for (key of item.keys; track $index) {
                        <kbd>{{ key }}</kbd>
                      }
                    </dt>
                    <dd>{{ item.does }}</dd>
                  </div>
                }
              </dl>
            </section>
          }
        </div>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-primary" (click)="dialog.close()">Entendido</button></div>
    </dialog>
  `,
  styles: `
    dialog.modal {
      width: min(760px, 100vw - 32px);
    }
    h2 {
      margin: 0 0 16px;
    }
    h3 {
      margin: 0 0 6px;
      font-family: var(--font);
      font-size: 0.8rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px 28px;
    }
    dl {
      margin: 0;
      display: grid;
      gap: 6px;
    }
    .line {
      display: grid;
      grid-template-columns: 132px 1fr;
      align-items: baseline;
      gap: 10px;
      font-size: 0.88rem;
    }
    dt {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
    }
    dd {
      margin: 0;
    }
    kbd {
      min-width: 1.6em;
      padding: 1px 6px;
      border: 1px solid var(--border);
      border-bottom-width: 2px;
      border-radius: 5px;
      background: var(--surface-2);
      font: inherit;
      font-size: 0.78rem;
      text-align: center;
    }
  `,
})
export class ShortcutsDialogComponent {
  protected readonly groups = SHORTCUTS;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) dialog.showModal();
  }
}
