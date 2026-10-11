import { choicesOf } from './wizard-summary';
import type { WizardData } from './wizard.store';

const data = (over: Partial<WizardData>): WizardData => ({
  source: 'manual',
  photo: null,
  shape: 'L',
  widthM: 5,
  depthM: 4.25,
  heightM: 2.6,
  notchWidthM: null,
  notchDepthM: null,
  name: 'Mi cuarto',
  roomType: 'living',
  styles: ['moderno'],
  ...over,
});

describe('choicesOf', () => {
  it('en el primer paso no hay nada que resumir', () => {
    expect(choicesOf(data({}), 0)).toEqual([]);
  });

  it('en el segundo paso recuerda de dónde sale el cuarto', () => {
    expect(choicesOf(data({}), 1)).toEqual([{ label: 'Empiezas', value: 'sin foto' }]);
    expect(choicesOf(data({ source: 'photo' }), 1)).toEqual([{ label: 'Empiezas', value: 'con una foto' }]);
  });

  it('en el último añade la forma y las medidas con coma decimal', () => {
    expect(choicesOf(data({}), 2).slice(1)).toEqual([
      { label: 'Forma', value: 'En L' },
      { label: 'Medidas', value: '5 × 4,25 × 2,6 m' },
    ]);
  });

  it('con foto y sin medidas dice que las estima la foto', () => {
    const choices = choicesOf(data({ source: 'photo', shape: 'auto', widthM: null, depthM: null, heightM: null }), 2);
    expect(choices.map((c) => c.value)).toEqual(['con una foto', 'según la foto', 'las estima la foto']);
  });
});
