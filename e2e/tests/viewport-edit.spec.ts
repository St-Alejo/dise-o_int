import { expect, test, type Page } from '@playwright/test';
import { apiSession } from './helpers';

/**
 * El visor 3D como editor: girar y estirar un mueble con el gizmo, mover una pared, pintar y
 * medir, todo sobre el 3D y con deshacer.
 */
type Headers = Record<string, string>;
interface Scene {
  tool: string;
  selectedId: string | null;
  placements: number;
  gizmo: { kind: string; x: number; y: number }[];
}
const scene = (page: Page) => page.evaluate(() => (window as unknown as { __scene: Scene }).__scene);

async function roomWithOneSofa(page: Page): Promise<{ id: string; headers: Headers }> {
  const headers = await apiSession(page, 'visor');
  const created = await page.request.post('/api/projects', {
    headers,
    multipart: { name: 'Cuarto para el visor', roomType: 'living', styles: 'moderno', roomSpec: JSON.stringify({ shape: 'rect', widthM: 5, depthM: 4, heightM: 2.6 }) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const get = async () => (await page.request.get(`/api/projects/${id}`, { headers })).json();
  await expect.poll(async () => (await get()).status, { timeout: 60_000, intervals: [500, 1000] }).toBe('ready');
  // Un sofá redimensionable en el centro: el gizmo muestra aro y tiradores.
  const catalog: { id: string; mount: string; category: string; resize?: { x?: unknown; z?: unknown } }[] = await (await page.request.get('/api/catalog', { headers })).json();
  const sofa = catalog.find((c) => c.mount === 'floor' && c.category === 'sofa' && c.resize?.x);
  expect(sofa, 'hace falta un sofá redimensionable en el catálogo').toBeTruthy();
  const saved = await page.request.put(`/api/projects/${id}/scene`, {
    headers,
    data: { revision: (await get()).revision, furniturePlacements: [{ id: 'sofa', catalogItemId: sofa!.id, position: { x: 2.5, y: 0, z: 2 }, rotationY: 0, lockedByUser: true }] },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  return { id, headers };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('visor 3D: girar y estirar con el gizmo, y la barra del mueble', async ({ page }) => {
  const { id, headers } = await roomWithOneSofa(page);
  const get = async () => (await page.request.get(`/api/projects/${id}`, { headers })).json();
  await page.goto(`/proyectos/${id}?vista=3d`);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('app-three-viewport canvas')).toBeVisible({ timeout: 30_000 });

  // Se selecciona el sofá desde la lista de objetos: aparece su gizmo.
  await page.getByRole('tab', { name: 'Objetos' }).click();
  await page.locator('app-outliner button.pick').first().click();
  await expect.poll(async () => (await scene(page)).gizmo.map((h) => h.kind)).toContain('rotate');
  expect((await scene(page)).gizmo.map((h) => h.kind)).toContain('width');

  if (process.env.SHOTS) await page.screenshot({ path: 'shots/visor-gizmo.png' });

  // Girar: el aro se arrastra alrededor del mueble.
  const before = (await scene(page)).gizmo;
  const rotate = before.find((h) => h.kind === 'rotate')!;
  const width = before.find((h) => h.kind === 'width')!;
  await drag(page, rotate, { x: width.x + 40, y: width.y + 10 });
  // El guardado es automático y tarda un momento: se espera el dato, no el rótulo.
  await expect.poll(async () => (await get()).furniturePlacements[0].rotationY, { intervals: [500, 1000] }).toBeGreaterThan(0.5);
  const turned = (await get()).furniturePlacements[0];
  // A pasos de 15°.
  const steps = turned.rotationY / (Math.PI / 12);
  expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-3);
  await expect(page.getByRole('button', { name: /^Deshacer Rotar mueble/ })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await get()).furniturePlacements[0].rotationY, { intervals: [500, 1000] }).toBe(0);

  // Estirar: el tirador de ancho se aleja del mueble y el sofá crece, en un solo paso de deshacer.
  const handle = (await scene(page)).gizmo.find((h) => h.kind === 'width')!;
  await drag(page, handle, { x: handle.x + 45, y: handle.y });
  await expect.poll(async () => (await get()).furniturePlacements[0].dimensionsM?.x ?? 0, { intervals: [500, 1000] }).toBeGreaterThan(1.6);
  await expect(page.getByRole('button', { name: /^Deshacer Cambiar medidas/ })).toBeEnabled();

  // La barra flotante del mueble: duplicar y quitar.
  const bar = page.getByRole('toolbar', { name: 'Acciones del mueble seleccionado' });
  await bar.getByRole('button', { name: 'Duplicar' }).click();
  await expect.poll(async () => (await scene(page)).placements).toBe(2);
  await bar.getByRole('button', { name: 'Quitar' }).click();
  await expect.poll(async () => (await scene(page)).placements).toBe(1);
});

test('visor 3D: mover una pared, pintarla y medir', async ({ page }) => {
  const { id, headers } = await roomWithOneSofa(page);
  const get = async () => (await page.request.get(`/api/projects/${id}`, { headers })).json();
  await page.goto(`/proyectos/${id}?vista=3d`);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const canvas = page.locator('app-three-viewport canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const box = (await canvas.boundingBox())!;
  // La pared del fondo queda arriba y hacia el centro en la vista inicial.
  const wall = { x: box.x + box.width * 0.42, y: box.y + box.height * 0.3 };
  const tools = page.getByRole('toolbar', { name: 'Herramientas del visor' });

  // Paredes (atajo W): arrastrar la pared del fondo hacia abajo la acerca.
  await canvas.focus();
  await page.keyboard.press('w');
  await expect(tools.getByRole('button', { name: 'Paredes' })).toHaveAttribute('aria-pressed', 'true');
  expect((await scene(page)).tool).toBe('room');
  await drag(page, wall, { x: wall.x, y: wall.y + 70 });
  await expect.poll(async () => (await get()).roomShell.depthM, { intervals: [500, 1000] }).toBeLessThan(3.9);
  expect((await get()).roomShell.widthM).toBe(5);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await get()).roomShell.depthM, { intervals: [500, 1000] }).toBe(4);

  // Pintar: un clic en la pared abre su paleta; elegir un color la pinta solo a ella.
  await tools.getByRole('button', { name: 'Pintar' }).click();
  await page.mouse.click(wall.x, wall.y);
  const palette = page.locator('app-paint-palette');
  await expect(palette.getByText('Pared', { exact: true })).toBeVisible();
  const colourOf = async (wallId: string) => {
    const finishes = (await get()).finishes;
    return finishes ? (finishes.walls[wallId] ?? finishes.walls.all) : null;
  };
  const backBefore = await colourOf('w-back');
  const leftBefore = await colourOf('w-left');
  const swatch = palette.locator('button.swatch[aria-pressed="false"]').last();
  const colour = await swatch.getAttribute('aria-label');
  await swatch.click();
  await expect(palette.getByRole('button', { name: colour! })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => colourOf('w-back'), { intervals: [500, 1000] }).not.toBe(backBefore);
  // Las demás paredes siguen como estaban.
  if (leftBefore) expect(await colourOf('w-left')).toBe(leftBefore);
  if (process.env.SHOTS) await page.screenshot({ path: 'shots/visor-pintar.png' });
  await palette.getByRole('button', { name: 'Cerrar la paleta' }).click();

  // Medir: la regla muestra la distancia entre dos puntos del piso.
  await tools.getByRole('button', { name: 'Medir' }).click();
  await drag(page, { x: box.x + box.width * 0.35, y: box.y + box.height * 0.65 }, { x: box.x + box.width * 0.65, y: box.y + box.height * 0.65 });
  await expect(page.locator('.scene-label-measure')).toHaveText(/^\d,\d\d m$/);
  if (process.env.SHOTS) await page.screenshot({ path: 'shots/visor-medir.png' });
  // Vistas rápidas: desde arriba la cámara queda sobre el centro del cuarto; "Esquina" la devuelve.
  const camera = async () => (await page.evaluate(() => (window as unknown as { __scene: { camera: { x: number; y: number; z: number } } }).__scene)).camera;
  await page.getByText('Vista', { exact: true }).click();
  await page.getByRole('button', { name: 'Desde arriba' }).click();
  await expect.poll(async () => (await camera()).y).toBeGreaterThan(9);
  expect((await camera()).x).toBeCloseTo(2.5, 1);
  await page.getByText('Vista', { exact: true }).click();
  await page.getByRole('button', { name: 'Esquina' }).click();
  await expect.poll(async () => (await camera()).y).toBeLessThan(8);

  // Escape vuelve a la herramienta de mover.
  await canvas.focus();
  await page.keyboard.press('Escape');
  expect((await scene(page)).tool).toBe('select');
});
