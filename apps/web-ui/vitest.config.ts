import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  test: {
    // The client and the components both touch browser globals - `fetch`, `localStorage`, the
    // DOM - so the whole suite runs in one, rather than half of it importing a shim.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/testing/setup.ts'],
    globals: false,
  },
});
