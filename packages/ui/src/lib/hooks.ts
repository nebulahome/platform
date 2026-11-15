/**
 * The three small hooks every surface that opens ended up writing for itself: a press outside, the
 * Escape key, and a clock that ticks. Lent to packages as they are (`@nebulahome/package-sdk/ui`).
 */
import { useEffect, useEffectEvent, useState, type RefObject } from 'react';

/** One element, or several that count as inside together: a panel and the button that opens it. */
export type OutsideTarget = RefObject<Element | null> | readonly RefObject<Element | null>[];

/**
 * Calls back on a press that lands outside every element given.
 *
 * @param target - The element, or the elements, a press inside which is not one outside.
 * @param onOutside - Called on a press outside.
 * @param isEnabled - Whether it listens: false while what it closes is shut.
 */
export function useClickOutside(
  target: OutsideTarget,
  onOutside: () => void,
  isEnabled = true,
): void {
  // The caller's latest elements and callback, without listening again on every render.
  const press = useEffectEvent((event: PointerEvent) => {
    const pressed = event.target;
    const refs = 'current' in target ? [target] : target;

    if (
      pressed instanceof Node &&
      refs.every((ref) => !(ref.current?.contains(pressed) ?? false))
    ) {
      onOutside();
    }
  });

  useEffect(() => {
    if (!isEnabled) {
      return undefined;
    }

    globalThis.document.addEventListener('pointerdown', press);

    return () => {
      globalThis.document.removeEventListener('pointerdown', press);
    };
  }, [isEnabled]);
}

/**
 * Calls back when Escape is pressed anywhere in the page.
 *
 * @param onEscape - Called on Escape.
 * @param isEnabled - Whether it listens: false while what it closes is shut.
 */
export function useEscape(onEscape: () => void, isEnabled = true): void {
  const press = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onEscape();
    }
  });

  useEffect(() => {
    if (!isEnabled) {
      return undefined;
    }

    globalThis.document.addEventListener('keydown', press);

    return () => {
      globalThis.document.removeEventListener('keydown', press);
    };
  }, [isEnabled]);
}

/**
 * The time, read again at an interval: for "3 min ago" and clocks, which nothing else redraws.
 *
 * @param everyMs - How often it is read again, in milliseconds; every second when not said.
 * @returns The time of the last reading, in milliseconds since the epoch.
 */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, everyMs);

    return () => {
      clearInterval(timer);
    };
  }, [everyMs]);

  return now;
}
