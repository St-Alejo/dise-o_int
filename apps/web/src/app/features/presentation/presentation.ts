/**
 * Modo presentación (lógica pura): la secuencia de vistas con la que se enseña un cuarto y qué
 * dice cada una. El componente solo las recorre y le pide cada vista al visor.
 */

export interface Slide {
  id: string;
  title: string;
  /** Vista de órbita, o 'walk' para enseñar el cuarto desde dentro. */
  view: 'corner' | 'top' | 'front' | 'walk';
  light: 'day' | 'evening' | 'night';
}

export const SLIDES: readonly Slide[] = [
  { id: 'cuarto', title: 'El cuarto', view: 'corner', light: 'day' },
  { id: 'planta', title: 'Desde arriba', view: 'top', light: 'day' },
  { id: 'tarde', title: 'Por la tarde', view: 'front', light: 'evening' },
  { id: 'noche', title: 'De noche, con sus lámparas', view: 'corner', light: 'night' },
  { id: 'dentro', title: 'Desde dentro', view: 'walk', light: 'evening' },
  { id: 'resumen', title: 'Lo que lleva', view: 'corner', light: 'day' },
];

/** Datos del cuarto que acompañan a las diapositivas. */
export interface PresentationFacts {
  name: string;
  areaM2: number;
  widthM: number;
  depthM: number;
  pieces: number;
  /** Total estimado en dólares; 0 si no hay precios. */
  total: number;
}

const decimal = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** La línea que acompaña al título de cada diapositiva. */
export function captionOf(slide: Slide, facts: PresentationFacts): string {
  switch (slide.id) {
    case 'cuarto':
      return `${facts.name} · ${decimal(facts.areaM2, 1)} m² (${decimal(facts.widthM, 2)} × ${decimal(facts.depthM, 2)} m)`;
    case 'planta':
      return 'La distribución completa: por dónde se entra y cuánto paso queda.';
    case 'tarde':
      return 'El sol entra bajo por la ventana más grande.';
    case 'noche':
      return 'Solo alumbra lo que hay en el cuarto: así se ve si falta una lámpara.';
    case 'dentro':
      return 'A la altura de los ojos, como al entrar por la puerta.';
    default:
      return facts.total > 0 ? `${facts.pieces} piezas · ${money.format(facts.total)} aprox.` : `${facts.pieces} piezas`;
  }
}

/** A qué diapositiva lleva una tecla; 'exit' para salir y null si la tecla no hace nada. */
export function slideAfterKey(key: string, index: number, count = SLIDES.length): number | 'exit' | null {
  switch (key) {
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
    case 'Enter':
      return Math.min(count - 1, index + 1);
    case 'ArrowLeft':
    case 'PageUp':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'Escape':
      return 'exit';
    default:
      return null;
  }
}
