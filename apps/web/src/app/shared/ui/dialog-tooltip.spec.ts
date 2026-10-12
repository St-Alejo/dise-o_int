import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogComponent } from './dialog.component';
import { TOOLTIP_DELAY_MS, TooltipDirective, tooltipPosition } from './tooltip.directive';

@Component({
  imports: [DialogComponent, TooltipDirective],
  template: `
    <button id="help" type="button" appTooltip="Deshace el último cambio">Deshacer</button>
    <button id="mute" type="button" [appTooltip]="null">Sin ayuda</button>
    <app-dialog #dialog heading="Medidas del cuarto" (closed)="closedTimes = closedTimes + 1">
      <div class="modal-body"><button id="inside" type="button">Dentro</button></div>
    </app-dialog>
  `,
})
class Host {
  readonly dialog = viewChild.required<DialogComponent>('dialog');
  closedTimes = 0;
}

describe('DialogComponent', () => {
  beforeEach(() => {
    // jsdom no implementa las ventanas modales: basta con que abran y cierren.
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  });

  const setup = () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance, dialog: el.querySelector('dialog')! };
  };

  it('el título nombra la ventana y el botón de cerrar la cierra y avisa', () => {
    const { host, dialog } = setup();
    const title = dialog.querySelector('h2')!;
    expect(title.textContent).toBe('Medidas del cuarto');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    host.dialog().open();
    expect(host.dialog().isOpen).toBe(true);
    dialog.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!.click();
    expect(host.dialog().isOpen).toBe(false);
    expect(host.closedTimes).toBe(1);
  });

  it('pulsar el fondo cierra; pulsar dentro o soltar fuera tras arrastrar desde dentro, no', () => {
    const { host, dialog, el } = setup();
    const inside = el.querySelector<HTMLElement>('#inside')!;
    const press = (target: HTMLElement) => target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const click = (target: HTMLElement) => target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    host.dialog().open();
    press(inside);
    click(inside);
    expect(host.dialog().isOpen).toBe(true);
    press(inside);
    click(dialog);
    expect(host.dialog().isOpen).toBe(true);
    press(dialog);
    click(dialog);
    expect(host.dialog().isOpen).toBe(false);
  });
});

describe('TooltipDirective', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.tooltip').forEach((t) => t.remove());
  });

  const setup = () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    return { fixture, button: el.querySelector<HTMLButtonElement>('#help')!, mute: el.querySelector<HTMLButtonElement>('#mute')! };
  };
  const enter = (target: HTMLElement, pointerType = 'mouse') => target.dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType }));

  it('sale tras quedarse encima, describe al control y se va al salir', () => {
    const { button } = setup();
    enter(button);
    expect(document.querySelector('.tooltip')).toBeNull();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    const tip = document.querySelector('.tooltip')!;
    expect(tip.textContent).toBe('Deshace el último cambio');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);
    button.dispatchEvent(new Event('pointerleave'));
    expect(document.querySelector('.tooltip')).toBeNull();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('no sale si el cursor se va antes, ni con el dedo, ni sin texto', () => {
    const { button, mute } = setup();
    enter(button);
    button.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2);
    enter(button, 'touch');
    enter(mute);
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2);
    expect(document.querySelector('.tooltip')).toBeNull();
  });

  it('desaparece con el control', () => {
    const { fixture, button } = setup();
    enter(button);
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(document.querySelector('.tooltip')).not.toBeNull();
    fixture.destroy();
    expect(document.querySelector('.tooltip')).toBeNull();
  });
});

describe('tooltipPosition', () => {
  const view = { width: 400, height: 300 };
  const tip = { width: 100, height: 30 };

  it('va centrada debajo; si no cabe, encima', () => {
    expect(tooltipPosition({ left: 150, top: 50, width: 40, height: 20 }, tip, view)).toEqual({ left: 120, top: 78, above: false });
    expect(tooltipPosition({ left: 150, top: 270, width: 40, height: 20 }, tip, view)).toEqual({ left: 120, top: 232, above: true });
  });

  it('no se sale por los lados de la ventana', () => {
    expect(tooltipPosition({ left: 0, top: 50, width: 20, height: 20 }, tip, view).left).toBe(8);
    expect(tooltipPosition({ left: 380, top: 50, width: 20, height: 20 }, tip, view).left).toBe(292);
  });
});
