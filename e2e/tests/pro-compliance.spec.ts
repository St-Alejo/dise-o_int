import { expect, test } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Modo Pro, normativa: la pestaña Pro revisa el cuarto con el perfil de la ficha, muestra el mapa
 * de luz de noche y de día, suma lo que no cumple a la revisión del diseño y da el informe en PDF.
 */
test('Modo Pro: normativa, mapa de luz e informe', async ({ page }) => {
  const headers = await apiSession(page, 'norma');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto Norma', roomType: 'bedroom', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 4, depthM: 3.2, heightM: 2.3 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  await expect
    .poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000, intervals: [500, 1000] })
    .toBe('ready');
  expect((await page.request.patch('/api/auth/me', { headers, data: { proMode: true } })).ok()).toBeTruthy();

  // La API revisa con el perfil de la ficha: 2,30 m de altura es poco para Neufert (2,40).
  const report = await (await page.request.get(`/api/projects/${id}/compliance`, { headers })).json();
  expect(report.profile.id).toBe('neufert');
  expect(report.findings.find((f: { id: string }) => f.id === 'ceiling-height').status).toBe('warn');
  expect((await page.request.get(`/api/projects/${id}/compliance?hour=30`, { headers })).status()).toBe(422);

  await page.goto(`/proyectos/${id}?vista=3d`);
  await page.getByRole('tab', { name: 'Pro', exact: true }).click();
  await page.getByText('Normativa y ergonomía').click();
  const panel = page.locator('app-compliance-panel');
  await expect(panel.getByText('Altura libre', { exact: true })).toBeVisible();
  await expect(panel.getByRole('img', { name: /Mapa de luz de las lámparas/ })).toBeVisible();
  await panel.getByRole('radio', { name: 'De día' }).click();
  await expect(panel.getByRole('img', { name: /Mapa de luz natural/ })).toBeVisible();
  await expect(panel.getByText(/Hora solar: 12:00/)).toBeVisible();

  // Con el perfil colombiano (2,20 m) la altura ya cumple.
  const technical = (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).technical;
  expect((await page.request.put(`/api/projects/${id}/technical`, { headers, data: { technical: { ...(technical ?? {}), compliance: { profile: 'colombia', accessible: true } } } })).ok()).toBeTruthy();
  const colombia = await (await page.request.get(`/api/projects/${id}/compliance`, { headers })).json();
  expect(colombia.findings.find((f: { id: string }) => f.id === 'ceiling-height').status).toBe('pass');
  expect(colombia.findings.some((f: { ruleId: string }) => f.ruleId === 'turning-circle')).toBe(true);

  const [pdf] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: /Informe de normativa/ }).click()]);
  expect(pdf.suggestedFilename()).toBe('normativa-cuarto-norma.pdf');
  const file = await page.request.get(`/api/projects/${id}/compliance.pdf`, { headers });
  expect(file.headers()['content-type']).toContain('application/pdf');

  // Lo que no cumple también sale en la revisión del diseño.
  await page.getByRole('tab', { name: 'Objetos' }).click();
  await expect(page.locator('app-design-review').getByText(/Normativa ·/)).toBeVisible();
});
