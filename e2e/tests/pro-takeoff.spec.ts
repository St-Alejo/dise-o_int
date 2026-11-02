import { expect, test } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Modo Pro, presupuesto de obra: cómputo de un cuarto de 4 × 3 conocido, AIU editable desde la
 * pestaña Pro y descargas en CSV y PDF.
 */
test('Modo Pro: cómputo métrico y presupuesto de obra', async ({ page }) => {
  const headers = await apiSession(page, 'obra');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto Obra', roomType: 'office', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 4, depthM: 3, heightM: 2.5 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  await expect
    .poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000, intervals: [500, 1000] })
    .toBe('ready');
  expect((await page.request.patch('/api/auth/me', { headers, data: { proMode: true } })).ok()).toBeTruthy();

  const takeoff = await (await page.request.get(`/api/projects/${id}/takeoff`, { headers })).json();
  expect(takeoff.quantities.floorM2).toBe(12);
  expect(takeoff.quantities.perimeterM).toBe(14);
  expect(takeoff.lines.some((l: { code: string }) => l.code === 'skim-coat')).toBe(true);
  expect(takeoff.works).toBe(takeoff.direct + takeoff.aiu.total);
  const csv = await page.request.get(`/api/projects/${id}/takeoff.csv`, { headers });
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('Total obra');

  await page.goto(`/proyectos/${id}?vista=3d`);
  await page.getByRole('tab', { name: 'Pro', exact: true }).click();
  await page.getByText('Cantidades y presupuesto de obra').click();
  const panel = page.locator('app-takeoff-panel');
  await expect(panel.getByText(/Cronograma · /)).toBeVisible();
  await expect(panel.locator('.line').getByText('Estuco y masilla sobre muro o cielo raso')).toBeVisible();

  // La utilidad se edita en la ficha del proyecto y el servidor la usa.
  await panel.getByText('Precios y AIU del proyecto').click();
  const profit = panel.getByLabel('Utilidad %');
  await profit.fill('12');
  await profit.press('Tab');
  await expect
    .poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).technical?.rates?.aiu?.profit)
    .toBeCloseTo(0.12, 6);
  const after = await (await page.request.get(`/api/projects/${id}/takeoff`, { headers })).json();
  expect(after.aiu.profit).toBe(Math.round(after.direct * 0.12));

  const [file] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: /Excel \(CSV\)/ }).click()]);
  expect(file.suggestedFilename()).toBe('presupuesto-obra-cuarto-obra.csv');
  const [pdf] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: /Presupuesto \(PDF\)/ }).click()]);
  expect(pdf.suggestedFilename()).toBe('presupuesto-obra-cuarto-obra.pdf');
});
