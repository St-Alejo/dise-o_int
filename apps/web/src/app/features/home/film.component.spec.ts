import { CHAPTERS, chapterAt, frameAt, framePath, loadOrder, nearestLoaded, scrollProgress } from './film.component';

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
});
