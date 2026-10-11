import { defineConfig, devices } from '@playwright/test';

// Capturas para la landing (no son pruebas): npx playwright test -c playwright.shots.config.ts
export default defineConfig({
  testDir: './scripts',
  testMatch: '*.spec.ts',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:8088',
    ...devices['Desktop Chrome'],
    deviceScaleFactor: 2,
  },
});
