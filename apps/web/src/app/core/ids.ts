/**
 * Ids aleatorios para piezas nuevas de la escena. No usa `crypto.randomUUID()`: solo existe en
 * contextos seguros (HTTPS o localhost) y la app también se abre por HTTP desde otra máquina de
 * la red (p. ej. un celular apuntando a la IP del computador). `getRandomValues` existe siempre.
 */
export function newPlacementId(prefix = 'u'): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
