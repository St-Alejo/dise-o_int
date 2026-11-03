import { expect, test } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Render en Blender de punta a punta: estudio → motor Blender → la API encola → el nodo renderiza
 * → la galería lo muestra con sus descargas. En CI el nodo es `blender-fake` (perfil e2e-render de
 * compose): mismo contrato, sin GPU. Sin nodo encendido la prueba se salta.
 */
const ROOM = { shape: 'rect', widthM: 4.5, depthM: 3.8, heightM: 2.6 };

test('mandar el cuarto a Blender y verlo terminado en la galería', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'El estudio de render es de escritorio');
  const headers = await apiSession(page, 'blender');
  const node = await (await page.request.get('/api/render-node', { headers })).json();
  test.skip(!node.available, 'No hay nodo Blender (COMPOSE_PROFILES=e2e-render levanta el falso)');

  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Sala para Blender', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify(ROOM) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000 }).toBe('ready');

  await page.goto(`/proyectos/${id}?vista=3d`);
  await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Render realista' }).click();
  const blender = page.getByRole('button', { name: 'Blender (fotorrealista)' });
  await expect(blender).toBeEnabled();
  await blender.click();
  await page.getByRole('button', { name: 'Borrador' }).click();
  await page.getByRole('button', { name: 'Renderizar en Blender' }).click();

  // El estudio se cierra enseguida y el aviso lleva a la galería, donde el render ya aparece.
  await page.getByRole('button', { name: 'Ver galería' }).click();
  const gallery = page.getByRole('dialog', { name: 'Galería de renders' });
  await expect(gallery.getByText('Blender', { exact: true })).toBeVisible();

  // Al terminar avisa y la tarjeta trae la imagen y las dos descargas.
  await expect(page.getByText('Tu render en Blender está listo')).toBeVisible({ timeout: 60_000 });
  await expect(gallery.locator('img')).toBeVisible();
  await expect(gallery.getByRole('link', { name: 'PNG' })).toHaveAttribute('download', /sala-para-blender-blender-dia\.png/);
  const blend = gallery.getByRole('link', { name: '.blend' });
  const file = await page.request.get((await blend.getAttribute('href'))!);
  expect(file.headers()['content-type']).toBe('application/x-blender');

  // Borrar lo quita de la galería.
  await gallery.getByRole('button', { name: 'Borrar' }).click();
  await gallery.getByRole('button', { name: 'Sí, borrar' }).click();
  await expect(gallery.getByText('Aún no hay renders')).toBeVisible();
});
