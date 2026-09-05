/**
 * How long the opening frame stays on screen.
 *
 * The session resolves in about ten milliseconds on a local machine, so without this the mark
 * appears and settles inside a single frame and nobody ever sees it. The hold is a deliberate
 * delay on every cold start - it makes the application very slightly slower in exchange for the
 * screen having an opening rather than a flicker.
 *
 * The second rule is what stops it looking broken. The mark is turning, and the turn is an
 * infinite CSS animation; taking the animation away mid-revolution snaps it from wherever it had
 * got to back to zero, which is visible and looks like a fault. So the hold does not end at an
 * arbitrary moment - it ends on a whole number of turns, and the mark always comes to rest with
 * its notch where it started.
 */
import { useEffect, useRef, useState } from 'react';

/**
 * How long one turn takes, in milliseconds.
 *
 * The same number as `--animate-orbit` in the design system's stylesheet, and it has to be: this
 * is the interval the hold quantises to. If one changes the other has to change with it, which
 * is what the test in `use-intro-hold.test.ts` is for.
 */
export const ORBIT_PERIOD_MS = 1200;

/**
 * Decides whether the opening frame is still showing.
 *
 * @param hasResolved - Whether the thing being waited for has finished.
 * @param now - The clock, injectable so a test does not have to wait a second and a bit.
 * @returns True while the opening frame should stay.
 */
export function useIntroHold(hasResolved: boolean, now: () => number = Date.now): boolean {
  const startedAt = useRef<number>(now());
  const [isHeld, setHeld] = useState(true);

  useEffect(() => {
    if (!hasResolved) {
      return undefined;
    }

    // Round the elapsed time up to the next whole turn, with one turn as the floor. A session
    // that resolved instantly waits one full revolution; a slow one that took two and a bit
    // waits out the third rather than stopping part-way through it.
    const elapsed = now() - startedAt.current;
    const turns = Math.max(1, Math.ceil(elapsed / ORBIT_PERIOD_MS));
    const remaining = turns * ORBIT_PERIOD_MS - elapsed;

    const timer = setTimeout(() => {
      setHeld(false);
    }, remaining);

    return (): void => {
      clearTimeout(timer);
    };
  }, [hasResolved, now]);

  return isHeld;
}
