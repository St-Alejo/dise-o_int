import { defineConfig, devices } from '@playwright/test';

// Capturas para la landing (no son pruebas): npx playwright test -c playwright.shots.config.ts
const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:8088';

export default defineConfig({
  testDir: './scripts',
  testMatch: '*.spec.ts',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [{ origin: new URL(BASE_URL).origin, localStorage: [{ name: 'interiores.tour.visto', value: '1' }] }] },
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 2,
  },
});
