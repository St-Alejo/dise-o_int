import { TestBed } from '@angular/core/testing';
import { FEATURES, FeatureGalleryComponent, tabAfterKey } from './feature-gallery.component';

describe('tabAfterKey', () => {
  it('las flechas avanzan y retroceden dando la vuelta', () => {
    expect(tabAfterKey('ArrowRight', 0, 5)).toBe(1);
    expect(tabAfterKey('ArrowRight', 4, 5)).toBe(0);
    expect(tabAfterKey('ArrowLeft', 0, 5)).toBe(4);
  });

  it('Inicio y Fin van a los extremos; otra tecla no navega', () => {
    expect(tabAfterKey('Home', 3, 5)).toBe(0);
    expect(tabAfterKey('End', 1, 5)).toBe(4);
    expect(tabAfterKey('Enter', 1, 5)).toBeNull();
  });
});

describe('FeatureGalleryComponent', () => {
  function render() {
    const fixture = TestBed.createComponent(FeatureGalleryComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, tabs: [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')] };
  }

  it('cada pestaña tiene captura con texto alternativo', () => {
    for (const feature of FEATURES) {
      expect(feature.shots.length).toBeGreaterThan(0);
      for (const shot of feature.shots) expect(shot.alt.length).toBeGreaterThan(20);
    }
  });

  it('solo la pestaña activa es tabulable y su panel la nombra', () => {
    const { el, tabs } = render();
    expect(tabs).toHaveLength(FEATURES.length);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
    expect(el.querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
  });

  it('la flecha derecha cambia de pestaña, de panel y de foco', () => {
    const { fixture, el, tabs } = render();
    document.body.appendChild(el);
    tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('h3')!.textContent).toBe(FEATURES[1]!.title);
    expect(document.activeElement).toBe(tabs[1]);
    el.remove();
  });
});
