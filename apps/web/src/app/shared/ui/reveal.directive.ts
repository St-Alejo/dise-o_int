import { Directive, ElementRef, OnDestroy, inject } from '@angular/core';

/**
 * Hace aparecer un bloque cuando entra en pantalla. Solo pone y quita una clase (`reveal-pending`);
 * el movimiento es CSS. El contenido se ve desde el principio si ya está a la vista, si el
 * navegador no tiene `IntersectionObserver` o si la persona pidió menos movimiento.
 */
@Directive({ selector: '[appReveal]', host: { class: 'reveal' } })
export class RevealDirective implements OnDestroy {
  private readonly el: HTMLElement = inject(ElementRef).nativeElement;
  private observer: IntersectionObserver | null = null;

  constructor() {
    if (typeof IntersectionObserver === 'undefined' || typeof matchMedia === 'undefined') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (this.el.getBoundingClientRect().top < innerHeight) return;
    this.el.classList.add('reveal-pending');
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) this.show();
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    this.observer.observe(this.el);
  }

  private show(): void {
    this.el.classList.remove('reveal-pending');
    this.observer?.disconnect();
    this.observer = null;
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
