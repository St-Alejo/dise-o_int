import { expect, test, type Page } from '@playwright/test';

/**
 * Capturas de las plantillas para la landing y la galería. No es una prueba: genera imágenes.
 *   npx playwright test -c playwright.shots.config.ts
 * Deja PNG en e2e/shots/landing/; `scripts/landing-images.py` los convierte y los coloca en la web.
 * Cada plantilla se captura con luz de tarde; la primera, además, de día, de noche y por dentro.
 */
interface Scene {
  postFx: { ao: boolean } | null;
  placements: number;
  cameraMode: string;
  timeOfDay: string;
}
const scene = (page: Page) => page.evaluate(() => (window as unknown as { __scene?: Scene }).__scene ?? null);
const LIGHTS = { dia: 'Día', tarde: 'Tarde', noche: 'Noche' } as const;

async function setLight(page: Page, light: keyof typeof LIGHTS): Promise<void> {
  await page.locator('summary', { hasText: 'Luz:' }).click();
  await page.getByRole('button', { name: LIGHTS[light], exact: true }).click();
  await page.waitForTimeout(1200);
}

/** Captura solo el 3D: se esconden los botones y avisos que flotan sobre el visor. */
async function shoot(page: Page, name: string): Promise<void> {
  const hide = await page.addStyleTag({ content: 'app-three-viewport > :not(canvas) { visibility: hidden !important; }' });
  await page.waitForTimeout(400);
  await page.locator('app-three-viewport canvas').screenshot({ path: `shots/landing/${name}.png` });
  await hide.evaluate((el) => el.remove());
}

test('capturas de las plantillas', async ({ page }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1900, height: 1300 });
  await page.addInitScript(() => {
    localStorage.setItem('interiores.editor.vista', '3d');
    localStorage.setItem('interiores.visor.calidad', 'high');
  });
  await page.goto('/plantillas');
  await expect(page.locator('a.tile').first()).toBeVisible({ timeout: 30_000 });
  const ids = await page.locator('a.tile').evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).pathname.split('/').pop()!));
  expect(ids.length).toBeGreaterThan(0);

  for (const [index, id] of ids.entries()) {
    await page.goto(`/demo/${id}`);
    await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await scene(page))?.postFx ?? null, { timeout: 30_000 }).not.toBeNull();
    await expect.poll(async () => (await scene(page))?.placements ?? 0).toBeGreaterThan(0);
    await page.waitForTimeout(3500); // los modelos terminan de cargar
    await setLight(page, 'tarde');
    await shoot(page, `${id}-tarde`);
    if (index > 0) continue;
    for (const light of ['dia', 'noche'] as const) {
      await setLight(page, light);
      await shoot(page, `${id}-${light}`);
    }
    await setLight(page, 'tarde');
    await page.getByRole('button', { name: 'Recorrer' }).click();
    await expect.poll(async () => (await scene(page))?.cameraMode).toBe('walk');
    await page.waitForTimeout(4000);
    await shoot(page, `${id}-dentro`);
  }
});
