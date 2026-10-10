import { expect, test } from '@playwright/test';
import { apiSession } from './helpers';

/** Mis proyectos: renombrar, duplicar (una copia independiente y lista) y buscar por nombre. */
test('proyectos: renombrar, duplicar y buscar', async ({ page }) => {
  const headers = await apiSession(page, 'gestion');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto original', roomType: 'bedroom', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 4, depthM: 3.5, heightM: 2.6 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const list = async (): Promise<{ id: string; name: string; itemCount: number }[]> => (await page.request.get('/api/projects', { headers })).json();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000, intervals: [500, 1000] }).toBe('ready');

  await page.goto('/proyectos');
  const cards = page.locator('li.project');
  const mine = cards.filter({ hasText: 'Cuarto original' });
  await expect(mine).toHaveCount(1);

  // Renombrar en la misma tarjeta, con Enter.
  await mine.getByRole('button', { name: 'Renombrar Cuarto original' }).click();
  const input = page.getByLabel('Nombre nuevo de Cuarto original');
  await input.fill('Dormitorio de visitas');
  await input.press('Enter');
  const renamed = cards.filter({ hasText: 'Dormitorio de visitas' });
  await expect(renamed.getByRole('heading', { name: 'Dormitorio de visitas' })).toBeVisible();
  expect((await list()).find((p) => p.id === id)?.name).toBe('Dormitorio de visitas');

  // Duplicar: una copia con los mismos muebles, lista para abrir.
  await renamed.getByRole('button', { name: 'Duplicar Dormitorio de visitas' }).click();
  const copy = cards.filter({ hasText: 'Dormitorio de visitas (copia)' });
  await expect(copy).toHaveCount(1);
  const all = await list();
  const original = all.find((p) => p.id === id)!;
  const copied = all.find((p) => p.name === 'Dormitorio de visitas (copia)')!;
  expect(copied.id).not.toBe(id);
  expect(copied.itemCount).toBe(original.itemCount);
  expect(copied.itemCount).toBeGreaterThan(2);

  // Con varios proyectos aparece el buscador (sin distinguir mayúsculas ni acentos).
  await copy.getByRole('button', { name: /^Duplicar/ }).click();
  await expect(cards.filter({ hasText: '(copia) (copia)' })).toHaveCount(1);
  await cards.filter({ hasText: '(copia) (copia)' }).getByRole('button', { name: /^Duplicar/ }).click();
  const search = page.getByLabel('Buscar proyectos por nombre');
  await expect(search).toBeVisible();
  const total = await cards.count();
  await search.fill('COPIA');
  await expect(cards).toHaveCount(3);
  await search.fill('no existe');
  await expect(page.getByText('Ningún proyecto se llama así.')).toBeVisible();
  await search.fill('');
  await expect(cards).toHaveCount(total);

  // La copia se abre en el editor como cualquier proyecto.
  await copy.first().getByRole('link', { name: 'Abrir', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dormitorio de visitas (copia)', exact: true })).toBeVisible();
  await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
});
