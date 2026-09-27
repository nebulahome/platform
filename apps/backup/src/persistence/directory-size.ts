/**
 * How much a folder's files take, counted one folder at a time.
 *
 * The same walk as `core`'s disk count (apps/core/src/persistence/disk-usage.ts): links are not
 * followed, and a folder that is not there - or may not be read - counts as empty.
 */
import type { Dirent } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Lists a folder, or nothing when it cannot be read.
 *
 * @param path - The folder.
 * @returns Its entries.
 */
async function entriesOf(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Adds up every file under a folder.
 *
 * @param path - The folder.
 * @returns The bytes its files take.
 */
export async function directorySize(path: string): Promise<number> {
  let total = 0;
  const pending = [path];

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop -- one folder at a time, as core counts.
    for (const entry of await entriesOf(current)) {
      const child = join(current, entry.name);

      if (entry.isDirectory()) {
        pending.push(child);
      } else if (entry.isFile()) {
        // eslint-disable-next-line no-await-in-loop -- one stat at a time, for the same reason.
        total += (await lstat(child).catch(() => ({ size: 0 }))).size;
      }
    }
  }

  return total;
}
