import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const photo = fileURLToPath(new URL('../fixtures/room.jpg', import.meta.url));

const furnitureCount = async (page: Page) => Number(await page.locator('.summary strong').first().innerText());

/**
 * Fase 4: chat de diseño. Sin ANTHROPIC_API_KEY responde el agente por reglas (determinista),
 * con las mismas herramientas y el mismo resolvedor espacial que Claude.
 */
test('chat: agrega muebles con relaciones, pinta, deshace en un paso y persiste', async ({ page }) => {
  await page.goto('/registro');
  await page.getByLabel('Nombre').fill('Chat');
  await page.getByLabel('Email').fill(`chat-${Date.now()}@example.test`);
  await page.getByLabel('Contraseña').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/proyectos$/);

  await page.goto('/proyectos/nuevo');
  await page.locator('input[type=file]').setInputFiles(photo);
  await page.getByText('Conozco las medidas del cuarto').click();
  await page.getByLabel('Ancho (m)').fill('5');
  await page.getByLabel('Largo (m)').fill('4.5');
  await page.getByLabel('Alto (m)').fill('2.6');
  await page.getByRole('button', { name: 'Analizar mi cuarto' }).click();
  await expect(page.getByRole('heading', { name: 'Propuestas', exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: /Editor 3D/ }).click();
  await expect(page.getByText('✓ Guardado')).toBeVisible();

  await page.getByRole('tab', { name: 'Asistente IA' }).click();
  const chat = page.locator('app-chat-panel');
  await expect(chat.getByRole('group', { name: 'Sugerencias' })).toBeVisible();

  const axe = await new AxeBuilder({ page }).include('app-chat-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);

  const before = await furnitureCount(page);
  const input = chat.getByLabel('Mensaje para el asistente');
  await input.fill('Agrega un sofá y pon una lámpara de pie junto al sofá');
  await input.press('Enter');
  await expect(chat.getByText(/Agregué Lámpara de pie/)).toBeVisible({ timeout: 20_000 });
  await expect(chat.getByText('Básico').last()).toBeVisible();
  await expect.poll(() => furnitureCount(page)).toBe(before + 2);

  // Un solo Deshacer revierte todo lo que hizo el asistente en ese mensaje.
  await chat.getByRole('button', { name: 'Deshacer' }).click();
  await expect.poll(() => furnitureCount(page)).toBe(before);
  await page.keyboard.press('Control+y');
  await expect.poll(() => furnitureCount(page)).toBe(before + 2);

  // Acabados por chat.
  await input.fill('pinta las paredes de verde salvia y el piso de nogal');
  await chat.getByRole('button', { name: 'Enviar' }).click();
  await expect(chat.getByText(/paredes en verde salvia/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('✓ Guardado')).toBeVisible({ timeout: 15_000 });

  // Si no entiende, propone ejemplos.
  await input.fill('hola');
  await input.press('Enter');
  await expect(chat.getByText(/Prueba con órdenes/)).toBeVisible({ timeout: 20_000 });

  // Persistencia: recargar y comprobar acabados y número de muebles.
  await page.reload();
  await page.getByRole('tab', { name: /Editor 3D/ }).click();
  await expect.poll(() => furnitureCount(page)).toBe(before + 2);
  await page.getByRole('tab', { name: 'Cuarto y acabados' }).click();
  await expect(page.getByRole('button', { name: 'Piso: Nogal' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Pared: Verde salvia' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('tab', { name: 'Asistente IA' }).click();
  await page.screenshot({ path: 'test-results/fase4-chat.png' });
});
