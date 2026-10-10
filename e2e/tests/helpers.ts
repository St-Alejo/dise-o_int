import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const photo = fileURLToPath(new URL('../fixtures/room.jpg', import.meta.url));

/** Crea una cuenta nueva y deja la sesión abierta en "Mis proyectos". */
export async function signUp(page: Page, name: string): Promise<string> {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}@example.test`;
  await page.goto('/registro');
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/proyectos$/);
  return email;
}

export interface FromPhotoOptions {
  name?: string;
  /** Etiqueta del tipo de cuarto: Sala, Dormitorio, Comedor u Oficina. */
  roomType?: string;
  /** Medidas reales (ancho, largo, alto) en metros, tal como se escriben. */
  dims?: [string, string, string];
}

/** Recorre el asistente de nuevo proyecto con la foto de prueba y lo envía. */
export async function createFromPhoto(page: Page, opts: FromPhotoOptions = {}): Promise<void> {
  await page.goto('/proyectos/nuevo');
  await page.locator('input[type=file]').setInputFiles(photo);
  await expect(page.getByAltText('Vista previa de la foto seleccionada')).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente' }).click();
  if (opts.dims) {
    await page.getByLabel('Ancho (m)').fill(opts.dims[0]);
    await page.getByLabel('Largo (m)').fill(opts.dims[1]);
    await page.getByLabel('Alto (m)').fill(opts.dims[2]);
  }
  await page.getByRole('button', { name: 'Siguiente' }).click();
  if (opts.name) await page.getByLabel('Nombre del proyecto').fill(opts.name);
  if (opts.roomType) await page.getByRole('button', { name: opts.roomType }).click();
  await page.getByRole('button', { name: 'Analizar mi cuarto' }).click();
}

/** Espera a que termine el análisis y abre el editor 3D. */
export async function openEditor(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Propuestas', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: /Editor 3D/ }).click();
  await expect(page.getByText('✓ Guardado')).toBeVisible();
}
