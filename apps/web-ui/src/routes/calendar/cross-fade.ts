/**
 * A change the page cross-fades: what leaves fades out as what comes fades in, and what moves
 * between the two blends (the browser's view transition, timed in `styles.css`). Switching a
 * calendar off or on goes through it, so its events do not blink away.
 */
import { flushSync } from 'react-dom';

/**
 * Makes a change inside a view transition, or at once where the browser has none or less motion
 * was asked for.
 *
 * @param change - The state change; it is rendered before the new picture is taken.
 * @param isReduced - Whether less motion was asked for.
 */
export function crossFade(change: () => void, isReduced: boolean): void {
  if (isReduced || !('startViewTransition' in document)) {
    change();

    return;
  }

  document.startViewTransition(() => {
    flushSync(change);
  });
}
