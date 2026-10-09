import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // RULES.md 7.2 forbids climbing more than one level, and the automation engine's tests sit
  // two below the fixtures they share. The alias is the sanctioned way across that gap; it
  // exists only for tests, which is why it is configured here and not in the build.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // The rest is the workspace's own unit-test configuration, which a package's file replaces.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 60, branches: 50 },
    },
  },
});
