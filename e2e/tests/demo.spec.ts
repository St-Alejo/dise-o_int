import { expect, test, type Page } from '@playwright/test';

/**
 * Demo sin registro: una plantilla amueblada se abre en el editor sin cuenta, lo que se cambia se
 * queda en el navegador y, al pedir guardarla, pasa a ser un proyecto de la cuenta recién creada.
 */
interface Scene {
  placements: number;
}
const scene = (page: Page) => page.evaluate(() => (window as unknown as { __scene?: Scene }).__scene ?? null);
const placements = async (page: Page) => (await scene(page))?.placements ?? 0;
const savedRevision = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('interiores.demo.demo-sala-escandinava') ?? '{}') as { revision?: number }).revision ?? 0);

test('demo sin cuenta: abrir una plantilla, editarla, recargar y guardarla en una cuenta nueva', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('interiores.editor.vista', '3d'));
  await page.goto('/plantillas');
  await page.getByRole('link', { name: /Sala escandinava/ }).click();
  await expect(page).toHaveURL(/\/demo\/sala-escandinava$/);
  await expect(page.getByRole('heading', { name: 'Sala escandinava', level: 1 })).toBeVisible();
  await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => placements(page)).toBeGreaterThan(5);
  const initial = await placements(page);

  // Sin cuenta no hay servidor al que pedirle otra distribución ni asistente.
  await expect(page.getByRole('tab', { name: 'Asistente IA' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Otra distribución/ })).toHaveCount(0);

  // Se quita un mueble: el cambio se guarda en este navegador y sobrevive a recargar.
  await page.getByRole('tab', { name: 'Objetos' }).click();
  await page.locator('app-outliner button.pick').first().click();
  await page.locator('app-three-viewport').getByRole('button', { name: 'Quitar', exact: true }).click();
  await expect.poll(() => placements(page)).toBe(initial - 1);
  await expect.poll(() => savedRevision(page), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => placements(page)).toBe(initial - 1);

  // Guardarla pide crear la cuenta y, al volver, la convierte en un proyecto propio.
  await page.getByRole('button', { name: 'Guardar en mi cuenta' }).click();
  await expect(page).toHaveURL(/\/registro\?volver=/);
  await page.getByLabel('Nombre').fill('Demo');
  await page.getByLabel('Email').fill(`demo-${Date.now()}@example.test`);
  await page.getByLabel('Contraseña').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/proyectos\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Sala escandinava', level: 1 })).toBeVisible();
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible();
  await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => placements(page)).toBe(initial - 1);
  // Ya es un proyecto normal: lo que la demo no ofrecía, aquí está.
  await expect(page.getByRole('button', { name: /Otra distribución/ })).toBeVisible();
  // Y la demo quedó limpia para la próxima vez.
  expect(await savedRevision(page)).toBe(0);
});

test('una plantilla que no existe lo dice y ofrece volver a la galería', async ({ page }) => {
  await page.goto('/demo/no-existe');
  await expect(page.getByRole('alert')).toContainText('No pudimos abrir la demostración');
  await page.getByRole('link', { name: 'Ver las plantillas' }).click();
  await expect(page.getByRole('heading', { name: 'Empieza por un cuarto ya hecho' })).toBeVisible();
});
