import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

/**
 * Asistente de nuevo proyecto sin foto: se elige la forma, se escriben las medidas viendo el
 * plano, y el cuarto llega amueblado al editor 3D con la forma pedida.
 */
test('asistente: un cuarto en L sin foto, del plano al editor 3D', async ({ page }) => {
  await signUp(page, 'Asistente');
  await page.goto('/proyectos/nuevo');

  // Paso 1: sin foto no se puede seguir hasta elegir cómo empezar.
  await expect(page.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  await page.getByRole('button', { name: 'Empezar sin foto' }).click();

  // Paso 2: parte de un rectángulo con medidas típicas y ya dibuja su plano.
  const plan = page.getByRole('img', { name: /Plano del cuarto/ });
  await expect(plan).toHaveAccessibleName(/rectangular.*4 paredes, 1 puerta y 1 ventana/);
  await expect(page.getByRole('button', { name: 'Según la foto' })).toHaveCount(0);

  await page.getByRole('button', { name: 'En L' }).click();
  await page.getByLabel('Ancho (m)').fill('5.5');
  await page.getByLabel('Largo (m)').fill('4.5');
  await page.getByLabel('Ancho de la muesca (m)').fill('2.2');
  await page.getByLabel('Largo de la muesca (m)').fill('1.8');
  await expect(plan).toHaveAccessibleName(/en L: 5,50 m de ancho por 4,50 m de fondo, 6 paredes/);
  // El plano acota cada pared: la del fondo mide el ancho entero y la de la muesca, lo escrito.
  await expect(plan.getByText('5,50 m')).toBeVisible();
  await expect(plan.getByText('2,20 m')).toBeVisible();

  const axe = await new AxeBuilder({ page }).include('app-new-project').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

  // Una medida imposible no deja avanzar y explica por qué.
  await page.getByLabel('Alto (m)').fill('9');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('alert')).toContainText('El alto debe estar entre 2 y 6 m');
  await page.getByLabel('Alto (m)').fill('2.6');
  await page.getByRole('button', { name: 'Siguiente' }).click();

  // Paso 3: nombre, tipo y estilo; sin foto el botón crea el cuarto directamente.
  await page.getByLabel('Nombre del proyecto').fill('Estudio en L');
  await page.getByRole('button', { name: 'Oficina' }).click();
  await page.getByRole('button', { name: 'Crear mi cuarto' }).click();

  // Sin foto no hay propuestas 2D: se llega directo al editor con el cuarto ya amueblado.
  await expect(page.getByRole('heading', { name: 'Estudio en L' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('tab', { name: /Propuestas 2D/ })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __scene?: { walls: number; hasCeiling: boolean } }).__scene))
    .toMatchObject({ walls: 6, hasCeiling: true });
  // Medidas exactas: no se pide calibrar.
  await expect(page.getByText(/Medidas aproximadas/)).toHaveCount(0);

  // El diálogo de medidas del editor conoce las seis paredes.
  await page.getByRole('button', { name: /Medidas del cuarto/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Medidas del cuarto' });
  await expect(dialog.getByLabel('Ancho del cuarto')).toHaveValue('5.5');
  await expect(dialog.locator('select').first().locator('option')).toHaveText([
    'Fondo (la que ves en la foto)',
    'Derecha',
    'Pared 3',
    'Pared 4',
    'Frente (detrás de la cámara)',
    'Izquierda',
  ]);
});
