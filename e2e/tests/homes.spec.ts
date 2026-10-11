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
