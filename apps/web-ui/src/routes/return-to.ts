/**
 * Where to send someone back to after they sign in.
 *
 * The destination travels in the query string, which means it is caller input and has to be
 * treated as such. A redirect target taken on trust is an open redirect: a link to
 * `…/sign-in?returnTo=https://example.invalid` sends somebody to a page that looks like the one
 * they meant to reach, on a host that is not this one, immediately after they typed a password.
 *
 * So only a path on this origin is ever accepted, and everything else is thrown away in favour
 * of the default. There is no attempt to sanitise a bad value into a good one - a rejected
 * destination means the person lands on their dashboard, which is a small inconvenience, where
 * a repaired one means guessing what an attacker meant.
 */

/** Where somebody goes when there is nowhere to send them back to. */
export const DEFAULT_DESTINATION = '/dashboards';

/** The query parameter the destination travels in. */
export const RETURN_TO_PARAM = 'returnTo';

/**
 * Checks a destination and falls back when it is not one.
 *
 * @param candidate - What arrived in the query string.
 * @returns A path on this origin, or {@link DEFAULT_DESTINATION}.
 */
export function safeReturnTo(candidate: string | null): string {
  if (candidate === null || candidate === '') {
    return DEFAULT_DESTINATION;
  }

  // A single leading slash and nothing else. `//host` is protocol-relative and leaves the site;
  // `/\host` is the same thing to browsers that normalise backslashes; anything with a scheme is
  // not a path at all.
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return DEFAULT_DESTINATION;
  }

  if (candidate.includes('\\')) {
    return DEFAULT_DESTINATION;
  }

  return candidate;
}
