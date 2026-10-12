import { defineConfig, devices } from '@playwright/test';

/** BASE_URL apunta al stack levantado con `docker compose up --wait` (nginx de origen único). */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // En CI, 'github' deja cada fallo como anotación del commit: se ve qué prueba falló sin bajar los logs.
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    // Los primeros pasos del editor ya vistos: salen una sola vez y aquí estorbarían a cada prueba.
    // La que los comprueba borra esta marca antes de empezar.
    storageState: { cookies: [], origins: [{ origin: new URL(BASE_URL).origin, localStorage: [{ name: 'interiores.tour.visto', value: '1' }] }] },
    locale: 'es-ES',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
