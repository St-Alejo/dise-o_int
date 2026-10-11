import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RevealDirective } from './reveal.directive';

@Component({ imports: [RevealDirective], template: `<section appReveal>Contenido</section>` })
class Host {}

type Callback = (entries: { isIntersecting: boolean }[]) => void;

describe('RevealDirective', () => {
  const original = { observer: globalThis.IntersectionObserver, media: globalThis.matchMedia };
  let callbacks: Callback[];

  /** Un navegador con observador, sin preferencia de menos movimiento y con el bloque bajo la pantalla. */
  function browser(options: { reduced?: boolean; top?: number } = {}): void {
    callbacks = [];
    globalThis.IntersectionObserver = class {
      constructor(callback: Callback) {
        callbacks.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    } as unknown as typeof IntersectionObserver;
    globalThis.matchMedia = (() => ({ matches: !!options.reduced })) as unknown as typeof matchMedia;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: options.top ?? 5000 } as DOMRect);
  }

  function section(): HTMLElement {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('section')!;
  }

  afterEach(() => {
    globalThis.IntersectionObserver = original.observer;
    globalThis.matchMedia = original.media;
    vi.restoreAllMocks();
  });

  it('sin IntersectionObserver el contenido se ve desde el principio', () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    const el = section();
    expect(el.classList.contains('reveal')).toBe(true);
    expect(el.classList.contains('reveal-pending')).toBe(false);
  });

  it('con menos movimiento no se oculta nada', () => {
    browser({ reduced: true });
    expect(section().classList.contains('reveal-pending')).toBe(false);
  });

  it('lo que ya está en pantalla no se oculta', () => {
    browser({ top: 100 });
    expect(section().classList.contains('reveal-pending')).toBe(false);
  });

  it('lo que está más abajo espera y aparece al entrar en pantalla', () => {
    browser();
    const el = section();
    expect(el.classList.contains('reveal-pending')).toBe(true);
    callbacks[0]!([{ isIntersecting: false }]);
    expect(el.classList.contains('reveal-pending')).toBe(true);
    callbacks[0]!([{ isIntersecting: true }]);
    expect(el.classList.contains('reveal-pending')).toBe(false);
  });
});
