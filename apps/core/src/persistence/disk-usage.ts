/**
 * Counting what the platform keeps on disk.
 *
 * Two places hold it: the database, which is the bulk of it and grows with history, and the
 * data directory, laid out in `@nebulahome/config`. Each installed package is a directory under
 * `packages/`, and the backups are `backups/`, so both become categories of their own the day
 * they appear, with nothing added here. Every other folder is the platform's, and is counted by
 * what is in it - `cache/maps`, `hub/integrations` - because "cache" alone would not tell anybody
 * what is taking the room.
 *
 * Walking a directory is slow on a large disk, so this runs every few minutes rather than with
 * every sample, one directory at a time, and never follows a link: a link out of the data
 * directory would count somebody else's disk as ours, and a link back into it would count it
 * forever.
 */
import type { Dirent } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';

import { BACKUPS_DIRECTORY, PACKAGES_DIRECTORY } from '@nebulahome/config';
import type { DiskCategory, DiskPart } from '@nebulahome/contracts';
import type { Database } from '@nebulahome/db';

/** The part of the core category the database is. */
export const DATABASE_PART = 'database';

/** The part of the core category for files lying loose in the data directory. */
export const LOOSE_FILES_PART = 'files';

/** The longest part id the contract takes. */
const PART_ID_LENGTH = 64;

/**
 * Whether an error says the path is not there.
 *
 * @param error - What was thrown.
 * @returns True for `ENOENT`.
 */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Whether a file system error means the file may not be read by this process.
 *
 * @param error - The error.
 * @returns True for `EACCES` and `EPERM`.
 */
function isForbidden(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM')
  );
}

/**
 * How large the database is, tables, indexes and history together.
 *
 * @param db - A connected database handle.
 * @returns Its size in bytes.
 */
export async function databaseSize(db: Database): Promise<number> {
  const rows = await db.execute<{ size: string }>(
    sql`SELECT pg_database_size(current_database())::text AS size`,
  );

  return Number(rows[0]?.size ?? 0);
}

/**
 * Lists what is directly inside a directory.
 *
 * `lstat`-typed entries: a link is neither a file nor a directory here, so it is never followed.
 *
 * @param path - The directory.
 * @returns Its entries; none for a directory that is not there.
 */
async function entriesOf(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error: unknown) {
    // A folder that is not there holds nothing; nor, as far as this count can tell, does one it
    // may not read - `secrets/` in the container, which only the root-owned services open.
    if (isMissing(error) || isForbidden(error)) {
      return [];
    }

    throw error;
  }
}

/**
 * Adds up every file under a directory.
 *
 * @param path - The directory.
 * @returns The bytes its files take; 0 for a directory that is not there.
 */
export async function directorySize(path: string): Promise<number> {
  let total = 0;
  const pending = [path];

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined) {
      break;
    }

    // One directory at a time on purpose: a walk that read every directory at once would hold a
    // file handle per directory on a tree with thousands of them.
    // eslint-disable-next-line no-await-in-loop -- see above
    const entries = await entriesOf(current);

    for (const entry of entries) {
      const child = join(current, entry.name);

      if (entry.isDirectory()) {
        pending.push(child);
      } else if (entry.isFile()) {
        // eslint-disable-next-line no-await-in-loop -- one stat at a time, for the same reason
        total += (await lstat(child).catch(() => ({ size: 0 }))).size;
      }
    }
  }

  return total;
}

/**
 * Sorts the parts of a category, largest first.
 *
 * @param parts - The parts.
 * @returns The same parts, sorted.
 */
function largestFirst(parts: readonly DiskPart[]): DiskPart[] {
  return [...parts].sort(
    (left, right) => right.bytes - left.bytes || left.id.localeCompare(right.id),
  );
}

/**
 * Counts one of the platform's own folders, by what is in it.
 *
 * @param folder - The folder's name, directly under the data directory.
 * @param path - Where it is.
 * @returns A part per folder inside it, `<folder>/<name>`, and one named after the folder for
 * the files lying loose in it.
 */
async function countPlatformFolder(folder: string, path: string): Promise<DiskPart[]> {
  const parts: DiskPart[] = [];
  let looseBytes = 0;

  for (const entry of await entriesOf(path)) {
    const child = join(path, entry.name);

    if (entry.isDirectory()) {
      parts.push({
        id: `${folder}/${entry.name}`.slice(0, PART_ID_LENGTH),
        // eslint-disable-next-line no-await-in-loop -- one tree at a time, see directorySize
        bytes: await directorySize(child),
      });
    } else if (entry.isFile()) {
      // eslint-disable-next-line no-await-in-loop -- one stat at a time, see directorySize
      looseBytes += (await lstat(child)).size;
    }
  }

  if (looseBytes > 0) {
    parts.push({ id: folder.slice(0, PART_ID_LENGTH), bytes: looseBytes });
  }

  return parts;
}

/**
 * Counts what the platform keeps: itself, each package, the backups.
 *
 * @param options - Where to look, and how large the database is.
 * @param options.dataDir - The data directory.
 * @param options.databaseBytes - The database's size, or undefined when it could not be read.
 * @returns One category for the platform, one per package and one for the backups when there
 * are any.
 */
export async function countDiskCategories(options: {
  readonly dataDir: string;
  readonly databaseBytes: number | undefined;
}): Promise<DiskCategory[]> {
  const coreParts: DiskPart[] =
    options.databaseBytes === undefined
      ? []
      : [{ id: DATABASE_PART, bytes: options.databaseBytes }];
  const categories: DiskCategory[] = [];
  let looseBytes = 0;

  for (const entry of await entriesOf(options.dataDir)) {
    const path = join(options.dataDir, entry.name);

    if (entry.isDirectory() && entry.name === PACKAGES_DIRECTORY) {
      // eslint-disable-next-line no-await-in-loop -- one tree at a time, see directorySize
      for (const pkg of await entriesOf(path)) {
        if (pkg.isDirectory()) {
          categories.push({
            id: `package:${pkg.name}`.slice(0, PART_ID_LENGTH),
            kind: 'package',
            // eslint-disable-next-line no-await-in-loop -- one tree at a time, see directorySize
            bytes: await directorySize(join(path, pkg.name)),
            parts: [],
          });
        }
      }
    } else if (entry.isDirectory() && entry.name === BACKUPS_DIRECTORY) {
      categories.push({
        id: BACKUPS_DIRECTORY,
        kind: 'backups',
        // eslint-disable-next-line no-await-in-loop -- one tree at a time, see directorySize
        bytes: await directorySize(path),
        parts: [],
      });
    } else if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop -- one tree at a time, see directorySize
      coreParts.push(...(await countPlatformFolder(entry.name, path)));
    } else if (entry.isFile()) {
      // eslint-disable-next-line no-await-in-loop -- one stat at a time, see directorySize
      looseBytes += (await lstat(path)).size;
    }
  }

  if (looseBytes > 0) {
    coreParts.push({ id: LOOSE_FILES_PART, bytes: looseBytes });
  }

  return [
    {
      id: 'core',
      kind: 'core',
      bytes: coreParts.reduce((sum, part) => sum + part.bytes, 0),
      parts: largestFirst(coreParts),
    },
    ...categories,
  ];
}
