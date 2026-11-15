import { expect, test } from '@playwright/test';

/**
 * Capturas de la película de la portada en el celular, una por capítulo (no es una prueba):
 *   npx playwright test -c playwright.shots.config.ts portada-movil
 * Deja PNG en e2e/shots/portada/movil/ y comprueba que se pide la serie vertical (`cine/mob`).
 */
// A mitad de cada capítulo: al empezar, la cámara todavía va de camino.
const CHAPTERS = [
  ['1-foto', 0],
  ['2-plano', 0.27],
  ['3-volumen', 0.42],
  ['4-casa', 0.56],
  ['5-vidas', 0.74],
  ['6-noche', 0.97],
] as const;

test('la película en vertical, capítulo a capítulo', async ({ page }) => {
  test.setTimeout(120_000);
  const frames: string[] = [];
  page.on('request', (r) => r.url().includes('/cine/') && frames.push(r.url()));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('app-film canvas')).toBeAttached();
  await page.waitForTimeout(2500);
  const run = await page.locator('app-film section').first().evaluate((el) => ({ top: el.getBoundingClientRect().top + scrollY, h: el.getBoundingClientRect().height }));
  for (const [name, p] of CHAPTERS) {
    const y = run.top + (run.h - 844) * p;
    for (let i = 1; i <= 10; i++) {
      await page.evaluate((to) => window.scrollTo(0, to), (y * i) / 10 + (await page.evaluate(() => scrollY)) * (1 - i / 10));
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `shots/portada/movil/${name}.png` });
  }
  expect(frames.some((u) => u.includes('/cine/mob/'))).toBe(true);
  expect(frames.some((u) => u.includes('/cine/desk/'))).toBe(false);
});
