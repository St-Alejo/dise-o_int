import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * El plano editable: en la vista dividida se arrastra una pared y el 3D la sigue, Ctrl+Z la
 * devuelve, y los muebles se mueven en el plano igual que en el visor.
 */
const ROOM = { shape: 'rect', widthM: 5, depthM: 4, heightM: 2.6 };

type Headers = Record<string, string>;
interface Project {
  revision: number;
  roomShell: { widthM: number; depthM: number; walls: unknown[] };
  furniturePlacements: { id: string; position: { x: number; z: number } }[];
}

async function createRoom(page: Page): Promise<{ id: string; headers: Headers }> {
  const headers = await apiSession(page, 'plano');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto para editar', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify(ROOM) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  await expect
    .poll(async () => (await (await page.request.get(`/api/projects/${id}`, { headers })).json()).status, { timeout: 60_000, intervals: [500, 1000] })
    .toBe('ready');
  return { id, headers };
}

const get = async (page: Page, id: string, headers: Headers): Promise<Project> => (await page.request.get(`/api/projects/${id}`, { headers })).json();

/** Deja en el cuarto un solo mueble, en el centro: así las pruebas no dependen de la distribución generada. */
async function onlyOneTable(page: Page, id: string, headers: Headers): Promise<void> {
  const catalog: { id: string; mount: string; category: string }[] = await (await page.request.get('/api/catalog', { headers })).json();
  const table = catalog.find((c) => c.mount === 'floor' && c.category === 'table')!;
  const before = await get(page, id, headers);
  const saved = await page.request.put(`/api/projects/${id}/scene`, {
    headers,
    data: { revision: before.revision, furniturePlacements: [{ id: 'mesa', catalogItemId: table.id, position: { x: 2.5, y: 0, z: 2 }, rotationY: 0, lockedByUser: true }] },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
}

/** Centro en pantalla de un elemento del SVG (una línea no tiene caja "clicable" para Playwright). */
async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

test('plano editable: mover una pared cambia el cuarto, se guarda y se deshace', async ({ page }) => {
  const { id, headers } = await createRoom(page);
  await page.goto(`/proyectos/${id}?vista=3d`);
  await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });

  // En una pantalla ancha el editor abre en vista dividida: plano y 3D a la vez.
  const plan = page.locator('app-plan-editor');
  await expect(page.getByRole('button', { name: 'Dividida' })).toHaveAttribute('aria-pressed', 'true');
  await expect(plan.locator('svg')).toBeVisible();
  await expect(plan.getByText('20,0 m²')).toBeVisible();
  await expect(plan.locator('text.dim').filter({ hasText: '5,00 m' })).toHaveCount(2);

  await plan.getByRole('button', { name: 'Editar paredes' }).click();
  // La segunda pared es la de la derecha: se arrastra hacia dentro.
  const right = await centreOf(plan.locator('line.wall-grip').nth(1));
  await drag(page, right, -70, 10);

  await expect(page.getByText('✓ Guardado')).toBeVisible();
  const narrower = await get(page, id, headers);
  expect(narrower.roomShell.widthM).toBeLessThan(4.6);
  expect(narrower.roomShell.widthM).toBeGreaterThan(2);
  expect(narrower.roomShell.depthM).toBe(4);
  // Todos los muebles siguen dentro del cuarto más angosto.
  for (const p of narrower.furniturePlacements) expect(p.position.x).toBeLessThan(narrower.roomShell.widthM);
  await expect(page.getByRole('button', { name: /^Deshacer Mover pared/ })).toBeEnabled();

  await page.keyboard.press('Control+z');
  await expect(plan.getByText('20,0 m²')).toBeVisible();
  await expect(page.getByText('✓ Guardado')).toBeVisible();
  await expect.poll(async () => (await get(page, id, headers)).roomShell.widthM, { intervals: [500, 1000] }).toBe(5);
});

