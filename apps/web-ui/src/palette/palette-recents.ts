/**
 * The last things opened from the command palette, shown when its field is empty (docs: command
 * palette, 6.1). Per person and per browser, in `localStorage`, which can be blocked: a palette
 * that cannot remember simply has no Recent group.
 *
 * Only item ids are kept - `<group>:<id>` - never a name; on reading they are matched against what
 * the person may see now, so a thing removed or no longer visible drops out silently.
 */

/** How many are kept. */
export const RECENTS_KEPT = 6;

/**
 * Where a person's recents are kept.
 *
 * @param userId - The person.
 * @returns The storage key.
 */
function keyOf(userId: string): string {
  return `nebula.palette.recents.${userId}`;
}

/**
 * Reads a person's recents.
 *
 * @param userId - The person.
 * @returns The item ids, the latest first; none when storage is blocked or holds nonsense.
 */
export function readRecents(userId: string): string[] {
  try {
    const stored = JSON.parse(globalThis.localStorage.getItem(keyOf(userId)) ?? '[]') as unknown;

    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === 'string').slice(0, RECENTS_KEPT)
      : [];
  } catch {
    return [];
  }
}

/**
 * Puts an item first in a person's recents.
 *
 * @param userId - The person.
 * @param itemId - The item opened.
 */
export function rememberRecent(userId: string, itemId: string): void {
  const recents = [itemId, ...readRecents(userId).filter((id) => id !== itemId)];

  try {
    globalThis.localStorage.setItem(keyOf(userId), JSON.stringify(recents.slice(0, RECENTS_KEPT)));
  } catch {
    // Blocked storage: the palette just does not remember.
  }
}
