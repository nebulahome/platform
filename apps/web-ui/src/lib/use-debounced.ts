/**
 * A value that follows another, a moment behind.
 *
 * For a search box that asks the server as somebody types: the request goes out for what was
 * typed once the typing has paused, rather than for every keystroke on the way there.
 */
import { useEffect, useState } from 'react';

/** How long typing pauses before the value settles, when the caller does not say. */
const DEFAULT_DELAY_MS = 250;

/**
 * Follows a value, a moment behind.
 *
 * @param value - What is typed.
 * @param delayMs - How long a pause counts as one.
 * @returns What was typed a moment ago.
 */
export function useDebounced<T>(value: T, delayMs = DEFAULT_DELAY_MS): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);

    return (): void => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
}
