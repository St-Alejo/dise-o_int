import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { STYLE_IDS } from '@interiores/shared-types';
import { CatalogApi } from '../../core/api/projects.api';
import { StyleShowcaseComponent, piecesFor, styleLink } from './style-showcase.component';

const piece = (id: string, category: string, styleTags: string[], price?: number) => ({ id, name: id, category, styleTags, price }) as never;

describe('styleLink', () => {
  it('con sesión lleva al asistente con el estilo elegido', () => {
    expect(styleLink('industrial', true)).toEqual({ path: '/proyectos/nuevo', query: { estilo: 'industrial' } });
  });

  it('sin sesión pasa por el registro y vuelve al asistente con el estilo', () => {
    expect(styleLink('bohemio', false)).toEqual({ path: '/registro', query: { volver: '/proyectos/nuevo?estilo=bohemio' } });
  });
});

describe('piecesFor', () => {
  const catalog = [
    piece('lampara', 'lighting', ['industrial'], 90),
    piece('sofa-cuero', 'sofa', ['industrial'], 900),
    piece('sofa-generico', 'sofa', ['industrial', 'moderno', 'clasico'], 500),
    piece('mesa-hierro', 'table', ['industrial', 'moderno'], 300),
    piece('silla-sin-precio', 'chair', ['industrial']),
    piece('cama-nordica', 'bed', ['escandinavo'], 700),
  ];

  it('tres piezas del estilo, con precio y de categorías distintas', () => {
    const picked = piecesFor('industrial', catalog);
    expect(picked.map((p) => p.id)).toEqual(['sofa-cuero', 'lampara', 'mesa-hierro']);
  });

  it('si el estilo tiene pocas, las que haya; si no tiene, ninguna', () => {
    expect(piecesFor('escandinavo', catalog).map((p) => p.id)).toEqual(['cama-nordica']);
    expect(piecesFor('bohemio', catalog)).toEqual([]);
  });
});

describe('StyleShowcaseComponent', () => {
  function render(catalog: unknown[] | Error = []) {
    const all = catalog instanceof Error ? () => Promise.reject(catalog) : () => Promise.resolve(catalog);
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: CatalogApi, useValue: { all } }] });
    const fixture = TestBed.createComponent(StyleShowcaseComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, tabs: [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')] };
  }

  it('una pestaña por estilo; la activa enseña su sala y su enlace para empezar', () => {
    const { el, tabs } = render();
    expect(tabs).toHaveLength(STYLE_IDS.length);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('img')!.getAttribute('src')).toBe(`landing/estilo-${STYLE_IDS[0]}.webp`);
    expect(el.querySelector('a.arrow-link')!.getAttribute('href')).toContain('/registro');
  });

  it('la flecha derecha cambia de estilo y lleva el foco', () => {
    const { fixture, el, tabs } = render();
    tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement === tabs[1] || tabs[1]!.getAttribute('tabindex') === '0').toBe(true);
    expect(el.querySelector('img')!.getAttribute('src')).toBe(`landing/estilo-${STYLE_IDS[1]}.webp`);
    // Y la foto de una casa real del mismo estilo cambia con él.
    expect(el.querySelector('.real img')!.getAttribute('src')).toBe(`landing/fotos/${STYLE_IDS[1]}.webp`);
    expect(el.querySelector('.real img')!.getAttribute('alt')).toContain('interior real');
  });

  it('con catálogo lista piezas con precio; si el catálogo falla, la sección sigue sin ellas', async () => {
    const withCatalog = render([piece('sofa-nordico', 'sofa', [STYLE_IDS[0]!], 640)]);
    await withCatalog.fixture.whenStable();
    withCatalog.fixture.detectChanges();
    expect(withCatalog.el.querySelector('.pieces')!.textContent).toContain('sofa-nordico');
    expect(withCatalog.el.querySelector('.pieces')!.textContent).toContain('$640');

    TestBed.resetTestingModule();
    const broken = render(new Error('sin red'));
    await broken.fixture.whenStable();
    broken.fixture.detectChanges();
    expect(broken.el.querySelector('.pieces')).toBeNull();
    expect(broken.tabs).toHaveLength(STYLE_IDS.length);
  });
});
