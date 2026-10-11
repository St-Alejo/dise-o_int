import { SLIDES, captionOf, slideAfterKey } from './presentation';

const facts = { name: 'Sala', areaM2: 20, widthM: 5, depthM: 4, pieces: 11, total: 4160 };

describe('presentación', () => {
  it('empieza por el cuarto entero, pasa por dentro y termina con el resumen', () => {
    expect(SLIDES[0]!.id).toBe('cuarto');
    expect(SLIDES.at(-1)!.id).toBe('resumen');
    expect(SLIDES.filter((s) => s.view === 'walk')).toHaveLength(1);
    expect(new Set(SLIDES.map((s) => s.light))).toEqual(new Set(['day', 'evening', 'night']));
  });

  it('la primera y la última diapositiva llevan los datos del cuarto', () => {
    expect(captionOf(SLIDES[0]!, facts)).toBe('Sala · 20,0 m² (5,00 × 4,00 m)');
    expect(captionOf(SLIDES.at(-1)!, facts)).toBe('11 piezas · $4,160 aprox.');
    expect(captionOf(SLIDES.at(-1)!, { ...facts, total: 0 })).toBe('11 piezas');
    for (const slide of SLIDES) expect(captionOf(slide, facts).length).toBeGreaterThan(5);
  });

  it('las flechas avanzan y retroceden sin salirse de los extremos', () => {
    expect(slideAfterKey('ArrowRight', 0)).toBe(1);
    expect(slideAfterKey(' ', 1)).toBe(2);
    expect(slideAfterKey('ArrowRight', SLIDES.length - 1)).toBe(SLIDES.length - 1);
    expect(slideAfterKey('ArrowLeft', 0)).toBe(0);
    expect(slideAfterKey('Home', 3)).toBe(0);
    expect(slideAfterKey('End', 1)).toBe(SLIDES.length - 1);
  });

  it('Escape sale y cualquier otra tecla se ignora', () => {
    expect(slideAfterKey('Escape', 2)).toBe('exit');
    expect(slideAfterKey('a', 2)).toBeNull();
  });
});
