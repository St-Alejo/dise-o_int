import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const photo = fileURLToPath(new URL('../fixtures/room.jpg', import.meta.url));

/**
 * Fase 3: personalizar cada pieza (medidas, material) y el cuarto (acabados), con deshacer,
 * y persistencia.
 */
test('personalizar: medidas y material de un sofá, acabados del cuarto, deshacer y persistir', async ({ page }) => {
  await page.goto('/registro');
  await page.getByLabel('Nombre').fill('Personaliza');
  await page.getByLabel('Email').fill(`personaliza-${Date.now()}@example.test`);
  await page.getByLabel('Contraseña').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/proyectos$/);

  await page.goto('/proyectos/nuevo');
  await page.locator('input[type=file]').setInputFiles(photo);
  await page.getByText('Conozco las medidas del cuarto').click();
  await page.getByLabel('Ancho (m)').fill('5');
  await page.getByLabel('Largo (m)').fill('4.5');
  await page.getByLabel('Alto (m)').fill('2.6');
  await page.getByRole('button', { name: 'Analizar mi cuarto' }).click();
  await expect(page.getByRole('heading', { name: 'Propuestas', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: /Editor 3D/ }).click();
  await expect(page.getByText('✓ Guardado')).toBeVisible();

  // Añadir un sofá paramétrico y abrir su inspector.
  await page.getByLabel('Solo estilo').uncheck();
  await page.getByLabel('Buscar en el catálogo').fill('sofa de terciopelo verde');
  await page.locator('app-catalog-panel ul[role=list] > li button').first().click();
  const inspector = page.locator('app-inspector');
  await expect(inspector.getByRole('heading', { name: /Sofá de terciopelo verde/ })).toBeVisible();

  const axe = await new AxeBuilder({ page }).include('app-inspector').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);

  // Medidas: el ancho a 240 cm se acota al rango del catálogo (±30 % de 200 → máx. 260).
  const width = inspector.getByLabel('Ancho', { exact: true });
  await width.fill('240');
  await width.press('Enter');
  await expect(width).toHaveValue('240');
  await expect(inspector.getByRole('button', { name: /Medidas originales/ })).toBeVisible();

  // Material: tapizado en cuero coñac.
  await inspector.getByRole('button', { name: 'Tapizado: Cuero coñac' }).click();
  await expect(inspector.getByRole('button', { name: 'Tapizado: Cuero coñac' })).toHaveAttribute('aria-pressed', 'true');

  // Deshacer el material vuelve al terciopelo; rehacer lo recupera.
  await page.keyboard.press('Control+z');
  await expect(inspector.getByRole('button', { name: 'Tapizado: Terciopelo verde' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+y');
  await expect(inspector.getByRole('button', { name: 'Tapizado: Cuero coñac' })).toHaveAttribute('aria-pressed', 'true');

  // Acabados del cuarto.
  await inspector.getByRole('button', { name: 'Deseleccionar' }).click();
  await page.getByRole('tab', { name: 'Cuarto y acabados' }).click();
  await page.getByRole('button', { name: 'Piso: Nogal' }).click();
  await page.getByLabel('Pintar').selectOption('w-back');
  await page.getByRole('button', { name: 'Pared: Azul marino' }).click();
  await expect(page.getByRole('button', { name: 'Pared: Azul marino' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('✓ Guardado')).toBeVisible({ timeout: 15_000 });

  // Todo persiste al recargar (el servidor validó medidas, materiales y acabados).
  await page.reload();
  await page.getByRole('tab', { name: /Editor 3D/ }).click();
  await page.getByRole('tab', { name: 'Cuarto y acabados' }).click();
  await expect(page.getByRole('button', { name: 'Piso: Nogal' })).toHaveAttribute('aria-pressed', 'true');

  await page.screenshot({ path: 'test-results/fase3-editor.png' });
});
