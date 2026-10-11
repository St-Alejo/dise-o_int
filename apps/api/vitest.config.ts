import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/cli/**', 'src/main.ts', 'src/worker.ts'],
      // Suelo medido sin las pruebas de integración (que en CI sí corren y lo suben).
      thresholds: { statements: 58, branches: 48, functions: 50, lines: 60 },
    },
  },
});
