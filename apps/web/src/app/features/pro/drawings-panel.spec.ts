import { sectionAcross } from './drawings-panel.component';

describe('sectionAcross', () => {
  const bounds = { minX: 0, maxX: 4, minZ: 0, maxZ: 3 };

  it('un corte horizontal cruza el cuarto de lado a lado y mira hacia el fondo', () => {
    const line = sectionAcross(bounds, 'z', 1.5, false);
    expect(line.a).toEqual({ x: -1, z: 1.5 });
    expect(line.b).toEqual({ x: 5, z: 1.5 });
  });

  it('mirar hacia el otro lado invierte la línea', () => {
    const line = sectionAcross(bounds, 'x', 2, true);
    expect(line.a).toEqual({ x: 2, z: -1 });
    expect(line.b).toEqual({ x: 2, z: 4 });
  });
});
