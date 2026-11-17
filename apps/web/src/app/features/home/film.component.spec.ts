import { CHAPTERS, approach, chapterAt, evenPace, filmSet, frameAt, frameAtPace, framePath, loadOrder, nearestLoaded, progressAtFrame, scrollProgress } from './film.component';

describe('película de la portada', () => {
  it('el progreso va de 0 al entrar al tramo fijo a 1 al salir', () => {
    expect(scrollProgress(100, 8000, 1000)).toBe(0);
    expect(scrollProgress(-3500, 8000, 1000)).toBe(0.5);
    expect(scrollProgress(-9000, 8000, 1000)).toBe(1);
    expect(scrollProgress(0, 800, 1000)).toBe(0);
  });

  it('cada progreso cae en un fotograma, sin salirse de la película', () => {
    expect(frameAt(0, 180)).toBe(0);
    expect(frameAt(1, 180)).toBe(179);
    expect(frameAt(0.5, 180)).toBe(90);
    expect(frameAt(2, 180)).toBe(179);
    expect(frameAt(0.5, 0)).toBe(0);
  });

  it('los capítulos van en orden y el primero empieza en 0', () => {
    expect(CHAPTERS[0]!.from).toBe(0);
    CHAPTERS.slice(1).forEach((c, i) => expect(c.from).toBeGreaterThan(CHAPTERS[i]!.from));
    expect(chapterAt(0, CHAPTERS)).toBe(0);
    expect(chapterAt(0.5, CHAPTERS)).toBe(3);
    expect(chapterAt(1, CHAPTERS)).toBe(CHAPTERS.length - 1);
  });

  it('pide todos los fotogramas una vez, primero uno de cada ocho y el último', () => {
    const order = loadOrder(20);
    expect(new Set(order).size).toBe(20);
    expect(order.slice(0, 4)).toEqual([0, 19, 8, 16]);
    expect(loadOrder(0)).toEqual([]);
  });

  it('mientras llega el fotograma pedido muestra el cargado más cercano', () => {
    const loaded = [true, false, false, false, true, false];
    expect(nearestLoaded(2, loaded)).toBe(0);
    expect(nearestLoaded(3, loaded)).toBe(4);
    expect(nearestLoaded(4, loaded)).toBe(4);
    expect(nearestLoaded(1, [false, false])).toBe(-1);
  });

  it('los fotogramas se nombran con tres cifras', () => {
    expect(framePath('desk', 7)).toBe('cine/desk/f007.webp');
  });

  it('en vertical se usa la película del celular', () => {
    expect(filmSet(true)).toBe('mob');
    expect(filmSet(false)).toBe('desk');
  });

  it('con ritmo parejo cada progreso cae entre dos fotogramas y dice cuánto se funden', () => {
    const pace = evenPace(5);
    expect(pace).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(frameAtPace(0, pace)).toBe(0);
    expect(frameAtPace(0.375, pace)).toBeCloseTo(1.5);
    expect(frameAtPace(1, pace)).toBe(4);
    expect(frameAtPace(-1, pace)).toBe(0);
    expect(frameAtPace(0.5, [0])).toBe(0);
  });

  it('un cambio brusco con más ritmo se lleva más scroll', () => {
    // El paso del fotograma 1 al 2 ocupa la mitad del recorrido.
    const pace = [0, 0.25, 0.75, 1];
    expect(frameAtPace(0.5, pace)).toBeCloseTo(1.5);
    expect(frameAtPace(0.3, pace)).toBeCloseTo(1.1);
    expect(progressAtFrame(2, pace)).toBe(0.75);
    expect(progressAtFrame(9, pace)).toBe(1);
  });

  it('el fotograma mostrado alcanza al pedido sin saltar', () => {
    const half = approach(0, 10, 0.1);
    expect(half).toBeGreaterThan(5);
    expect(half).toBeLessThan(10);
    expect(approach(9.995, 10, 0.016)).toBe(10);
    expect(approach(3, 10, 0)).toBe(3);
  });
});
