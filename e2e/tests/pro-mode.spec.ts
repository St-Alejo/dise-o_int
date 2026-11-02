import { expect, test } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Modo Pro: se activa desde la cabecera, aparece la pestaña Pro con la vista previa de las
 * láminas, se traza el corte y se descargan el DXF y el juego de planos en PDF.
 */
test('Modo Pro: planos técnicos con corte, DXF y PDF', async ({ page }) => {
  const headers = await apiSession(page, 'pro');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Estudio Pro', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 4.5, depthM: 3.6, heightM: 2.6 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  await expect
    .poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000, intervals: [500, 1000] })
    .toBe('ready');

  await page.goto(`/proyectos/${id}?vista=3d`);
  // Sin Modo Pro no hay pestaña Pro.
  await expect(page.getByRole('tab', { name: 'Objetos' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tab', { name: 'Pro', exact: true })).toHaveCount(0);

  const toggle = page.getByRole('button', { name: 'Modo Pro' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await (await page.request.get('/api/auth/me', { headers })).json()).proMode).toBe(true);

  await page.getByRole('tab', { name: 'Pro', exact: true }).click();
  const panel = page.locator('app-drawings-panel');
  await expect(panel.getByAltText(/Planta arquitectónica a escala/)).toBeVisible();

  // El corte se guarda en la ficha y aparece como lámina.
  await panel.getByRole('button', { name: 'Trazar corte' }).click();
  await expect(panel.getByAltText(/Corte A–A'/)).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).technical?.section?.a?.z)
    .toBeCloseTo(1.8, 2);

  const [dxf] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: /CAD \(DXF\)/ }).click()]);
  expect(dxf.suggestedFilename()).toMatch(/^planos-estudio-pro-section\.dxf$/);

  const [pdf] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: /Juego de planos/ }).click()]);
  expect(pdf.suggestedFilename()).toBe('planos-estudio-pro.pdf');

  // El servidor da el juego de planos entero y la lámina en DXF con sus capas.
  const set = await page.request.get(`/api/projects/${id}/drawings/set.pdf`, { headers });
  expect(set.headers()['content-type']).toContain('application/pdf');
  const cad = await (await page.request.get(`/api/projects/${id}/drawings/architectural.dxf`, { headers })).text();
  expect(cad).toContain('A-WALL');
  expect(cad).toContain('A-ANNO-DIMS');
  expect((await page.request.get(`/api/projects/${id}/drawings/nada.svg`, { headers })).status()).toBe(422);

  // Se apaga y la pestaña desaparece.
  await toggle.click();
  await expect(page.getByRole('tab', { name: 'Pro', exact: true })).toHaveCount(0);
});
