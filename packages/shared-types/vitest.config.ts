import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
      // Es la lógica del dominio: si la cobertura baja de aquí, CI lo dice.
      thresholds: { statements: 87, branches: 77, functions: 89, lines: 89 },
    },
  },
});
