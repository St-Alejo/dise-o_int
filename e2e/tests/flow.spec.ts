import { expect, test } from '@playwright/test';
import { photo } from './helpers';

/**
 * Flujo principal del documento (§3): cuenta → foto → propuestas 2D → editor 3D →
 * guardar versión → compartir → vista pública.
 */
test('flujo completo: de la foto al proyecto compartido', async ({ page, context }) => {
  const email = `e2e-${Date.now()}@example.test`;

  await page.goto('/registro');
  await page.getByLabel('Nombre').fill('E2E');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/proyectos$/);

  // La sesión sobrevive a una recarga (refresh token en cookie httpOnly).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mis proyectos' })).toBeVisible();

  // Asistente de tres pasos: la foto, la forma y medidas (las decide la foto) y el estilo.
  await page.goto('/proyectos/nuevo');
  await page.locator('input[type=file]').setInputFiles(photo);
  await expect(page.getByAltText('Vista previa de la foto seleccionada')).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByRole('button', { name: 'Según la foto' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByLabel('Nombre del proyecto').fill('Sala E2E');
  await page.getByRole('button', { name: 'Analizar mi cuarto' }).click();

  // Propuestas 2D: comparador antes/después accesible por teclado
  await expect(page.getByRole('heading', { name: 'Propuestas', exact: true })).toBeVisible({ timeout: 60_000 });
  const slider = page.getByRole('slider', { name: 'Comparar antes y después' });
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');

  // Editor 3D
  await page.getByRole('tab', { name: /Editor 3D/ }).click();
  await expect(page.locator('app-three-viewport canvas')).toBeVisible();
  await expect(page.getByText('✓ Guardado')).toBeVisible();
  await expect(page.getByText(/\d+ muebles/)).toBeVisible();
  // La escena 3D tiene el cuarto montado: sus paredes, techo y los muebles del proyecto.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __scene?: { walls: number; hasCeiling: boolean; placements: number } }).__scene))
    .toMatchObject({ walls: 4, hasCeiling: true, cameraMode: 'orbit' });

  // Guardar versión: el proyecto deja de estar sujeto a la limpieza de 24 h
  await page.getByRole('button', { name: /Guardar versión/ }).click();
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible();

  // Compartir y abrir la vista pública en una sesión anónima
  await page.getByRole('button', { name: /Compartir/ }).click();
  const linkInput = page.getByLabel('Enlace para compartir');
  await expect(linkInput).toHaveValue(/\/p\/[A-Za-z0-9_-]{20,}$/);
  const link = await linkInput.inputValue();
  const anon = await context.browser()!.newContext();
  const pub = await anon.newPage();
  await pub.goto(link);
  await expect(pub.getByText('Proyecto compartido · solo lectura')).toBeVisible();
  await expect(pub.getByRole('heading', { name: 'Lista de compras' })).toBeVisible();
  await anon.close();
});

test('rutas protegidas redirigen al login conservando el destino', async ({ page }) => {
  await page.goto('/proyectos/nuevo');
  await expect(page).toHaveURL(/\/entrar\?volver=%2Fproyectos%2Fnuevo/);
});
