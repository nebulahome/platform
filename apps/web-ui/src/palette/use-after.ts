/**
 * Whether something has been going on for a while: a command with no answer yet, a list still
 * coming. A wait shorter than that shows nothing, so a quick answer never flickers a spinner.
 */
import { useEffect, useState } from 'react';

/**
 * Whether a condition has held for a moment.
 *
 * @param isOn - The condition.
 * @param delayMs - How long it must hold.
 * @returns True once it has held that long, false as soon as it stops.
 */
export function useAfter(isOn: boolean, delayMs: number): boolean {
  const [isLate, setLate] = useState(false);

  useEffect(() => {
    if (!isOn) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setLate(true);
    }, delayMs);

    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [isOn, delayMs]);

  return isOn && isLate;
}
