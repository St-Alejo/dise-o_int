import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}

/** Accesibilidad (WCAG 2.1 AA): cero violaciones serias o críticas en las páginas públicas. */
for (const path of ['/', '/plantillas', '/entrar', '/registro']) {
  test(`sin violaciones de accesibilidad graves en ${path} @mobile`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test.describe('con el tema oscuro', () => {
  test.use({ colorScheme: 'dark' });
  for (const path of ['/', '/plantillas']) {
    test(`sin violaciones de accesibilidad graves en ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
});

// El editor entero, sin necesidad de cuenta: la demo abre el mismo que usan los proyectos.
test('sin violaciones de accesibilidad graves en el editor (demo) @mobile', async ({ page }) => {
  await page.goto('/demo/sala-escandinava');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Objetos' })).toBeVisible({ timeout: 30_000 });
  expect(await seriousViolations(page)).toEqual([]);
});

test('cabeceras de seguridad en la SPA', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});
