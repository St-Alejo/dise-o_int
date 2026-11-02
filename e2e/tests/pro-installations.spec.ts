import { expect, test } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Modo Pro, instalaciones: la propuesta automática se guarda en la ficha, aparece el cuadro de
 * cargas, el plano eléctrico se vuelve una lámina y la normativa revisa las reglas RETIE.
 */
test('Modo Pro: propuesta de instalaciones, cuadro de cargas y plano eléctrico', async ({ page }) => {
  const headers = await apiSession(page, 'instalaciones');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto Redes', roomType: 'bedroom', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 4, depthM: 3.5, heightM: 2.5 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  await expect
    .poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000, intervals: [500, 1000] })
    .toBe('ready');
  expect((await page.request.patch('/api/auth/me', { headers, data: { proMode: true } })).ok()).toBeTruthy();

  await page.goto(`/proyectos/${id}?vista=3d`);
  await page.getByRole('tab', { name: 'Pro', exact: true }).click();
  await page.getByText('Instalaciones', { exact: true }).click();
  const panel = page.locator('app-installations-panel');
  await panel.getByRole('button', { name: 'Proponer instalaciones' }).click();
  await expect(panel.getByText(/Cuadro de cargas · 120 V/)).toBeVisible();
  await expect(panel.getByRole('button', { name: /Quitar propuestas/ })).toBeVisible();

  // Quedó guardado en la ficha y el servidor lo usa en la normativa y en los planos.
  await expect
    .poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).technical?.installations?.points?.length ?? 0)
    .toBeGreaterThan(4);
  const report = await (await page.request.get(`/api/projects/${id}/compliance`, { headers })).json();
  const electrical = report.findings.filter((f: { group: string }) => f.group === 'electrical');
  expect(electrical.length).toBeGreaterThan(2);
  expect(electrical.every((f: { status: string }) => f.status === 'pass')).toBe(true);
  const dxf = await page.request.get(`/api/projects/${id}/drawings/electrical.dxf`, { headers });
  expect(dxf.ok(), await dxf.text()).toBeTruthy();
  expect(await dxf.text()).toContain('E-POWR');

  // Quitar un punto lo saca de la lista.
  const before = await panel.locator('.pt').count();
  await panel.locator('.pt').first().getByRole('button').click();
  await expect(panel.locator('.pt')).toHaveCount(before - 1);
});
