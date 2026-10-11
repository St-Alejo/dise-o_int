import { readFileSync } from 'node:fs';

/**
 * La paleta vive en `styles.scss`. Esta prueba la lee y comprueba que cada pareja de texto y fondo
 * que usa la interfaz llega al contraste de WCAG 2.1 AA en los dos temas: cambiar un color sin
 * mirar su pareja rompe la lectura sin que nada más avise.
 */
const scss = readFileSync('src/styles.scss', 'utf8');

function tokens(block: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) found[name!] = value!;
  return found;
}

const light = tokens(scss.slice(scss.indexOf(':root {'), scss.indexOf('@mixin dark-tokens')));
const dark = { ...light, ...tokens(scss.slice(scss.indexOf('@mixin dark-tokens'), scss.indexOf('@media (prefers-color-scheme: dark)'))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Texto sobre fondo: 4.5:1. */
const TEXT_PAIRS = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-2'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['text-muted', 'surface-2'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primary', 'surface-2'],
  ['on-primary', 'primary'],
  ['on-primary', 'primary-strong'],
  ['primary-strong', 'primary-soft'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accent-strong', 'accent-soft'],
  ['danger', 'surface'],
  ['danger', 'danger-soft'],
  ['warning', 'surface'],
  ['warning', 'warning-soft'],
  ['success', 'surface'],
  ['success', 'success-soft'],
  ['text', 'tint-1'],
  ['text-muted', 'tint-1'],
  ['text-muted', 'tint-2'],
  ['text-muted', 'tint-3'],
] as const;

/** El anillo de foco se dibuja separado del control, sobre el fondo: 3:1. */
const FOCUS_BACKGROUNDS = ['bg', 'surface', 'surface-2'] as const;

describe.each([
  ['claro', light],
  ['oscuro', dark],
])('paleta del tema %s', (_name, theme) => {
  it('define todos los colores que se comprueban', () => {
    for (const name of new Set([...TEXT_PAIRS.flat(), ...FOCUS_BACKGROUNDS, 'focus'])) expect(theme[name], name).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(TEXT_PAIRS)('%s se lee sobre %s', (fg, bg) => {
    expect(contrast(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(FOCUS_BACKGROUNDS)('el foco se ve sobre %s', (bg) => {
    expect(contrast(theme['focus']!, theme[bg]!)).toBeGreaterThanOrEqual(3);
  });
});
