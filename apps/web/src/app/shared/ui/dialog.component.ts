import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';
import { IconComponent } from './icon.component';

let nextId = 0;

/**
 * Ventana modal de la app. Envuelve el `<dialog>` nativo (que ya atrapa el foco, cierra con Escape
 * y devuelve el foco a quien la abrió) y le pone lo que antes repetía cada ventana: el título que
 * la nombra, el botón de cerrar y el cierre al pulsar fuera.
 *
 * El contenido se proyecta tal cual; las clases globales `.modal-body` y `.modal-actions` le dan
 * el cuerpo y la fila de botones.
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <dialog #dialog class="modal" [class.wide]="wide()" [attr.aria-labelledby]="titleId" (close)="closed.emit()">
      <header class="head">
        <h2 [id]="titleId">{{ heading() }}</h2>
        <button type="button" class="icon-btn" aria-label="Cerrar" (click)="close()"><app-icon name="close" /></button>
      </header>
      <ng-content />
    </dialog>
  `,
  styles: `
    dialog.wide {
      width: min(760px, 100vw - 32px);
    }
    .head {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-4) var(--space-3) var(--space-5);
      background: var(--surface);
    }
    h2 {
      margin: 0;
      font-size: var(--text-xl);
    }
    /* El título ya da el aire de arriba: el cuerpo no lo repite. */
    :host ::ng-deep .head + .modal-body {
      padding-top: 0;
    }
  `,
})
export class DialogComponent {
  /** Título visible; también es el nombre accesible de la ventana. */
  readonly heading = input.required<string>();
  /** Para contenido que necesita ancho: un plano, un visor. */
  readonly wide = input(false);
  /** Se cerró, por el botón, por Escape, pulsando fuera o desde el código. */
  readonly closed = output<void>();

  protected readonly titleId = `dialog-title-${nextId++}`;
  /** El clic empezó fuera: soltar fuera tras arrastrar una selección desde dentro no debe cerrar. */
  private pressedOutside = false;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    // Pulsar el fondo oscuro cierra. Es un atajo para el ratón (con el teclado ya está Escape), así
    // que se escucha desde aquí y no como un control más de la plantilla. El fondo es el propio
    // <dialog>; lo de dentro son sus hijos.
    afterNextRender(() => {
      const dialog = this.dialog().nativeElement;
      dialog.addEventListener('pointerdown', (event) => (this.pressedOutside = event.target === dialog));
      dialog.addEventListener('click', (event) => {
        if (this.pressedOutside && event.target === dialog) this.close();
        this.pressedOutside = false;
      });
    });
  }

  get isOpen(): boolean {
    return this.dialog().nativeElement.open;
  }

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) dialog.showModal();
  }

  close(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) dialog.close();
  }
}
