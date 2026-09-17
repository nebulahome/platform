/**
 * What every test file gets before it runs: the DOM matchers, and an unmount after each test.
 *
 * Testing Library unmounts on its own only when Vitest's globals are on, and they are off here,
 * so the teardown is registered explicitly - otherwise every render stacks on the last one.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
