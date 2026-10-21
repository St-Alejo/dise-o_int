import { expect, test } from '@playwright/test';
import { createFromPhoto, openEditor, signUp } from './helpers';

/** Acabado a medida: se arma con colores, dibujo y brillo, se pone en el piso y queda fijado. */
test('acabado a medida en el piso, fijado para Recomendar y deshacible', async ({ page }) => {
  await signUp(page, 'Acabado');
  await createFromPhoto(page, { dims: ['4', '3.5', '2.6'] });
  await openEditor(page);

  await page.getByRole('tab', { name: 'Cuarto y acabados' }).click();
  await page.getByText('Acabado a medida').click();
  const editor = page.locator('app-finish-spec-editor');
  await editor.getByLabel('Dibujo').selectOption({ label: 'Espiga' });
  await editor.getByLabel('Color 1', { exact: true }).fill('#2f6f9f');
  await expect(editor.getByRole('img', { name: /Muestra: Baldosa .*espiga/ })).toBeVisible();
  await editor.getByRole('button', { name: 'Poner en piso' }).click();
  await expect(page.getByText('✓ Guardado')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('tab', { name: 'Lo que pediste' }).click();
  await expect(page.getByRole('button', { name: 'Soltar Piso' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/fase6-acabado-a-medida.png' });

  // Ctrl+Z quita el piso a medida (el candado se queda: es lo que se pidió).
  await page.keyboard.press('Control+z');
  await page.getByRole('tab', { name: 'Cuarto y acabados' }).click();
  await expect(page.locator('app-finishes-panel button[aria-pressed="true"][aria-label^="Piso:"]')).toHaveCount(1);
});
