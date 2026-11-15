import { TestBed } from '@angular/core/testing';
import { BeforeAfterComponent, sliderText } from './before-after.component';

describe('sliderText', () => {
  it('dice cuánto se ve de cada imagen', () => {
    expect(sliderText(50, 'vacío', 'amueblado')).toBe('50 % vacío, 50 % amueblado');
    expect(sliderText(30.4, 'vacío', 'amueblado')).toBe('30 % vacío, 70 % amueblado');
  });

  it('en los extremos nombra solo la que queda', () => {
    expect(sliderText(0, 'vacío', 'amueblado')).toBe('Solo amueblado');
    expect(sliderText(100, 'vacío', 'amueblado')).toBe('Solo vacío');
  });
});

describe('BeforeAfterComponent', () => {
  function render() {
    const fixture = TestBed.createComponent(BeforeAfterComponent);
    const set = fixture.componentRef.setInput.bind(fixture.componentRef);
    set('before', 'landing/cuarto-vacio');
    set('after', 'landing/cuarto-tarde');
    set('beforeLabel', 'Vacío');
    set('afterLabel', 'Amueblado');
    set('beforeAlt', 'El cuarto vacío.');
    set('afterAlt', 'El cuarto amueblado.');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, range: el.querySelector<HTMLInputElement>('input[type=range]')!, frame: el.querySelector<HTMLElement>('.frame')! };
  }

  it('es un control de rango con nombre y las dos imágenes con su texto alternativo', () => {
    const { el, range } = render();
    expect(range.getAttribute('aria-label')).toBe('Comparar: Vacío y Amueblado');
    expect(range.getAttribute('aria-valuetext')).toBe('50 % vacío, 50 % amueblado');
    expect([...el.querySelectorAll('img')].map((img) => img.alt)).toEqual(['El cuarto amueblado.', 'El cuarto vacío.']);
    expect(el.querySelector('img')!.getAttribute('srcset')).toContain('cuarto-tarde-800.webp 800w');
  });

  it('mover el control corre la raya y actualiza lo que se lee', () => {
    const { fixture, range, frame } = render();
    range.value = '80';
    range.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(frame.style.getPropertyValue('--pos')).toBe('80%');
    expect(range.getAttribute('aria-valuetext')).toBe('80 % vacío, 20 % amueblado');
  });
});
