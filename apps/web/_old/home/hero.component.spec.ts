import { HERO_FRAMES, heroFrameAt } from './hero.component';

describe('recorrido del encabezado', () => {
  it('empieza en la sala, funde cuadro a cuadro y termina en el plano', () => {
    const n = HERO_FRAMES.length;
    expect(HERO_FRAMES[0]!.id).toBe('sala');
    expect(HERO_FRAMES.at(-1)!.base).toBeNull();
    expect(heroFrameAt(0, n)).toEqual({ index: 0, mix: 0 });
    expect(heroFrameAt(1 / (n - 1) / 2, n)).toEqual({ index: 0, mix: 0.5 });
    expect(heroFrameAt(1, n)).toEqual({ index: n - 1, mix: 0 });
    // Fuera de rango se queda en los extremos.
    expect(heroFrameAt(-3, n)).toEqual({ index: 0, mix: 0 });
    expect(heroFrameAt(7, n)).toEqual({ index: n - 1, mix: 0 });
  });
});
