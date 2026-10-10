import { expect, test, type Page } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * El guardado no pierde trabajo: si la red falla los cambios se quedan en el navegador, se
 * reenvían al volver y, si la pestaña se recarga antes, se ofrecen recuperar.
 */
type Headers = Record<string, string>;

async function roomWithOneTable(page: Page): Promise<{ id: string; headers: Headers }> {
  const headers = await apiSession(page, 'guardado');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto para guardar', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 5, depthM: 4, heightM: 2.6 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const get = async () => (await page.request.get(`/api/projects/${id}`, { headers })).json();
  await expect.poll(async () => (await get()).status, { timeout: 60_000, intervals: [500, 1000] }).toBe('ready');
  const catalog: { id: string; mount: string; subcategory?: string }[] = await (await page.request.get('/api/catalog', { headers })).json();
  const table = catalog.find((c) => c.mount === 'floor' && c.subcategory === 'coffee-table')!;
  const saved = await page.request.put(`/api/projects/${id}/scene`, {
    headers,
    data: { revision: (await get()).revision, furniturePlacements: [{ id: 'mesa', catalogItemId: table.id, position: { x: 2.5, y: 0, z: 2 }, rotationY: 0, lockedByUser: true }] },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  return { id, headers };
}

test('guardado: sin conexión los cambios esperan y se envían al volver', async ({ page, context }) => {
  const { id, headers } = await roomWithOneTable(page);
  const x = async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).furniturePlacements[0].position.x;
  await page.goto(`/proyectos/${id}?vista=3d`);
  const piece = page.locator('app-plan-editor polygon.item');
  await expect(piece).toHaveCount(1);

  await context.setOffline(true);
  await piece.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByText('Sin conexión: tus cambios se guardarán al volver')).toBeVisible({ timeout: 15_000 });

  // Se sigue trabajando sin red: el cambio sigue en pantalla y nada se perdió.
  await page.keyboard.press('Shift+ArrowRight');
  await context.setOffline(false);
  await expect(page.getByText('✓ Guardado')).toBeVisible({ timeout: 20_000 });
  expect(await x()).toBeCloseTo(3, 2);
});

test('guardado: lo que no llegó a guardarse se ofrece recuperar al volver a abrir', async ({ page }) => {
  const { id, headers } = await roomWithOneTable(page);
  const x = async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).furniturePlacements[0].position.x;
  await page.goto(`/proyectos/${id}?vista=3d`);
  const piece = page.locator('app-plan-editor polygon.item');
  await expect(piece).toHaveCount(1);

  // El servidor deja de aceptar guardados (como si se hubiera caído).
  await page.route('**/api/projects/*/scene', (route) => route.abort('connectionfailed'));
  await piece.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByText(/No se pudo guardar; reintentando/)).toBeVisible({ timeout: 15_000 });
  expect(await x()).toBe(2.5);

  // Al recargar con cambios pendientes el navegador pregunta; se acepta salir.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await page.unroute('**/api/projects/*/scene');
  const banner = page.getByText(/Encontramos cambios de tu última visita/);
  await expect(banner).toBeVisible({ timeout: 30_000 });

  // Recuperarlos los aplica (se puede deshacer) y ahora sí se guardan.
  await page.getByRole('button', { name: 'Recuperarlos' }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(x, { intervals: [500, 1000] }).toBeCloseTo(2.25, 2);
  await expect(page.getByRole('button', { name: /^Deshacer Recuperar cambios/ })).toBeEnabled();

  // Ya guardado, al volver a abrir no hay nada que ofrecer.
  await expect(page.getByText('✓ Guardado')).toBeVisible();
  await page.reload();
  await expect(page.locator('app-plan-editor polygon.item')).toHaveCount(1);
  await expect(page.getByText(/Encontramos cambios/)).toHaveCount(0);
});
