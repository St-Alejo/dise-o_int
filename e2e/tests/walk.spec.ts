import { expect, test, type Page } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Recorrer el cuarto a pie: la cámara baja a la altura de los ojos, camina con el teclado sin
 * atravesar las paredes y vuelve a la vista de órbita con Escape. También en el enlace público.
 */
interface Scene {
  cameraMode: 'orbit' | 'walk';
  camera: { x: number; y: number; z: number };
  walls: number;
}
const scene = (page: Page) => page.evaluate(() => (window as unknown as { __scene: Scene }).__scene);
const ROOM = { shape: 'rect', widthM: 5, depthM: 4, heightM: 2.6 };

async function createRoom(page: Page) {
  const headers = await apiSession(page, 'recorrido');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto para recorrer', roomType: 'bedroom', styles: 'moderno', roomSpec: JSON.stringify(ROOM) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000 }).toBe('ready');
  return { id, headers };
}

/** Dentro del cuarto y a la altura de los ojos. */
function expectInsideAtEyeLevel(camera: Scene['camera']) {
  expect(camera.y).toBeCloseTo(1.6, 1);
  expect(camera.x).toBeGreaterThan(0.2);
  expect(camera.x).toBeLessThan(ROOM.widthM - 0.2);
  expect(camera.z).toBeGreaterThan(0.2);
  expect(camera.z).toBeLessThan(ROOM.depthM - 0.2);
}

test('recorrer: baja a la altura de los ojos, camina sin atravesar paredes y vuelve con Escape', async ({ page }) => {
  const { id } = await createRoom(page);
  await page.goto(`/proyectos/${id}?vista=3d`);
  const canvas = page.locator('app-three-viewport canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await scene(page)).cameraMode).toBe('orbit');
  const orbit = (await scene(page)).camera;
  expect(orbit.y).toBeGreaterThan(3); // la vista de órbita mira el cuarto desde arriba

  await page.getByRole('button', { name: 'Recorrer' }).click();
  await expect(page.getByRole('button', { name: 'Salir del recorrido' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'para caminar' })).toBeVisible();
  // La cámara vuela hasta dentro del cuarto.
  await expect.poll(async () => (await scene(page)).camera.y, { timeout: 5_000 }).toBeCloseTo(1.6, 1);
  const start = (await scene(page)).camera;
  expectInsideAtEyeLevel(start);

  // Caminar: el canvas tiene el foco tras pulsar "Recorrer".
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyS');
  const walked = (await scene(page)).camera;
  expect(Math.hypot(walked.x - start.x, walked.z - start.z)).toBeGreaterThan(0.3);
  expectInsideAtEyeLevel(walked);

  // Mantener una tecla contra la pared no la atraviesa.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(4000);
  await page.keyboard.up('KeyD');
  expectInsideAtEyeLevel((await scene(page)).camera);
  const stopped = (await scene(page)).camera;
  await page.waitForTimeout(300);
  expect((await scene(page)).camera).toEqual(stopped); // al soltar la tecla se detiene

  // Escape devuelve la vista de órbita, desde arriba.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Recorrer' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await scene(page)).camera.y, { timeout: 5_000 }).toBeGreaterThan(3);
  expect((await scene(page)).cameraMode).toBe('orbit');
});

test('el enlace público también se puede recorrer', async ({ page, browser }) => {
  const { id, headers } = await createRoom(page);
  const shared = await page.request.post(`/api/projects/${id}/share`, { headers });
  expect(shared.ok()).toBeTruthy();
  const { path } = await shared.json();

  // Otra persona, sin sesión.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(path);
  await expect(visitor.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await visitor.getByRole('button', { name: 'Recorrer' }).click();
  await expect.poll(async () => (await scene(visitor)).camera.y, { timeout: 5_000 }).toBeCloseTo(1.6, 1);
  expect((await scene(visitor)).cameraMode).toBe('walk');
  await visitor.context().close();
});
