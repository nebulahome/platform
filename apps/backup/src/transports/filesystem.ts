/**
 * A location that is a folder: the system one, a local one, or a mounted share.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { parseArchiveName, partialNameOf } from '../domain/archive-name.js';

import type { ArchiveFile, LocationSession } from './session.js';

/**
 * Opens a folder as a location, making it when it is not there.
 *
 * @param directory - The folder.
 * @param onClose - What letting go of it takes too: unmounting a share.
 * @returns The session.
 */
export async function openFolder(
  directory: string,
  onClose: () => Promise<void> = async () => Promise.resolve(),
): Promise<LocationSession> {
  await mkdir(directory, { recursive: true });

  /**
   * The archives in the folder.
   *
   * @returns Each archive's name and size.
   */
  const list = async (): Promise<ArchiveFile[]> => {
    const names = (await readdir(directory)).filter((name) => parseArchiveName(name) !== null);
    const files = await Promise.all(
      names.map(async (name) => {
        try {
          const info = await stat(path.join(directory, name));

          return info.isFile() ? { name, bytes: info.size } : null;
        } catch {
          return null;
        }
      }),
    );

    return files.filter((file): file is ArchiveFile => file !== null);
  };

  /**
   * Writes an archive under a hidden name, and renames it when whole.
   *
   * @param name - Its name.
   * @param source - Its bytes.
   * @param signal - Stops the write.
   * @returns Its size.
   */
  const write = async (name: string, source: Readable, signal?: AbortSignal): Promise<number> => {
    const partial = path.join(directory, partialNameOf(name));

    try {
      await pipeline(source, createWriteStream(partial, { mode: 0o644 }), {
        signal: signal ?? new AbortController().signal,
      });
      await rename(partial, path.join(directory, name));
    } catch (error: unknown) {
      await rm(partial, { force: true });

      throw error;
    }

    return (await stat(path.join(directory, name))).size;
  };

  /**
   * Reads an archive, or its first bytes.
   *
   * @param name - Its name.
   * @param limit - How many bytes; all of them when absent.
   * @returns The bytes.
   */
  const read = async (name: string, limit?: number): Promise<Readable> =>
    Promise.resolve(
      createReadStream(
        path.join(directory, name),
        limit === undefined ? {} : { start: 0, end: Math.max(0, limit - 1) },
      ),
    );

  /**
   * Removes an archive; nothing else.
   *
   * @param name - Its name.
   */
  const remove = async (name: string): Promise<void> => {
    if (parseArchiveName(name) === null) {
      throw new Error(`Not an archive: ${name}`);
    }

    await unlink(path.join(directory, name));
  };

  /** Writes a small file and removes it. */
  const probe = async (): Promise<void> => {
    const file = path.join(directory, `.nebulahome-probe-${randomUUID()}`);

    await writeFile(file, 'NebulaHome checks it can write here.\n');
    await unlink(file);
  };

  /**
   * The room left on the folder's file system.
   *
   * @returns The bytes, or null when it cannot say.
   */
  const freeBytes = async (): Promise<number | null> => {
    try {
      const info = await statfs(directory);

      return info.bavail * info.bsize;
    } catch {
      return null;
    }
  };

  return { list, write, read, remove, probe, freeBytes, close: onClose };
}
