/**
 * What every test file gets before it runs.
 *
 * Testing Library unmounts after each test on its own only when Vitest's globals are on. They
 * are off here - an implicit `describe` in scope is exactly the kind of magic RULES.md 3 avoids -
 * so the teardown is registered explicitly. Without it every render stacks on the last one and
 * queries start finding two of everything, which reads as a component bug rather than as a
 * missing `afterEach`.
 */
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * How long a `findBy` query waits for what it is looking for. The library's second is enough
 * for one file on its own and not for sixty sharing the machine with the rest of the monorepo's
 * suites: under that load a page whose data arrives in a few hundred milliseconds of wall clock
 * was reported as missing a button it would have drawn a moment later. Three seconds keeps
 * inside Vitest's five for the whole test, so a thing that is never drawn still fails as a
 * missing element rather than as a test that timed out.
 */
configure({ asyncUtilTimeout: 3000 });

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

/*
 * jsdom implements `<dialog>` but not the modal behaviour behind it: `showModal` and `close` are
 * simply absent. They are stood in for here, once, so that every dialog test exercises the same
 * thing a browser does - including the `close` event a browser fires on the dialog once it has
 * closed. Nine copies of this stand-in used to live in the test files, and none of them fired
 * that event, which is how a picker dialog closing the edit dialog under it passed every test.
 */
/**
 * Stands in for opening a dialog as a modal.
 */
globalThis.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};

/**
 * Stands in for closing a dialog, `close` event included.
 */
globalThis.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

/*
 * jsdom has no media queries: `matchMedia` is absent, like `scrollIntoView`, and for the same
 * reason is stood in for rather than guarded against in the components. The stand-in answers
 * that no query matches, which is a screen that asked for nothing in particular.
 */
/**
 * Listens for nothing: a query that never matches never changes either.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function -- see above
function ignoreListener(): void {}

/**
 * Dispatches nothing, for the same reason.
 *
 * @returns False: no listener was called.
 */
function dispatchNothing(): boolean {
  return false;
}

/**
 * Stands in for the browser's media query list.
 *
 * @param media - The query.
 * @returns A list that never matches and never changes.
 */
globalThis.matchMedia = function matchMedia(media: string): MediaQueryList {
  return {
    media,
    matches: false,
    onchange: null,
    addEventListener: ignoreListener,
    removeEventListener: ignoreListener,
    addListener: ignoreListener,
    removeListener: ignoreListener,
    dispatchEvent: dispatchNothing,
  };
};

afterEach(() => {
  cleanup();
});
