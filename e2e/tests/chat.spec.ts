import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createFromPhoto, openEditor, photo, signUp } from './helpers';

const furnitureCount = async (page: Page) => Number(await page.locator('.summary strong').first().innerText());

/**
 * Chat de diseño con CHAT_LLM=off: responde el modelo propio (y las reglas para los muebles),
 * determinista, con las mismas herramientas y el mismo resolvedor espacial que los LLM.
 */
test('chat: agrega muebles con relaciones, pinta, deshace en un paso y persiste', async ({ page }) => {
  await signUp(page, 'Chat');

  await createFromPhoto(page, { dims: ['5', '4.5', '2.6'] });
  await openEditor(page);

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
  await expect(chat.getByText('Local', { exact: true }).last()).toBeVisible();
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

test('chat: el modelo local fija un piso descrito con palabras y una foto de referencia propone', async ({ page }) => {
  await signUp(page, 'ChatLocal');
  await createFromPhoto(page, { dims: ['4.5', '4', '2.6'] });
  await openEditor(page);

  await page.getByRole('tab', { name: 'Asistente IA' }).click();
  const chat = page.locator('app-chat-panel');
  const input = chat.getByLabel('Mensaje para el asistente');
  await input.fill('Quiero el piso de baldosa brillante, color azul claro con verde');
  await input.press('Enter');
  await expect(chat.getByText(/baldosa brillante azul claro y verde \(fijado\)/i)).toBeVisible({ timeout: 20_000 });
  await expect(chat.getByText('Local', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('✓ Guardado')).toBeVisible({ timeout: 15_000 });

  // Queda en "Lo que pediste" con candado.
  await page.getByRole('tab', { name: 'Lo que pediste' }).click();
  await expect(page.getByRole('button', { name: 'Soltar Piso' })).toHaveAttribute('aria-pressed', 'true');

  // Foto de referencia: se lee (visión o colores), se fija lo visto y llega una propuesta.
  await page.getByRole('tab', { name: 'Asistente IA' }).click();
  await chat.locator('input[type=file]').setInputFiles(photo);
  await expect(chat.getByRole('img', { name: 'Imagen de referencia que enviaste' })).toBeVisible();
  await expect(chat.getByText(/(Leí la imagen|Tomé los colores de la imagen)/)).toBeVisible({ timeout: 60_000 });
  await expect(chat.getByRole('img', { name: /Colores leídos/ })).toBeVisible();
  await expect(page.locator('app-recommendation-card')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: 'test-results/fase5-chat-referencia.png' });
});
