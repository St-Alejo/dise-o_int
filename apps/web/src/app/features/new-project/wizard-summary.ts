import { ROOM_TEMPLATES } from '@interiores/shared-types';
import type { WizardData } from './wizard.store';

export interface WizardChoice {
  label: string;
  value: string;
}

const metres = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',');

/**
 * Lo que ya se eligió en los pasos anteriores al actual (`index`), para tenerlo a la vista mientras
 * se completa el siguiente. En el primer paso todavía no hay nada que resumir.
 */
export function choicesOf(data: WizardData, index: number): WizardChoice[] {
  const choices: WizardChoice[] = [];
  if (index >= 1 && data.source) {
    choices.push({ label: 'Empiezas', value: data.source === 'photo' ? 'con una foto' : 'sin foto' });
  }
  if (index >= 2) {
    choices.push({ label: 'Forma', value: data.shape === 'auto' ? 'según la foto' : ROOM_TEMPLATES[data.shape].label });
    const { widthM, depthM, heightM } = data;
    choices.push({
      label: 'Medidas',
      value: widthM !== null && depthM !== null && heightM !== null ? `${metres(widthM)} × ${metres(depthM)} × ${metres(heightM)} m` : 'las estima la foto',
    });
  }
  return choices;
}
