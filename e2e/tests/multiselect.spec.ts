import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Multiselección: elegir varios muebles con Shift+clic o con un marco en el plano y actuar sobre
 * todos a la vez (alinear, repartir, mover con las flechas, quitar), cada cosa en un paso de deshacer.
 */
type Headers = Record<string, string>;
interface Placement {
  id: string;
  position: { x: number; z: number };
}

async function roomWithThreeTables(page: Page): Promise<{ id: string; headers: Headers }> {
  const headers = await apiSession(page, 'grupo');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto para agrupar', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 6, depthM: 5, heightM: 2.6 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const get = async () => (await page.request.get(`/api/projects/${id}`, { headers })).json();
  await expect.poll(async () => (await get()).status, { timeout: 60_000, intervals: [500, 1000] }).toBe('ready');
  const catalog: { id: string; mount: string; subcategory?: string }[] = await (await page.request.get('/api/catalog', { headers })).json();
  const table = catalog.find((c) => c.mount === 'floor' && c.subcategory === 'coffee-table')!;
  const at = (pid: string, x: number, z: number) => ({ id: pid, catalogItemId: table.id, position: { x, y: 0, z }, rotationY: 0, lockedByUser: true });
  const saved = await page.request.put(`/api/projects/${id}/scene`, {
    headers,
    data: { revision: (await get()).revision, furniturePlacements: [at('a', 1.2, 1.5), at('b', 2.8, 2.6), at('c', 4.9, 3.4)] },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  return { id, headers };
}

const centreOf = (locator: Locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

test('multiselección: Shift+clic, marco, alinear, repartir, mover y quitar en grupo', async ({ page }) => {
  const { id, headers } = await roomWithThreeTables(page);
  const placements = async (): Promise<Placement[]> => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).furniturePlacements;
  const xs = async () => (await placements()).map((p) => Math.round(p.position.x * 100) / 100);
  await page.goto(`/proyectos/${id}?vista=3d`);
  const plan = page.locator('app-plan-editor');
  const pieces = plan.locator('polygon.item');
  await expect(pieces).toHaveCount(3);
  const panel = page.locator('app-group-panel');

  // Clic en una y Shift+clic en otra: dos seleccionadas y aparece el panel de grupo.
  const first = await centreOf(pieces.nth(0));
  const second = await centreOf(pieces.nth(1));
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  await expect(panel.getByRole('heading', { name: '2 muebles seleccionados' })).toBeVisible();
  await expect(plan.locator('polygon.item.selected')).toHaveCount(2);

  // Alinear a la izquierda: las dos quedan con el mismo borde izquierdo (son iguales: mismo centro).
  await panel.getByRole('button', { name: 'Alinear a la izquierda' }).click();
  await expect.poll(async () => (await xs()).slice(0, 2), { intervals: [500, 1000] }).toEqual([1.2, 1.2]);
  await expect(page.getByRole('button', { name: /^Deshacer Alinear muebles/ })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect.poll(xs, { intervals: [500, 1000] }).toEqual([1.2, 2.8, 4.9]);

  // Un marco alrededor de todo el cuarto selecciona las tres.
  const box = (await plan.locator('svg').boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width - 6, box.y + box.height - 6, { steps: 4 });
  await page.mouse.up();
  await expect(panel.getByRole('heading', { name: '3 muebles seleccionados' })).toBeVisible();

  // Repartir a lo ancho: la del medio queda centrada entre las otras dos.
  await panel.getByRole('button', { name: 'A lo ancho' }).click();
  await expect.poll(xs, { intervals: [500, 1000] }).toEqual([1.2, 3.05, 4.9]);

  // Las flechas mueven las tres juntas.
  await pieces.nth(0).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(xs, { intervals: [500, 1000] }).toEqual([0.95, 2.8, 4.65]);

  // Supr las quita todas en un paso; Ctrl+Z las devuelve.
  await page.keyboard.press('Delete');
  await expect(pieces).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(pieces).toHaveCount(3);
  await expect.poll(async () => (await placements()).length, { intervals: [500, 1000] }).toBe(3);
});
