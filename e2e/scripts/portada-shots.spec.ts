import { expect, test, type Page } from '@playwright/test';

/**
 * Capturas de la portada a lo largo del scroll (no es una prueba: genera imágenes para revisar).
 *   npx playwright test -c playwright.shots.config.ts portada-shots
 * Deja PNG en e2e/shots/portada/<ancho>/. Falla si la página registra errores en la consola o si
 * deja de responder mientras se desplaza.
 */
const WIDTHS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
];

/** Baja hasta `y` en pasos cortos, como una rueda: así los scrub de GSAP llegan a su sitio. */
async function glide(page: Page, y: number): Promise<void> {
  const from = await page.evaluate(() => scrollY);
  const steps = Math.max(1, Math.ceil(Math.abs(y - from) / 400));
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((to) => window.scrollTo(0, to), from + ((y - from) * i) / steps);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(1300);
}

for (const vp of WIDTHS) {
  test(`portada a ${vp.name}px`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    // El 401 es la sesión que se intenta renovar sin cuenta iniciada: es lo esperado en la portada.
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/');
    await expect(page.locator('app-runway')).toBeAttached();
    await page.waitForTimeout(1500);

    const top = (sel: string) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().top + scrollY);
    const height = (sel: string) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().height);
    const shots: [string, number][] = [['00-pelicula', 0]];
    const run = await top('app-runway');
    const runH = await height('app-runway section');
    for (const f of [0, 0.2, 0.45, 0.7, 0.95]) shots.push([`10-pista-${Math.round(f * 100)}`, run + (runH - vp.height) * f]);
    shots.push(['20-antes-despues', await top('.ba')]);
    const walk = await top('app-walk');
    const walkH = await height('app-walk section');
    for (const f of [0, 0.3, 0.65, 1]) shots.push([`30-paseo-${Math.round(f * 100)}`, walk + (walkH - vp.height) * f]);
    const pieces = await top('app-pieces');
    shots.push(['40-piezas', pieces + vp.height * 0.35], ['41-piezas-cifras', pieces + vp.height * 1.1]);
    shots.push(['50-plantillas', await top('#plantillas')], ['70-cierre', await top('.closing')]);

    for (const [name, y] of shots) {
      await glide(page, Math.round(y));
      // Si el hilo principal se queda colgado, esto no vuelve.
      await expect.poll(() => page.evaluate(() => 1), { timeout: 5000 }).toBe(1);
      await page.screenshot({ path: `shots/portada/${vp.name}/${name}.png` });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, 'scroll horizontal').toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
