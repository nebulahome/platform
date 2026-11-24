/**
 * Where a page was opened from, so its way back goes there: a device opened from its integration
 * returns to the integration, one opened from the devices list returns to the list as it was
 * filtered, one opened from its parent returns to the parent.
 *
 * The browser's history cannot say this. It also holds what changed inside a page - a tab, an
 * entity's dialog (`?entity=`) - so one step back is often the same page. The trail keeps pages
 * instead: the shell records every move, a move that stays on the same page only updates where
 * that page stood, and going back (the browser's or a page's way back) drops what came after.
 *
 * It lives for the tab, in session storage, so a reload keeps it; a new tab or an address typed in
 * starts with none, and the page falls back to where its way back always went.
 */
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { NavigationType, useLocation, useNavigationType, type Location } from 'react-router';

/** One page of the trail. */
type Visit = {
  /** The page. */
  readonly pathname: string;

  /** The page as it was last seen: its query too, for the list's filters or the open tab. */
  readonly href: string;
};

/** What a page's way back puts in the router's state, so the trail treats it as going back. */
export const BACK_STATE = { isBack: true } as const;

/** The tab's storage key. */
const KEY = 'nebula.backTrail';

/** How many pages are kept: far more than anybody walks back through. */
const LIMIT = 50;

let trail: readonly Visit[] = read();

/**
 * Reads the trail this tab kept before a reload.
 *
 * @returns The trail; empty when there is none, or storage is closed.
 */
function read(): readonly Visit[] {
  try {
    const stored: unknown = JSON.parse(globalThis.sessionStorage.getItem(KEY) ?? '[]');

    return Array.isArray(stored)
      ? stored.filter(
          (visit): visit is Visit =>
            typeof visit === 'object' &&
            visit !== null &&
            typeof (visit as Visit).pathname === 'string' &&
            typeof (visit as Visit).href === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * How the tab moved: to a new page, back to one it had been on (the browser's Back or Forward, or
 * a page's way back), or in place of the page it was on (a redirect, a new item given its id).
 */
export type Move = 'push' | 'back' | 'replace';

/**
 * Moves the trail along one navigation.
 *
 * @param visits - The trail so far.
 * @param visit - Where the tab is now.
 * @param move - How it got there.
 * @returns The trail.
 */
export function walk(visits: readonly Visit[], visit: Visit, move: Move): readonly Visit[] {
  if (move === 'replace' || visits.at(-1)?.pathname === visit.pathname) {
    return [...visits.slice(0, -1), visit];
  }

  const at =
    move === 'back' ? visits.findLastIndex((each) => each.pathname === visit.pathname) : -1;

  return at === -1 ? [...visits, visit].slice(-LIMIT) : [...visits.slice(0, at), visit];
}

/**
 * Where the page at a path was opened from.
 *
 * @param visits - The trail.
 * @param pathname - The page.
 * @returns The page before it, as it was last seen; null when it was the first.
 */
export function cameFromIn(visits: readonly Visit[], pathname: string): string | null {
  const at = visits.findLastIndex((each) => each.pathname === pathname);

  // Before the shell has recorded this page, the last page of the trail is the one it came from.
  return (at === -1 ? visits.at(-1) : visits[at - 1])?.href ?? null;
}

/** The pages showing a way back, told when the trail moves. */
const listeners = new Set<() => void>();

/**
 * Listens to the trail.
 *
 * @param listener - Told on every move.
 * @returns What stops it.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Records every navigation of the tab. Mounted once, by the shell.
 *
 * A layout effect, so a page drawn before its move was recorded - it is a child of the shell, and
 * drawn first - is drawn again with its way back before anything is painted.
 */
export function useBackTrail(): void {
  const location: Location<unknown> = useLocation();
  const type = useNavigationType();

  useLayoutEffect(() => {
    const isBack =
      type === NavigationType.Pop ||
      (typeof location.state === 'object' &&
        location.state !== null &&
        (location.state as { isBack?: unknown }).isBack === true);

    trail = walk(
      trail,
      { pathname: location.pathname, href: `${location.pathname}${location.search}` },
      isBack ? 'back' : type === NavigationType.Replace ? 'replace' : 'push',
    );

    try {
      globalThis.sessionStorage.setItem(KEY, JSON.stringify(trail));
    } catch {
      // Without storage the trail still holds until a reload.
    }

    for (const listener of listeners) {
      listener();
    }
  }, [location, type]);
}

/**
 * Where the open page was opened from.
 *
 * @returns The address to go back to; null when the page was the first of the tab.
 */
export function useCameFrom(): string | null {
  const visits = useSyncExternalStore(subscribe, () => trail);

  return cameFromIn(visits, useLocation().pathname);
}
