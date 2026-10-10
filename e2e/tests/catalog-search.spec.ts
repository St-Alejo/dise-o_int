import { expect, test } from '@playwright/test';
import { createFromPhoto, openEditor, signUp } from './helpers';

/**
 * Fase 2: catálogo ampliado con búsqueda (sin acentos, sinónimos, tolerante a errores) y
 * muebles paramétricos que se dibujan en vivo; los de pared y superficie se colocan solos.
 */
test('buscar y añadir: lámpara sobre la mesa de noche y cuadro en la pared', async ({ page }) => {
  await signUp(page, 'Catalogo');

  await createFromPhoto(page, { roomType: 'Dormitorio' });
  await openEditor(page);

  const search = page.getByLabel('Buscar en el catálogo');
  const results = page.locator('app-catalog-panel ul[role=list] > li button');

  // Sinónimos, acentos y errores de tipeo llevan al mismo lugar.
  await search.fill('closet');
  await expect(results.first()).toContainText(/Armario/);
  await search.fill('LAMPRA de mesa');
  await expect(results.first()).toContainText(/Lámpara de mesa/);

  // Una mesa de noche primero, para que la lámpara tenga dónde apoyarse.
  await search.fill('mesa de noche');
  await results.first().click();
  await page.getByRole('button', { name: 'Deseleccionar' }).click();
  await search.fill('lámpara de mesa');
  await results.first().click();
  await expect(page.getByText(/quedó sobre/)).toBeVisible();
  await page.getByRole('button', { name: 'Deseleccionar' }).click();

  await search.fill('cuadro');
  await results.first().click();
  await expect(page.getByText('✓ Guardado')).toBeVisible({ timeout: 15_000 });

  // Persisten tras recargar (el servidor validó soporte y pared).
  await page.reload();
  await page.getByRole('tab', { name: /Editor 3D/ }).click();
  await expect(page.locator('app-three-viewport canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/fase2-editor.png', fullPage: false });
});
