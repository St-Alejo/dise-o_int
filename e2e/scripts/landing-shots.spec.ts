import { expect, test, type Page } from '@playwright/test';

/**
 * Capturas de las plantillas para la landing y la galería. No es una prueba: genera imágenes.
 *   npx playwright test -c playwright.shots.config.ts
 * Deja PNG en e2e/shots/landing/; `scripts/landing-images.py` los convierte y los coloca en la web.
 * Cada plantilla se captura con luz de tarde. De la primera salen además las del encabezado (día,
 * tarde, noche, por dentro y vacía) y las del editor en uso; y, al final, una sala por estilo.
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
  page.setDefaultTimeout(30_000);
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
    await shoot(page, 'cuarto-tarde');
    for (const light of ['dia', 'noche'] as const) {
      await setLight(page, light);
      await shoot(page, `cuarto-${light}`);
    }
    await editorShots(page);
    await page.evaluate((key) => localStorage.removeItem(key), `interiores.demo.demo-${id}`);
  }
  await styleShots(page);
});

/** Capturas del editor tal como se usa (con sus botones), para la sección que lo enseña. */
async function editorShots(page: Page): Promise<void> {
  const stage = page.locator('app-editor .stage');
  const ui = (name: string) => stage.screenshot({ path: `shots/landing/ui-${name}.png` });

  await setLight(page, 'noche');
  await ui('noche');

  await setLight(page, 'tarde');
  await page.getByRole('button', { name: 'Pintar', exact: true }).click();
  const box = (await page.locator('app-three-viewport canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.36, box.y + box.height * 0.2);
  await page.waitForTimeout(700);
  await ui('pintar');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Mover', exact: true }).click();

  await page.getByRole('button', { name: 'Recorrer' }).click();
  await expect.poll(async () => (await scene(page))?.cameraMode).toBe('walk');
  await page.waitForTimeout(4000);
  await ui('recorrer');
  await shoot(page, 'cuarto-dentro');
  await page.getByRole('button', { name: 'Salir del recorrido' }).click();
  await expect.poll(async () => (await scene(page))?.cameraMode).toBe('orbit');
  await page.waitForTimeout(2500);

  await page.getByRole('button', { name: 'Dividida', exact: true }).click();
  await page.getByRole('tab', { name: 'Objetos' }).click();
  await page.locator('app-outliner button.pick').first().click();
  await page.waitForTimeout(1500);
  await page.locator('app-editor .layout').screenshot({ path: 'shots/landing/ui-editar.png' });
  // Se suelta la selección (con el foco en el visor) para que el panel vuelva a sus pestañas.
  await page.locator('app-three-viewport canvas').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'Objetos' })).toBeVisible();

  await page.getByRole('button', { name: 'Plano', exact: true }).click();
  await page.waitForTimeout(800);
  await ui('plano');

  // El mismo cuarto, vacío y desde el mismo sitio: la otra mitad del antes y después.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('tab', { name: 'Objetos' }).click();
  await page.getByRole('button', { name: 'Vaciar cuarto' }).click();
  await expect.poll(async () => (await scene(page))?.placements).toBe(0);
  await page.waitForTimeout(1200);
  await shoot(page, 'cuarto-vacio');
}

/** La misma sala amueblada en cada estilo (hace falta sesión: se crea una cuenta de un solo uso). */
async function styleShots(page: Page): Promise<void> {
  const registered = await page.request.post('/api/auth/register', {
    data: { email: `capturas-${Date.now()}@example.test`, password: 'contraseña-segura-123', displayName: 'Capturas' },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await registered.json()).accessToken}` };
  for (const style of ['escandinavo', 'minimalista', 'industrial', 'bohemio', 'moderno', 'clasico']) {
    const created = await page.request.post('/api/projects', {
      headers,
      multipart: { name: `Sala ${style}`, roomType: 'living', styles: style, roomSpec: JSON.stringify({ shape: 'rect', widthM: 5, depthM: 4.2, heightM: 2.6 }) },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = await created.json();
    await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000 }).toBe('ready');
    await page.goto(`/proyectos/${id}?vista=3d`);
    await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await scene(page))?.postFx ?? null, { timeout: 30_000 }).not.toBeNull();
    await page.waitForTimeout(3500);
    await setLight(page, 'tarde');
    await shoot(page, `estilo-${style}`);
    await page.request.delete(`/api/projects/${id}`, { headers });
  }
}
