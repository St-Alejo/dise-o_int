import { buildRoomFromSpec } from '@interiores/shared-types';
import { factsOf } from './project-facts.component';

describe('factsOf', () => {
  const shell = buildRoomFromSpec({ shape: 'rect', widthM: 4, depthM: 3.5, heightM: 2.6 });

  it('con cuarto y muebles con precio da superficie, medidas, alto, muebles y total', () => {
    const facts = factsOf(shell, 5, 2580);
    expect(facts.map((f) => f.label)).toEqual(['Superficie', 'Medidas', 'Alto', 'Muebles', 'Total aprox.']);
    expect(facts[0]!.value).toBe('14,0 m²');
    expect(facts[1]!.value).toBe('4,00 × 3,50 m');
    expect(facts[2]!.value).toBe('2,60 m');
    expect(facts[3]!.value).toBe('5');
    expect(facts[4]!.value).toBe('$2,580');
  });

  it('sin cuarto ni precios solo cuenta los muebles', () => {
    expect(factsOf(null, 0, 0)).toEqual([{ icon: 'sofa', label: 'Muebles', value: '0' }]);
  });

  it('una planta en L mide menos que el rectángulo que la envuelve', () => {
    const l = buildRoomFromSpec({ shape: 'L', widthM: 5, depthM: 4, heightM: 2.6 });
    const area = Number(factsOf(l, 0, 0)[0]!.value.replace(' m²', '').replace(',', '.'));
    expect(area).toBeGreaterThan(5);
    expect(area).toBeLessThan(20);
  });
});
