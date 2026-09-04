import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // RULES.md 7.2 forbids climbing more than one level, and an integration test lives two below
  // the sources it exercises. The alias is the sanctioned way across that gap; it exists only
  // for tests, which is why it is configured here and not in the build.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],

    // A broker round trip is not a unit test's ten milliseconds, and a connection retry loop
    // needs room to make more than one attempt before the runner gives up on it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
