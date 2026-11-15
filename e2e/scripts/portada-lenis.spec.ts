import { expect, test } from '@playwright/test';

/**
 * Comprobación del scroll suave de la portada (no forma parte de la e2e):
 *   npx playwright test -c playwright.shots.config.ts portada-lenis
 */
test('Lenis se activa, la rueda avanza y los enlaces de la cabecera llegan a su sección', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/lenis/, { timeout: 15_000 });

  await page.mouse.move(700, 450);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400);
  // Suave: justo después del último giro la página todavía se está moviendo.
  const right = await page.evaluate(() => scrollY);
  await page.waitForTimeout(150);
  const later = await page.evaluate(() => scrollY);
  expect(later).toBeGreaterThan(right);
  await expect.poll(() => page.evaluate(() => scrollY), { timeout: 5000 }).toBeGreaterThan(600);

  await page.getByRole('navigation').getByRole('link', { name: 'Catálogo' }).first().click();
  await expect
    .poll(() => page.evaluate(() => Math.abs(document.getElementById('catalogo')!.getBoundingClientRect().top)), { timeout: 8000 })
    .toBeLessThan(120);

  // Al salir de la portada, Lenis se apaga.
  await page.goto('/plantillas');
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
});

test('con movimiento reducido no se carga Lenis', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForTimeout(2500);
  await expect(page.locator('html')).not.toHaveClass(/lenis/);
  await context.close();
});
