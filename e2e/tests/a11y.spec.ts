import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Accesibilidad (WCAG 2.1 AA): cero violaciones serias o críticas en las páginas públicas. */
for (const path of ['/', '/entrar', '/registro']) {
  test(`sin violaciones de accesibilidad graves en ${path} @mobile`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  });
}

test('cabeceras de seguridad en la SPA', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});
