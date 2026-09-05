/**
 * What every test file gets before it runs.
 *
 * Testing Library unmounts after each test on its own only when Vitest's globals are on. They
 * are off here - an implicit `describe` in scope is exactly the kind of magic RULES.md 3 avoids -
 * so the teardown is registered explicitly. Without it every render stacks on the last one and
 * queries start finding two of everything, which reads as a component bug rather than as a
 * missing `afterEach`.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
