/**
 * Which archives a location lets go of after a new one is written.
 *
 * By count, it keeps the newest so many; by days, those made within so many days. Two things are
 * kept whatever the rule says: the archive just written, and at least one archive - a location
 * whose clock is wrong, or whose owner set one day and was away a week, must not end up empty.
 * Only archives are considered: a file named otherwise is somebody else's and is never touched.
 */
import type { BackupRetention } from '@nebulahome/contracts';

import { parseArchiveName } from './archive-name.js';

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Picks what to remove.
 *
 * @param names - The files in the location.
 * @param retention - How many archives, or days, it keeps.
 * @param now - The moment it is decided at.
 * @param justWritten - The archive this run wrote, never removed.
 * @returns The names to remove, oldest first.
 */
export function archivesToRemove(
  names: readonly string[],
  retention: BackupRetention,
  now: Date,
  justWritten: string,
): string[] {
  const archives = names
    .map((name) => ({ name, parsed: parseArchiveName(name) }))
    .filter((each): each is { name: string; parsed: { createdAt: Date } } => each.parsed !== null)
    .sort((a, b) => b.parsed.createdAt.getTime() - a.parsed.createdAt.getTime());

  const keep = new Set<string>([justWritten]);
  const newest = archives[0];

  if (newest !== undefined) {
    keep.add(newest.name);
  }

  const expendable =
    retention.mode === 'count'
      ? archives.slice(retention.value)
      : archives.filter(
          (each) => each.parsed.createdAt.getTime() < now.getTime() - retention.value * DAY_MS,
        );

  return expendable
    .filter((each) => !keep.has(each.name))
    .map((each) => each.name)
    .reverse();
}
