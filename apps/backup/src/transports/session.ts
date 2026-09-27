/**
 * A location, opened: what a backup and a restore do with one, whatever kind it is.
 *
 * A folder - the system one, a local one, or an SMB share or NFS export once mounted - and an FTP
 * server are the two ways a location is written; everything else is the same. Every write goes to
 * a hidden `.partial` name first and is renamed when whole, so an archive is either all there or
 * not listed at all; and only files named as archives are ever listed, read or removed.
 */
import type { Readable } from 'node:stream';

/** One archive in a location. */
export type ArchiveFile = {
  readonly name: string;
  readonly bytes: number;
};

/** A location, opened. */
export type LocationSession = {
  /** The archives there, by name. */
  readonly list: () => Promise<ArchiveFile[]>;

  /**
   * Writes an archive, whole or not at all.
   *
   * @param name - Its name.
   * @param source - Its bytes.
   * @param signal - Stops the write.
   * @returns How many bytes were written.
   */
  readonly write: (name: string, source: Readable, signal?: AbortSignal) => Promise<number>;

  /**
   * Reads an archive, or its first bytes.
   *
   * @param name - Its name.
   * @param limit - How many bytes, from the start; all of it when absent.
   * @returns The bytes.
   */
  readonly read: (name: string, limit?: number) => Promise<Readable>;

  /** Removes an archive. */
  readonly remove: (name: string) => Promise<void>;

  /** Writes a small file and removes it again: whether a backup could be written there. */
  readonly probe: () => Promise<void>;

  /** The room left, when the location can say. */
  readonly freeBytes: () => Promise<number | null>;

  /** Lets go of the location: unmounts, disconnects. */
  readonly close: () => Promise<void>;
};

/**
 * Joins the parts of a path inside a location, ignoring empty parts and stray slashes.
 *
 * @param parts - The parts.
 * @returns The path, without a leading or trailing slash.
 */
export function joinRemote(...parts: readonly string[]): string {
  return parts
    .flatMap((part) => part.split('/'))
    .filter((part) => part !== '' && part !== '.')
    .join('/');
}
