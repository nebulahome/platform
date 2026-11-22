/**
 * Whether the page should hold still.
 *
 * The same arrangement the stylesheet has for its own animations: the choice made in the
 * interface wins, in both directions, and the operating system's preference counts only for
 * somebody who has not made one. A chart that eases between readings is a script's animation,
 * not a stylesheet's, so it has to ask here rather than being caught by a media query.
 */
import { useMediaQuery } from '@/lib/use-media-query';
import { usePreferences } from '@/settings/preferences';

/** The operating system's request for less motion. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether motion should be left out.
 *
 * @returns True when the person chose less motion, or left it to a system that asks for less.
 */
export function useReducedMotion(): boolean {
  const motion = usePreferences((state) => state.motion);
  const isSystemAsking = useMediaQuery(REDUCED_MOTION_QUERY);

  return motion === 'reduced' || (motion === 'system' && isSystemAsking);
}
