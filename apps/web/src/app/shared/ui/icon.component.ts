import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Trazos de los iconos de la app, en una rejilla de 24 × 24 y dibujados solo con línea. Un icono
 * es un `path`: añadir uno es añadir una entrada aquí. Sustituyen a los emojis, que cambian de
 * aspecto según el sistema y no siguen el color del texto ni el tema oscuro.
 */
const ICONS = {
  // Acciones
  save: 'M5 3h11l3 3v15H5z M8 3v6h7V3 M8 21v-7h8v7',
  history: 'M12 7v5l3 2 M3.5 9a9 9 0 1 1-.5 3 M3 4v5h5',
  share: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
  download: 'M12 4v11 M7 11l5 5 5-5 M5 20h14',
  undo: 'M8 5 3 10l5 5 M3 10h11a5.5 5.5 0 0 1 0 11h-3',
  redo: 'M16 5l5 5-5 5 M21 10H10a5.5 5.5 0 0 0 0 11h3',
  shuffle: 'M3 7h4l10 10h4 M3 17h4l3-3 M14 10l3-3h4 M18 4l3 3-3 3 M18 14l3 3-3 3',
  rotateLeft: 'M4 5v5h5 M4.6 14a8 8 0 1 0 1.9-7.6L4 10',
  rotateRight: 'M20 5v5h-5 M19.4 14a8 8 0 1 1-1.9-7.6L20 10',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 7.5-2',
  swap: 'M7 4 3 8l4 4 M3 8h14 M17 12l4 4-4 4 M21 16H7',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  cart: 'M3 4h2l2.5 11h10L20 7H6.5 M9 19.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z M17 19.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z',
  phone: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M11 18h2',
  back: 'M19 12H5 M11 6l-6 6 6 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  // Cuarto y vistas
  ruler: 'M3 17 17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2',
  palette:
    'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5S14.5 15 16 15h2a3 3 0 0 0 3-3c0-5-4-9-9-9z M7.5 11.5h.01 M10 7.5h.01 M14.5 7.5h.01',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9',
  door: 'M6 21V4h10v17 M4 21h16 M13 12h.01',
  window: 'M4 4h16v16H4z M12 4v16 M4 12h16',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  // Categorías del catálogo
  sofa: 'M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3 M3 12a2 2 0 0 1 4 0v3h10v-3a2 2 0 0 1 4 0v5H3z M6 17v2 M18 17v2',
  table: 'M3 8h18 M5 8v11 M19 8v11 M5 13h14',
  chair: 'M7 3v9h10V3 M7 12v9 M17 12v9 M7 16h10',
  bed: 'M3 21V7 M3 12h18v9 M3 18h18 M7 12V9h5v3',
  storage: 'M5 3h14v18H5z M12 3v18 M9.5 11v2 M14.5 11v2',
  lamp: 'M9 3h6l3 8H6z M12 11v9 M8 20h8',
  plant: 'M12 21v-8 M12 13c0-4-3-6-7-6 0 4 3 6 7 6z M12 11c0-4 3-7 7-7 0 4-3 7-7 7z M8 21h8',
  kitchen: 'M4 10h16v10H4z M4 14h16 M8 6v4 M12 5v5 M16 6v4',
  bath: 'M3 12h18v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z M6 12V6a2 2 0 0 1 4 0 M7 19v2 M17 19v2',
  picture: 'M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15 9h.01',
  curtain: 'M4 4h16 M6 4v16 M18 4v16 M6 4c0 6 2 10 5 12 M18 4c0 6-2 10-5 12',
  tv: 'M3 5h18v12H3z M8 21h8 M12 17v4',
} as const;

export type IconName = keyof typeof ICONS;

/** Icono de línea que hereda el color y el tamaño del texto que lo rodea. Es decorativo: el nombre lo da el texto o el `aria-label` del control. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path [attr.d]="path()" /></svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      vertical-align: -0.18em;
    }
    svg {
      width: 1.15em;
      height: 1.15em;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  protected readonly path = computed(() => ICONS[this.name()]);
}
