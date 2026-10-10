import { expect, test, type Page } from '@playwright/test';

/**
 * Cuartos de forma libre de extremo a extremo: se crean por la API con su forma y medidas (sin
 * foto), el worker los amuebla y el editor los dibuja con todas sus paredes.
 */
const SHAPES = [
  { shape: 'L', walls: 6, roomType: 'living', spec: { widthM: 5.5, depthM: 4.5, heightM: 2.6, notchWidthM: 2.2, notchDepthM: 1.8 } },
  { shape: 'U', walls: 8, roomType: 'bedroom', spec: { widthM: 6, depthM: 4.5, heightM: 2.6 } },
  { shape: 'T', walls: 8, roomType: 'dining', spec: { widthM: 6, depthM: 5, heightM: 2.7 } },
] as const;

async function register(page: Page): Promise<Record<string, string>> {
  const res = await page.request.post('/api/auth/register', {
    data: { email: `shapes-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`, password: 'e2e-password-123', displayName: 'Formas' },
  });
  expect(res.ok()).toBeTruthy();
  return { Authorization: `Bearer ${(await res.json()).accessToken}` };
}

for (const room of SHAPES) {
  test(`cuarto en ${room.shape}: se crea sin foto, se amuebla y se dibuja con ${room.walls} paredes`, async ({ page }) => {
    const headers = await register(page);
    const created = await page.request.post('/api/projects', {
      headers,
      multipart: { name: `Cuarto en ${room.shape}`, roomType: room.roomType, styles: 'moderno', roomSpec: JSON.stringify({ shape: room.shape, ...room.spec }) },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = await created.json();

    // Sin foto no hay análisis: el worker amuebla el cuarto y el proyecto queda listo.
    await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000 }).toBe('ready');
    const project = await (await page.request.get(`/api/projects/${id}`, { headers })).json();
    expect(project.roomShell.shape).toBe(room.shape);
    expect(project.roomShell.walls).toHaveLength(room.walls);
    expect(project.sourcePhotoUrl).toBeNull();
    expect(project.furniturePlacements.length).toBeGreaterThan(2);

    await page.goto(`/proyectos/${id}?vista=3d`);
    await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __scene?: { walls: number; hasCeiling: boolean; placements: number } }).__scene))
      .toMatchObject({ walls: room.walls, hasCeiling: true, placements: project.furniturePlacements.length });
  });
}
