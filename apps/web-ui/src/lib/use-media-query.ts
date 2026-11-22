/**
 * Whether a CSS media query holds, followed as it changes: the window crossing a width, the
 * system asking for less motion or for dark.
 */
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query holds now, drawn again when that changes.
 *
 * @param query - The media query, `(max-width: 1099px)`.
 * @param serverValue - What it says where there is no window to ask: a render on the server.
 * @returns True while the query holds.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const list = globalThis.matchMedia(query);

      list.addEventListener('change', onChange);

      return (): void => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia(query).matches,
    () => serverValue,
  );
}
