/**
 * Whether the page should hold still.
 *
 * The same arrangement the stylesheet has for its own animations: the choice made in the
 * interface wins, in both directions, and the operating system's preference counts only for
 * somebody who has not made one. A chart that eases between readings is a script's animation,
 * not a stylesheet's, so it has to ask here rather than being caught by a media query.
 */
import { useSyncExternalStore } from 'react';

import { usePreferences } from '@/settings/preferences';

/** The operating system's request for less motion. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Listens for the operating system changing its mind.
 *
 * @param onChange - Called when it does.
 * @returns What stops listening.
 */
function subscribe(onChange: () => void): () => void {
  const query = globalThis.matchMedia(REDUCED_MOTION_QUERY);

  query.addEventListener('change', onChange);

  return (): void => {
    query.removeEventListener('change', onChange);
  };
}

/**
 * Reads the operating system's preference.
 *
 * @returns True when it asks for less motion.
 */
function isSystemReduced(): boolean {
  return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Whether motion should be left out.
 *
 * @returns True when the person chose less motion, or left it to a system that asks for less.
 */
export function useReducedMotion(): boolean {
  const motion = usePreferences((state) => state.motion);
  const isSystemAsking = useSyncExternalStore(subscribe, isSystemReduced, () => false);

  return motion === 'reduced' || (motion === 'system' && isSystemAsking);
}
