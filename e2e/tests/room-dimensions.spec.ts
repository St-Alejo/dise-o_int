import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const photo = fileURLToPath(new URL('../fixtures/room.jpg', import.meta.url));

/**
 * Fase 1 (v3): medidas reales al crear el proyecto y "Medidas del cuarto" en el editor
 * (ancho/largo/alto exactos, puertas y ventanas), con vista previa y accesibilidad.
 */
test('cuarto a medida: medidas al crear y edición exacta en el editor', async ({ page }) => {
  await page.goto('/registro');
  await page.getByLabel('Nombre').fill('Medidas');
  await page.getByLabel('Email').fill(`medidas-${Date.now()}@example.test`);
  await page.getByLabel('Contraseña').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/proyectos$/);

  // Nuevo proyecto con medidas reales: si falta una, no deja enviar.
  await page.goto('/proyectos/nuevo');
  await page.locator('input[type=file]').setInputFiles(photo);
  await page.getByText('Conozco las medidas del cuarto').click();
  await page.getByLabel('Ancho (m)').fill('4.2');
  await expect(page.getByText('Escribe ancho, largo y alto')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analizar mi cuarto' })).toBeDisabled();
  await page.getByLabel('Largo (m)').fill('3.6');
  await page.getByLabel('Alto (m)').fill('2.55');
  await page.getByRole('button', { name: 'Analizar mi cuarto' }).click();

  await expect(page.getByRole('heading', { name: 'Propuestas', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: /Editor 3D/ }).click();
  await expect(page.getByText('✓ Guardado')).toBeVisible();
  // Con medidas reales la escala está confirmada: no se pide calibrar.
  await expect(page.getByText(/Medidas aproximadas/)).toHaveCount(0);

  // Diálogo de medidas: precargado con lo que dio el usuario.
  await page.getByRole('button', { name: /Medidas del cuarto/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Medidas del cuarto' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Ancho del cuarto')).toHaveValue('4.2');
  await expect(dialog.getByLabel('Alto del techo')).toHaveValue('2.55');

  const axe = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);

  // Validación en vivo con la misma geometría del servidor.
  await dialog.getByLabel('Alto del techo').fill('9');
  await expect(dialog.getByRole('alert')).toContainText('alto');
  await expect(dialog.getByRole('button', { name: 'Aplicar medidas' })).toBeDisabled();

  // Cuarto más chico + una ventana nueva → se aplica y se reacomoda.
  await dialog.getByLabel('Alto del techo').fill('2.4');
  await dialog.getByLabel('Ancho del cuarto').fill('3.1');
  await dialog.getByRole('button', { name: '+ Ventana' }).click();
  await expect(dialog.getByText(/Quedará de 3.10 × 3.60 m/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Aplicar medidas' }).click();
  await expect(page.getByText('Medidas del cuarto actualizadas.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('✓ Guardado')).toBeVisible();

  // Persiste tras recargar.
  await page.reload();
  await page.getByRole('tab', { name: /Editor 3D/ }).click();
  await page.getByRole('button', { name: /Medidas del cuarto/ }).click();
  await expect(page.getByRole('dialog', { name: 'Medidas del cuarto' }).getByLabel('Ancho del cuarto')).toHaveValue('3.1');
});
