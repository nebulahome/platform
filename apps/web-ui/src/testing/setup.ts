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

/*
 * jsdom has no layout, so it implements no scrolling either - `scrollIntoView` is simply absent
 * from its `Element`. Anything that keeps a highlighted row in view calls it and would throw
 * here for a reason that has nothing to do with what is being tested.
 *
 * Stubbed rather than guarded in the components: every browser has had this method for twenty
 * years, and a `typeof` check in application code to satisfy a test environment is the test
 * leaking into the thing it is testing.
 */
/**
 * Stands in for the browser's own scrolling.
 *
 * Empty on purpose: there is no viewport here and nothing has a position, so there is nothing
 * to do. The assignment is the whole point - the method has to exist, so that calling it is not
 * a crash.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function -- see above
globalThis.Element.prototype.scrollIntoView = function scrollIntoView(): void {};

afterEach(() => {
  cleanup();
});
