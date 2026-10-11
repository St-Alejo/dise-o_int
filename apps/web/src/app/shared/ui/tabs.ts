/**
 * Teclado de un grupo de pestañas (patrón de WAI-ARIA): lo comparten todas las que hay en la app.
 */

/** La pestaña a la que lleva una tecla desde la pestaña `index`, o null si la tecla no navega. */
export function tabAfterKey(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
