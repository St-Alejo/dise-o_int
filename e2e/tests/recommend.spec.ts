import { expect, test } from '@playwright/test';
import { apiSession } from './helpers';

// "Recomendar" respeta lo fijado: con el piso de baldosa azul y verde fijado en el Brief, tres
// propuestas seguidas cambian estilo o paredes pero nunca el piso.
const TILE = { name: 'Baldosa brillante azul claro y verde', kind: 'tile', colors: ['#a9d4ee', '#9bd3b0'], pattern: 'mosaic', gloss: 0.85, tileSizeM: 0.1 };

test('Recomendar mantiene el piso fijado y cambia lo demás', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const headers = await apiSession(page, 'recomendar');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Sala', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 4.5, depthM: 4, heightM: 2.6 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const get = async () => (await page.request.get(`/api/projects/${id}`, { headers })).json();
  await expect.poll(async () => (await get()).status, { timeout: 60_000 }).toBe('ready');
  const brief = await page.request.put(`/api/projects/${id}/brief`, { headers, data: { brief: { surfaces: { floor: { spec: TILE } } } } });
  expect(brief.ok(), await brief.text()).toBeTruthy();

  await page.goto(`/proyectos/${id}?vista=3d`);
  await expect(page.locator('app-three-viewport canvas')).toBeVisible();
  // El Brief se ve como un chip con candado.
  await page.getByRole('tab', { name: 'Lo que pediste' }).click();
  await expect(page.getByRole('button', { name: 'Soltar Piso' })).toHaveAttribute('aria-pressed', 'true');

  const seen: { floor: string; colors: string[]; style: string; walls: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const before = (await get()).revision;
    await page.getByRole('toolbar').getByRole('button', { name: 'Recomendar' }).click();
    await expect(page.getByRole('region', { name: 'Propuesta recomendada' })).toBeVisible();
    // Acabados y estilo al momento; luego la distribución nueva (otra revisión más).
    await expect.poll(async () => (await get()).revision, { timeout: 60_000 }).toBeGreaterThan(before + 1);
    await expect(page.getByText('Acomodando los muebles…')).toBeHidden({ timeout: 30_000 });
    const p = await get();
    seen.push({ floor: p.finishes.floor, colors: p.finishes.custom?.[p.finishes.floor]?.colors, style: p.selectedStyleId, walls: JSON.stringify(p.finishes.walls) });
  }
  expect(new Set(seen.map((s) => s.floor)).size).toBe(1);
  for (const s of seen) expect(s.colors).toEqual(TILE.colors);
  expect(new Set(seen.map((s) => `${s.style}|${s.walls}`)).size).toBeGreaterThan(1);

  // 👍 queda anotado y "Deshacer" vuelve a la propuesta anterior en un solo paso.
  await page.getByRole('button', { name: 'Me gusta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Me gusta', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (process.env['SHOT_TAG']) await page.screenshot({ path: `shots/${process.env['SHOT_TAG']}-recomendar.png` });
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Propuesta recomendada' })).toBeHidden();
  await expect.poll(async () => JSON.stringify((await get()).finishes.walls), { timeout: 20_000 }).toBe(seen[1]!.walls);
});
