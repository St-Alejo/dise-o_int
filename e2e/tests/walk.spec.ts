import { expect, test, type Page } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Recorrer el cuarto a pie: la cámara baja a la altura de los ojos, camina con el teclado sin
 * atravesar las paredes y vuelve a la vista de órbita con Escape. También en el enlace público.
 */
interface Scene {
  cameraMode: 'orbit' | 'walk';
  camera: { x: number; y: number; z: number };
  timeOfDay: 'day' | 'night';
  lamps: number;
  walls: number;
  tool: string;
  selectedId: string | null;
  selectedAt: { x: number; y: number; visible: boolean } | null;
  gizmo: { kind: string; x: number; y: number }[];
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

  // De noche alumbran las lámparas del cuarto (el dormitorio trae una colgante y una de pie).
  await expect.poll(async () => (await scene(page)).lamps).toBeGreaterThan(0);
  const night = page.getByRole('button', { name: 'Modo noche' });
  await expect(night).toHaveAttribute('aria-pressed', 'false');
  await night.click();
  await expect(night).toHaveAttribute('aria-pressed', 'true');
  expect((await scene(page)).timeOfDay).toBe('night');

  await page.getByRole('button', { name: 'Recorrer' }).click();
  await expect(page.getByRole('button', { name: 'Salir del recorrido' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'para caminar' })).toBeVisible();
  // La cámara vuela hasta dentro del cuarto.
  await expect.poll(async () => (await scene(page)).camera.y, { timeout: 5_000 }).toBeCloseTo(1.6, 1);
  const start = (await scene(page)).camera;
  expectInsideAtEyeLevel(start);

  // Caminar: el canvas tiene el foco tras pulsar "Recorrer".
  // Se mantiene la tecla hasta haber avanzado: cuánto tarda depende de lo cargada que esté la máquina.
  await page.keyboard.down('KeyS');
  await expect
    .poll(async () => {
      const now = (await scene(page)).camera;
      return Math.hypot(now.x - start.x, now.z - start.z);
    })
    .toBeGreaterThan(0.3);
  await page.keyboard.up('KeyS');
  const walked = (await scene(page)).camera;
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

test('recorriendo también se edita: mover, girar y pintar sin salir del cuarto', async ({ page }) => {
  const headers = await apiSession(page, 'recorrido');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto para editar a pie', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify(ROOM) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const get = async () => (await page.request.get(`/api/projects/${id}`, { headers })).json();
  await expect.poll(async () => (await get()).status, { timeout: 60_000, intervals: [500, 1000] }).toBe('ready');
  // Un solo sofá, en el centro: lo que se mueva será él.
  const catalog: { id: string; mount: string; category: string }[] = await (await page.request.get('/api/catalog', { headers })).json();
  const sofa = catalog.find((c) => c.mount === 'floor' && c.category === 'sofa')!;
  const saved = await page.request.put(`/api/projects/${id}/scene`, {
    headers,
    data: { revision: (await get()).revision, furniturePlacements: [{ id: 'sofa', catalogItemId: sofa.id, position: { x: 2.5, y: 0, z: 2 }, rotationY: 0, lockedByUser: false }] },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const piece = async () => (await get()).furniturePlacements[0];

  await page.goto(`/proyectos/${id}?vista=3d`);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const canvas = page.locator('app-three-viewport canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Recorrer' }).click();
  await expect.poll(async () => (await scene(page)).camera.y, { timeout: 5_000 }).toBeCloseTo(1.6, 1);

  // Se elige el sofá desde la lista: dentro del cuarto también aparece su gizmo.
  await page.getByRole('tab', { name: 'Objetos' }).click();
  await page.locator('app-outliner button.pick').first().click();
  await expect.poll(async () => (await scene(page)).gizmo.map((h) => h.kind)).toContain('rotate');
  expect((await scene(page)).cameraMode).toBe('walk');

  // Arrastrar el vacío sigue siendo mirar: se baja la vista (por encima del horizonte no hay muebles)…
  const box = (await canvas.boundingBox())!;
  const sky = { x: box.x + box.width / 2, y: box.y + box.height * 0.25 };
  await page.mouse.move(sky.x, sky.y);
  await page.mouse.down();
  await page.mouse.move(sky.x, sky.y - 50, { steps: 4 });
  await page.mouse.move(sky.x, sky.y - 100, { steps: 4 });
  await page.mouse.up();
  expect((await scene(page)).selectedId).toBe('sofa'); // mirar no deselecciona
  // …y se gira hasta tener el sofá delante.
  await canvas.focus();
  // A toques cortos y mirando con la tecla ya suelta: si se mantiene pulsada, entre que se ve el
  // sofá y se suelta la tecla la vista sigue girando y puede pasarse de largo.
  const centred = async () => {
    const at = (await scene(page)).selectedAt;
    return !!at?.visible && Math.abs(at.x - (box.x + box.width / 2)) < box.width * 0.3;
  };
  for (let i = 0; i < 120 && !(await centred()); i++) {
    await page.keyboard.down('KeyQ');
    await page.waitForTimeout(60);
    await page.keyboard.up('KeyQ');
    await page.waitForTimeout(120);
  }
  expect(await centred(), 'el sofá debe quedar a la vista').toBe(true);
  if (process.env.SHOTS) await page.screenshot({ path: 'shots/recorrido-editar.png' });

  // R lo gira (W, A, S, D y las flechas siguen siendo para caminar).
  await page.keyboard.press('r');
  await expect.poll(async () => (await piece()).rotationY, { intervals: [500, 1000] }).toBeCloseTo(Math.PI / 12, 3);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await piece()).rotationY, { intervals: [500, 1000] }).toBe(0);

  // Arrastrarlo lo mueve; la persona no se mueve ni gira la vista.
  const stood = (await scene(page)).camera;
  const at = (await scene(page)).selectedAt!;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 30, at.y + 8, { steps: 4 });
  await page.mouse.move(at.x + 70, at.y + 16, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const p = (await piece()).position;
      return Math.hypot(p.x - 2.5, p.z - 2);
    }, { intervals: [500, 1000] })
    .toBeGreaterThan(0.1);
  expect((await scene(page)).camera).toEqual(stood);
  await expect(page.getByRole('button', { name: /^Deshacer Mover/ })).toBeEnabled();

  // Las herramientas también: pintar se activa con su tecla y Escape vuelve a mover.
  await canvas.focus();
  await page.keyboard.press('b');
  expect((await scene(page)).tool).toBe('paint');
  await page.keyboard.press('Escape');
  expect((await scene(page)).tool).toBe('select');
  expect((await scene(page)).cameraMode).toBe('walk');

  // Escape suelta primero la selección y solo después sale del recorrido.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await scene(page)).selectedId).toBeNull();
  expect((await scene(page)).cameraMode).toBe('walk');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await scene(page)).cameraMode).toBe('orbit');
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
