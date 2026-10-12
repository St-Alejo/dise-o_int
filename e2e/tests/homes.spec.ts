import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Viviendas: un cuarto funda una vivienda, los siguientes se crean dentro de ella, y tanto la
 * lista de proyectos como cada cuarto los enseñan juntos.
 */
const ROOM = { shape: 'rect', widthM: 4, depthM: 3.5, heightM: 2.6 };

test('vivienda: fundarla desde un cuarto, añadir otro y verlos juntos', async ({ page }) => {
  const headers = await apiSession(page, 'vivienda');
  const ready = async (id: string) =>
    expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000 }).toBe('ready');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Sala grande', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify(ROOM) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id: salaId } = await created.json();
  await ready(salaId);

  // Desde el cuarto: fundar la vivienda lleva al asistente con ella ya elegida.
  await page.goto(`/proyectos/${salaId}?vista=3d`);
  await page.getByRole('button', { name: /Añadir otro cuarto a esta vivienda/ }).click();
  await expect(page).toHaveURL(/\/proyectos\/nuevo\?vivienda=[0-9a-f-]{36}$/);
  const homeId = new URL(page.url()).searchParams.get('vivienda')!;
  const sala = await (await page.request.get(`/api/projects/${salaId}`, { headers })).json();
  expect(sala.home).toMatchObject({ id: homeId, name: 'Vivienda de Sala grande' });

  // El segundo cuarto nace dentro de la vivienda (por la API, para no repetir la prueba del asistente).
  const second = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Dormitorio', roomType: 'bedroom', styles: 'moderno', roomSpec: JSON.stringify(ROOM), homeId },
  });
  expect(second.ok(), await second.text()).toBeTruthy();
  const { id: dormitorioId } = await second.json();
  await ready(dormitorioId);

  // La lista de proyectos resume la vivienda y enlaza a sus cuartos.
  await page.goto('/proyectos');
  const homes = page.getByRole('region', { name: 'Viviendas' });
  await expect(homes).toContainText('Vivienda de Sala grande');
  await expect(homes).toContainText('2 cuartos');
  await expect(homes).toContainText('28,0 m²');
  await homes.getByRole('link', { name: 'Dormitorio', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/proyectos/${dormitorioId}`));

  // Y cada cuarto enseña a sus compañeros, marcando en cuál se está.
  const rooms = page.getByRole('navigation', { name: 'Cuartos de la vivienda Vivienda de Sala grande' });
  await expect(rooms.getByRole('link', { name: 'Dormitorio', exact: true })).toHaveAttribute('aria-current', 'page');
  await rooms.getByRole('link', { name: 'Sala grande', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/proyectos/${salaId}`));
  await expect(page.getByRole('heading', { name: 'Sala grande', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Añadir cuarto' })).toHaveAttribute('href', `/proyectos/nuevo?vivienda=${homeId}`);
});

test('vivienda: planta conjunta con los cuartos colocados y el presupuesto que suman', async ({ page }) => {
  const headers = await apiSession(page, 'vivienda');
  const create = async (name: string, roomType: string, homeId?: string) => {
    const res = await page.request.post('/api/projects', {
      headers,
      multipart: { name, roomType, styles: 'moderno', roomSpec: JSON.stringify(ROOM), ...(homeId ? { homeId } : {}) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { id } = await res.json();
    await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000 }).toBe('ready');
    return id as string;
  };
  const estudio = await create('Estudio de la planta', 'office');
  const home = (await (await page.request.put(`/api/projects/${estudio}/home`, { headers, data: { homeName: 'Casa con planta' } })).json()).home;
  const cuarto = await create('Cuarto de la planta', 'bedroom', home.id);

  // El tope se pone en el editor y se guarda con el proyecto: sigue ahí al volver a abrirlo.
  await page.goto(`/proyectos/${estudio}?vista=3d`);
  await page.getByText('Presupuesto', { exact: true }).click();
  await page.getByLabel('Tope (USD)').fill('50');
  await page.getByLabel('Tope (USD)').blur();
  await expect(page.locator('app-budget-panel summary')).toContainText('Te pasas');
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${estudio}`, { headers })).json()).budgetCap).toBe(50);
  await page.reload();
  await expect(page.locator('app-budget-panel summary')).toContainText('Te pasas');

  // Desde el cuarto se llega a la planta de la vivienda, con sus dos cuartos y lo que suman.
  await page.getByRole('link', { name: 'Planta de la vivienda' }).click();
  await expect(page).toHaveURL(new RegExp(`/viviendas/${home.id}$`));
  await expect(page.getByRole('heading', { name: 'Casa con planta', level: 1 })).toBeVisible();
  const plan = page.getByRole('group', { name: 'Planta de la vivienda' });
  await expect(plan.getByRole('button')).toHaveCount(2);
  await expect(page.locator('.facts')).toContainText('28,0 m²');
  await expect(page.locator('.facts')).toContainText('te pasas');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Recién creados van en fila, separados. Con el teclado se pega uno al otro y comparten pared.
  const room = plan.getByRole('button', { name: /^Cuarto de la planta/ });
  await room.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.rooms')).toContainText('junto a Estudio de la planta');
  await expect
    .poll(async () => (await (await page.request.get('/api/projects', { headers })).json()).find((p: { id: string }) => p.id === cuarto)?.homePosition)
    .toEqual({ x: 4, z: 0 });

  // Arrastrándolo se separa, y al recargar la planta está como se dejó.
  const box = (await room.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + box.width * 0.6, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.rooms')).not.toContainText('junto a');
  const saved = async () => (await (await page.request.get('/api/projects', { headers })).json()).find((p: { id: string }) => p.id === cuarto)?.homePosition?.x;
  await expect.poll(saved).toBeGreaterThan(5);
  const x = await saved();
  if (process.env.SHOTS) await page.screenshot({ path: 'shots/vivienda-planta.png', fullPage: true });
  await page.reload();
  await expect(plan.getByRole('button')).toHaveCount(2);
  expect(await saved()).toBe(x);
  await expect(page.locator('.rooms')).not.toContainText('junto a');
});
