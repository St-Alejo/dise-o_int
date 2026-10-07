import { describe, expect, it } from 'vitest';
import { bodiesCollide, bodyOf, firstCollision, layerOf, type Body } from './collision.js';

const body = (over: Partial<Body> & Pick<Body, 'id'>): Body => ({
  position: { x: 0, y: 0, z: 0 },
  rotationY: 0,
  dims: { x: 1, y: 1, z: 1 },
  layer: 'floor',
  ...over,
});

describe('colisión 3D por capas', () => {
  it('muebles de piso que se solapan en planta chocan; separados no', () => {
    expect(bodiesCollide(body({ id: 'a' }), body({ id: 'b', position: { x: 0.5, y: 0, z: 0 } }))).toBe(true);
    expect(bodiesCollide(body({ id: 'a' }), body({ id: 'b', position: { x: 2, y: 0, z: 0 } }))).toBe(false);
  });

  it('una silla cabe bajo la mesa (y al revés), pero dos sillas no se solapan', () => {
    const table = body({ id: 't', dims: { x: 1.6, y: 0.75, z: 0.9 }, allowsUnder: true });
    const chair = body({ id: 'c', position: { x: 0, y: 0, z: 0.4 }, dims: { x: 0.45, y: 0.86, z: 0.5 }, tucksUnder: true });
    expect(bodiesCollide(chair, table)).toBe(false);
    expect(bodiesCollide(table, chair)).toBe(false);
    expect(bodiesCollide(chair, { ...chair, id: 'c2' })).toBe(true);
    // Un sofá no "cabe debajo" de la mesa.
    expect(bodiesCollide(body({ id: 's', dims: { x: 2, y: 0.8, z: 0.9 } }), table)).toBe(true);
  });

  it('en la pared, dos objetos a distinta altura no chocan; a la misma, sí', () => {
    const art = body({ id: 'a', layer: 'wall', position: { x: 1, y: 1.3, z: 0.02 }, dims: { x: 0.8, y: 0.6, z: 0.03 } });
    const shelf = body({ id: 's', layer: 'wall', position: { x: 1, y: 0.6, z: 0.1 }, dims: { x: 0.8, y: 0.2, z: 0.22 } });
    expect(bodiesCollide(art, shelf)).toBe(false);
    expect(bodiesCollide(art, { ...art, id: 'b', position: { x: 1.3, y: 1.4, z: 0.02 } })).toBe(true);
  });

  it('capas distintas nunca chocan (alfombra bajo el sofá, cuadro sobre el sofá)', () => {
    const sofa = body({ id: 's' });
    expect(bodiesCollide(sofa, body({ id: 'r', layer: 'rug', dims: { x: 3, y: 0.01, z: 2 } }))).toBe(false);
    expect(bodiesCollide(sofa, body({ id: 'w', layer: 'wall', position: { x: 0, y: 1.2, z: 0 } }))).toBe(false);
  });

  it('objetos de superficie chocan solo sobre el mismo soporte', () => {
    const lamp = body({ id: 'l', layer: 'surface', supportId: 'mesa1', dims: { x: 0.3, y: 0.5, z: 0.3 } });
    expect(bodiesCollide(lamp, { ...lamp, id: 'v' })).toBe(true);
    expect(bodiesCollide(lamp, { ...lamp, id: 'v', supportId: 'mesa2' })).toBe(false);
  });

  it('un cuerpo no choca consigo mismo; firstCollision devuelve el primero que choca', () => {
    const a = body({ id: 'a' });
    expect(bodiesCollide(a, a)).toBe(false);
    expect(firstCollision(a, [a, body({ id: 'x', position: { x: 5, y: 0, z: 0 } }), body({ id: 'y' })])?.id).toBe('y');
  });

  it('bodyOf usa las medidas propias de la pieza y la capa del montaje', () => {
    const item = { mount: 'floor' as const, subcategory: 'rug', dimensionsM: { x: 2, y: 0.01, z: 1.4 } };
    expect(layerOf(item)).toBe('rug');
    const b = bodyOf({ id: 'p', position: { x: 0, y: 0, z: 0 }, rotationY: 0, dimensionsM: { x: 3, y: 0.01, z: 2 } }, item);
    expect(b.dims.x).toBe(3);
    expect(layerOf({ mount: 'wall' })).toBe('wall');
  });
});