test('plano editable: arrastrar un mueble lo mueve y las vistas se pueden alternar', async ({ page }) => {
  const { id, headers } = await createRoom(page);
  await onlyOneTable(page, id, headers);

  await page.goto(`/proyectos/${id}?vista=3d`);
  const plan = page.locator('app-plan-editor');
  const piece = plan.locator('polygon.item');
  await expect(piece).toHaveCount(1);

  await drag(page, await centreOf(piece), 60, 45);
  await expect(piece).toHaveAttribute('aria-pressed', 'true');
  // Seleccionado, el plano muestra sus cotas hasta las cuatro paredes.
  await expect(plan.locator('text.clearance-text')).toHaveCount(4);
  await expect(page.getByText('✓ Guardado')).toBeVisible();
  const moved = (await get(page, id, headers)).furniturePlacements[0]!;
  expect(moved.position.x).toBeGreaterThan(2.8);
  expect(moved.position.z).toBeGreaterThan(2.2);

  // Con el mueble seleccionado, las flechas lo mueven también desde el plano.
  await piece.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByText('✓ Guardado')).toBeVisible();
  await expect
    .poll(async () => (await get(page, id, headers)).furniturePlacements[0]!.position.x, { intervals: [500, 1000] })
    .toBeCloseTo(moved.position.x - 0.25, 2);

  // Solo plano: el visor 3D se oculta sin destruirse; solo 3D: el plano desaparece.
  await page.getByRole('button', { name: 'Plano', exact: true }).click();
  await expect(page.locator('app-three-viewport')).toBeHidden();
  await expect(plan.locator('svg')).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(plan).toHaveCount(0);
  await expect(page.locator('app-three-viewport canvas')).toBeVisible();
  // La vista elegida se recuerda al volver.
  await page.reload();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('editor: lista de objetos, duplicar, arrastrar del catálogo, vaciar y exportar', async ({ page }) => {
  const { id, headers } = await createRoom(page);
  await onlyOneTable(page, id, headers);
  await page.goto(`/proyectos/${id}?vista=3d`);
  const plan = page.locator('app-plan-editor');
  const pieces = plan.locator('polygon.item');
  await expect(pieces).toHaveCount(1);

  // La lista de objetos selecciona la pieza; Ctrl+D la duplica en el hueco libre de al lado.
  await page.getByRole('tab', { name: 'Objetos' }).click();
  const rows = page.locator('app-outliner li.line');
  await expect(rows).toHaveCount(1);
  await rows.first().locator('button.pick').click();
  await expect(pieces.first()).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+d');
  await expect(pieces).toHaveCount(2);

  // Un mueble del catálogo se arrastra al plano y cae donde se suelta.
  await page.getByRole('button', { name: 'Deseleccionar' }).click();
  await page.getByRole('tab', { name: 'Añadir muebles' }).click();
  await page.getByLabel('Buscar en el catálogo').fill('sofá');
  await page.locator('app-catalog-panel button.item').first().dragTo(plan.locator('svg'), { targetPosition: { x: 120, y: 330 } });
  await expect(pieces).toHaveCount(3);
  await expect(page.getByText('✓ Guardado')).toBeVisible();
  expect((await get(page, id, headers)).furniturePlacements).toHaveLength(3);

  // Vaciar el cuarto es un solo paso: Ctrl+Z devuelve todo.
  await page.getByRole('button', { name: 'Deseleccionar' }).click();
  await page.getByRole('tab', { name: 'Objetos' }).click();
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Vaciar cuarto' }).click();
  await expect(pieces).toHaveCount(0);
  await expect(page.getByText('El cuarto está vacío')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(pieces).toHaveCount(3);

  // Exportar: el plano con sus cotas y la imagen del 3D.
  await page.getByText('Exportar', { exact: true }).click();
  const [planFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Plano con medidas/ }).click()]);
  expect(planFile.suggestedFilename()).toBe('plano-cuarto-para-editar.svg');
  const svg = (await (await planFile.createReadStream()).toArray()).join('');
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('5,00 m');
  expect(svg).toContain('Cuarto para editar · 5,00 × 4,00 m · 20,0 m²');

  await page.getByText('Exportar', { exact: true }).click();
  const [image] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Imagen del cuarto/ }).click()]);
  expect(image.suggestedFilename()).toBe('cuarto-para-editar.png');
  const png = Buffer.concat(await (await image.createReadStream()).toArray());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.length).toBeGreaterThan(5_000);
});
