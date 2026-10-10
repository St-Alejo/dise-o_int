import { expect, test } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * Revisión del diseño: un mueble delante de la puerta se avisa, el aviso lleva al mueble y al
 * quitarlo desaparece.
 */
interface Wall {
  id: string;
  start: { x: number; z: number };
  end: { x: number; z: number };
}
interface Opening {
  type: string;
  wallId: string;
  offsetM: number;
}

test('revisión: avisa de la puerta bloqueada y deja de avisar al corregirlo', async ({ page }) => {
  const headers = await apiSession(page, 'revision');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto para revisar', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 5, depthM: 4, heightM: 2.6 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const get = async () => (await page.request.get(`/api/projects/${id}`, { headers })).json();
  await expect.poll(async () => (await get()).status, { timeout: 60_000, intervals: [500, 1000] }).toBe('ready');

  // Un mueble alto justo donde queda quien entra por la puerta.
  const project = await get();
  const door: Opening = project.roomShell.openings.find((o: Opening) => o.type === 'door');
  const wall: Wall = project.roomShell.walls.find((w: Wall) => w.id === door.wallId);
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
  const at = { x: wall.start.x + ((wall.end.x - wall.start.x) / length) * door.offsetM, z: wall.start.z + ((wall.end.z - wall.start.z) / length) * door.offsetM };
  const towardsCentre = { x: 2.5 - at.x, z: 2 - at.z };
  const reach = 0.55 / Math.hypot(towardsCentre.x, towardsCentre.z);
  const catalog: { id: string; name: string; mount: string; subcategory?: string }[] = await (await page.request.get('/api/catalog', { headers })).json();
  const shelf = catalog.find((c) => c.mount === 'floor' && c.subcategory === 'shelf')!;
  const lampItem = catalog.find((c) => c.mount === 'floor' && c.subcategory === 'floor-lamp')!;
  const saved = await page.request.put(`/api/projects/${id}/scene`, {
    headers,
    data: {
      revision: project.revision,
      furniturePlacements: [
        { id: 'estorbo', catalogItemId: shelf.id, position: { x: at.x + towardsCentre.x * reach, y: 0, z: at.z + towardsCentre.z * reach }, rotationY: 0, lockedByUser: true },
        { id: 'luz', catalogItemId: lampItem.id, position: { x: 2.5, y: 0, z: 0.4 }, rotationY: 0, lockedByUser: true },
      ],
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();

  await page.goto(`/proyectos/${id}?vista=3d`);
  const review = page.getByRole('button', { name: /^Revisión/ });
  await expect(review.getByLabel('1 avisos')).toBeVisible({ timeout: 30_000 });
  await review.click();

  const panel = page.locator('app-design-review');
  const issue = panel.getByRole('button', { name: /La puerta queda bloqueada/ });
  await expect(issue).toContainText(shelf.name);

  // El aviso lleva al mueble: queda seleccionado y se puede quitar.
  await issue.click();
  await expect(page.locator('app-inspector').getByRole('heading', { name: shelf.name })).toBeVisible();
  await page.locator('app-inspector').getByRole('button', { name: 'Quitar' }).click();

  await expect(review.locator('.count')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Objetos' }).click();
  await expect(panel.getByText('Todo en orden')).toBeVisible();
});
