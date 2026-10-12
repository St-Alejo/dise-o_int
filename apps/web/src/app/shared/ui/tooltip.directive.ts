import { DOCUMENT } from '@angular/common';
import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

/** Cuánto hay que quedarse encima con el cursor para que salga (con el teclado sale al momento). */
export const TOOLTIP_DELAY_MS = 350;
const GAP_PX = 8;
let nextId = 0;

/**
 * Dónde va la ayuda: centrada bajo el elemento, o encima si abajo no cabe, y sin salirse por los
 * lados de la ventana. Todo en píxeles de la ventana.
 */
export function tooltipPosition(
  host: { left: number; top: number; width: number; height: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = GAP_PX,
): { left: number; top: number; above: boolean } {
  const below = host.top + host.height + gap;
  const above = below + tip.height > viewport.height && host.top - gap - tip.height >= 0;
  const centred = host.left + host.width / 2 - tip.width / 2;
  return {
    left: Math.round(Math.max(gap, Math.min(centred, viewport.width - tip.width - gap))),
    top: Math.round(above ? host.top - gap - tip.height : below),
    above,
  };
}

/**
 * Ayuda breve de un control, en lugar del `title` del navegador: sale también al llegar con el
 * teclado, no tarda un segundo, se lee con el tema de la app y se anuncia como descripción del
 * control (`aria-describedby`). No sustituye al nombre accesible: un botón de solo icono sigue
 * necesitando su `aria-label`.
 */
@Directive({
  selector: '[appTooltip]',
  host: {
    '(pointerenter)': 'onEnter($event)',
    '(pointerleave)': 'hide()',
    '(pointerdown)': 'hide()',
    '(focus)': 'onFocus()',
    '(blur)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
})
export class TooltipDirective {
  readonly appTooltip = input<string | null | undefined>('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly id = `tooltip-${nextId++}`;
  private tip: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hide());
  }

  protected onEnter(event: PointerEvent): void {
    // Con el dedo no hay "pasar por encima": la ayuda taparía lo que se acaba de tocar.
    if (event.pointerType === 'touch') return;
    this.cancel();
    this.timer = setTimeout(() => this.show(), TOOLTIP_DELAY_MS);
  }

  protected onFocus(): void {
    // Solo al llegar con el teclado: tras un clic, el foco no pide explicación.
    if (this.host.matches(':focus-visible')) this.show();
  }

  protected hide(): void {
    this.cancel();
    if (!this.tip) return;
    this.tip.remove();
    this.tip = null;
    this.host.removeAttribute('aria-describedby');
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private show(): void {
    const text = this.appTooltip()?.trim();
    if (!text || this.tip) return;
    const tip = this.document.createElement('div');
    tip.id = this.id;
    tip.className = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    // Dentro de una ventana modal abierta, lo que cuelga de <body> queda por debajo de ella.
    (this.host.closest('dialog[open]') ?? this.document.body).appendChild(tip);
    const view = this.document.defaultView;
    const at = tooltipPosition(this.host.getBoundingClientRect(), tip.getBoundingClientRect(), {
      width: view?.innerWidth ?? 0,
      height: view?.innerHeight ?? 0,
    });
    tip.style.left = `${at.left}px`;
    tip.style.top = `${at.top}px`;
    this.host.setAttribute('aria-describedby', this.id);
    this.tip = tip;
  }
}
