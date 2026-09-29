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

    // The MQTT broker the tests talk to, in this process: `inject('mqttUrl')`.
    globalSetup: ['tests/support/broker.ts'],

    // A real broker and a real database, not a unit test's ten milliseconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,

    // One file at a time. The test broker is shared, and an instance listening for its printer on
    // `device/+/report` would claim the simulator another file is running.
    fileParallelism: false,
  },
});
