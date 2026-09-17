import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The components render into a DOM, so the whole suite runs in one.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/testing/setup.ts'],
    globals: false,
  },
});
