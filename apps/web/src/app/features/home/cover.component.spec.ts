import { STYLE_IDS } from '@interiores/shared-types';
import { HERO_TEMPLATE, activeLife, lifeImage } from './cover.component';
import { STEPS } from './how.component';
import { SHOWCASE, nextFrame } from './vitrina.component';

describe('portada en escenario partido', () => {
  it('manda en la foto el estilo cuyo bloque está más cerca del centro de la pantalla', () => {
    expect(activeLife([100, 700, 1300], 400)).toBe(0);
    expect(activeLife([100, 700, 1300], 650)).toBe(1);
    // Pasado el último, se queda en el último; sin bloques, en el primero.
    expect(activeLife([100, 700, 1300], 5000)).toBe(2);
    expect(activeLife([], 400)).toBe(0);
  });

  it('cada estilo tiene su foto de la misma sala en dos anchos', () => {
    for (const style of STYLE_IDS) {
      const { src, srcset } = lifeImage(style);
      expect(src).toBe(`landing/vida-${style}-1200.webp`);
      expect(srcset).toContain(`landing/vida-${style}-700.webp 700w`);
    }
    expect(HERO_TEMPLATE).toBe('sala-escandinava');
  });
});

describe('vitrina y pasos', () => {
  it('el marco recorre los seis destacados y vuelve al primero', () => {
    expect(SHOWCASE).toHaveLength(6);
    expect(nextFrame(0, 6)).toBe(1);
    expect(nextFrame(5, 6)).toBe(0);
    expect(nextFrame(3, 0)).toBe(0);
  });

  it('cómo funciona se cuenta en tres frases', () => {
    expect(STEPS).toHaveLength(3);
  });
});
