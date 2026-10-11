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

test('presentar: recorre las vistas del cuarto con las flechas y al salir todo queda como estaba', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('interiores.editor.vista', '3d'));
  await page.goto('/demo/comedor-moderno');
  await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => placements(page)).toBeGreaterThan(5);
  const light = () => page.evaluate(() => (window as unknown as { __scene: { timeOfDay: string } }).__scene.timeOfDay);
  const mode = () => page.evaluate(() => (window as unknown as { __scene: { cameraMode: string } }).__scene.cameraMode);

  await page.getByRole('button', { name: 'Presentar' }).click();
  const show = page.getByRole('region', { name: 'Presentación del cuarto' });
  await expect(show).toContainText('1 / 6');
  await expect(show.getByRole('heading')).toHaveText('El cuarto');
  await expect(show).toContainText('Comedor moderno');
  // Presentando no hay herramientas de edición a la vista.
  await expect(page.getByRole('button', { name: 'Pintar', exact: true })).toBeHidden();

  await page.keyboard.press('ArrowRight');
  await expect(show.getByRole('heading')).toHaveText('Desde arriba');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(show).toContainText('4 / 6');
  expect(await light()).toBe('night');
  await show.getByRole('button', { name: 'Siguiente' }).click();
  await expect(show.getByRole('heading')).toHaveText('Desde dentro');
  await expect.poll(mode).toBe('walk');
  await page.keyboard.press('End');
  await expect(show).toContainText('piezas');
  await expect(show.getByRole('button', { name: 'Siguiente' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(show).toBeHidden();
  await expect(page.getByRole('button', { name: 'Pintar', exact: true })).toBeVisible();
  expect(await light()).toBe('day');
  await expect.poll(mode).toBe('orbit');
  // Y no se movió ni se borró nada por haber usado el teclado.
  expect(await placements(page)).toBeGreaterThan(5);
});

test('primeros pasos: salen la primera vez que se abre el editor y no vuelven', async ({ page }) => {
  await page.addInitScript(() => {
    // Solo en la primera carga: como si nunca se hubiera abierto el editor.
    if (!sessionStorage.getItem('reiniciado')) {
      localStorage.removeItem('interiores.tour.visto');
      sessionStorage.setItem('reiniciado', '1');
    }
  });
  await page.goto('/demo/estudio-industrial');
  const tour = page.getByRole('complementary', { name: 'Primeros pasos' });
  await expect(tour).toContainText('1 de 4');
  await expect(tour).toContainText('Mueve y gira');
  // No bloquea: el editor se puede usar con la franja abierta.
  await expect(page.getByRole('button', { name: 'Presentar' })).toBeEnabled();
  for (const step of ['2 de 4', '3 de 4', '4 de 4']) {
    await tour.getByRole('button', { name: 'Siguiente' }).click();
    await expect(tour).toContainText(step);
  }
  await tour.getByRole('button', { name: 'Entendido' }).click();
  await expect(tour).toBeHidden();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Objetos' })).toBeVisible({ timeout: 30_000 });
  await expect(tour).toBeHidden();
});
