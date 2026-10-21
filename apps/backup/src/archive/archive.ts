/**
 * An archive's contents, and writing and reading them.
 *
 * Inside the encryption (stream-cipher.ts), a tar - not compressed: the dump already is, and what
 * else there is compresses badly - holding, in this order:
 *
 * ```
 * manifest.json                 what the archive is, and the instance keys
 * database.pgdump               pg_dump's custom format, the whole database
 * files/hub/integrations/…      the installed integration bundles
 * files/hub/matter/…            the house's Matter fabric: its keys and its nodes
 * files/hub/mqtt/…              the house's MQTT broker: its usernames, mappings and retained
 * files/proxy/tls/…             the certificate
 * files/containers/…            the data of the containers the integrations run
 * files/packages/…              the feature packages, when the archive has them
 * ```
 *
 * The manifest comes first so a restore can check it before gigabytes follow. Nothing else is
 * ever extracted from an archive: a path outside that list, absolute, or climbing out with `..`
 * is dropped, whatever the archive says.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { create, extract } from 'tar';

import type { BackupSection } from '@nebulahome/contracts';

import { createDecryptStream, createEncryptStream } from './stream-cipher.js';

/** What the manifest is called in the archive. */
export const MANIFEST_ENTRY = 'manifest.json';

/** What the database dump is called in the archive. */
export const DATABASE_ENTRY = 'database.pgdump';

/** Where the data directory's folders are, in the archive. */
export const FILES_ENTRY = 'files';

/** One of the data directory's folders an archive may carry. */
export type FileSection = {
  readonly section: BackupSection;

  /** Under the data directory. */
  readonly path: string;

  /**
   * Whether its files go back to the owners the archive has them with. The containers' folders
   * are written by whatever user each image runs as; everything else is handed, on a restore,
   * to the owner of the folder it replaces.
   */
  readonly keepsOwners: boolean;
};

/**
 * The data directory's folders an archive may carry, by section. Nothing else is ever written
 * back from an archive.
 */
export const FILE_SECTIONS: readonly FileSection[] = [
  { section: 'configuration', path: 'hub/integrations', keepsOwners: false },
  // The fabric's keys: without them every Matter device is commissioned again.
  { section: 'configuration', path: 'hub/matter', keepsOwners: false },
  // The broker's usernames: without them every device and container signs in again.
  { section: 'configuration', path: 'hub/mqtt', keepsOwners: false },
  { section: 'configuration', path: 'proxy/tls', keepsOwners: false },
  { section: 'configuration', path: 'containers', keepsOwners: true },
  { section: 'packages', path: 'packages', keepsOwners: false },
];

/** What an archive is: written first in it, read first from it. */
export type ArchiveManifest = {
  readonly format: 'nebulahome-backup';
  readonly formatVersion: 1;
  readonly runId: string;
  readonly createdAt: string;
  readonly platformVersion: string;
  readonly sections: readonly BackupSection[];

  /** The schema the dump was taken at: a restore needs the same. */
  readonly schema: { readonly version: number; readonly latestHash: string | null };
  readonly database: {
    readonly postgresVersion: string;
    readonly timescaledbVersion: string | null;
    readonly historyIncluded: boolean;

    /** The roles the dump grants to, created on a cluster that lacks them. */
    readonly roles: readonly string[];
    readonly bytes: number;
  };
  readonly files: readonly { readonly path: string; readonly bytes: number }[];

  /** What each part measured, which the next estimate scales. */
  readonly sectionBytes: Readonly<Record<BackupSection, number>>;

  /**
   * The keys the database's secrets are sealed with (ARCHITECTURE.md 14): in the archive because
   * it is encrypted, and restored with it, so an installation brought back elsewhere opens what
   * it stored.
   */
  readonly instanceKeys: { readonly secretsKey: string; readonly totpKey: string | null };
};

/** What the archive's header says to anyone who reads it, without the key. */
export type ArchivePublicData = {
  readonly format: 'nebulahome-backup';
  readonly formatVersion: 1;
  readonly createdAt: string;
  readonly sections: readonly BackupSection[];
  readonly platformVersion: string;
  readonly schema: { readonly version: number; readonly latestHash: string | null };
  readonly timescaledbVersion: string | null;
};

/** What writing an archive needs. */
export type WriteArchiveOptions = {
  /** Where the archive is written. */
  readonly output: string;

  /** The folder the manifest and the dump are staged in. */
  readonly stagingDir: string;
  readonly manifest: ArchiveManifest;

  /** The dump, staged, or null for none. */
  readonly databaseDump: string | null;

  /** The data directory. */
  readonly dataDir: string;

  /** The data directory's folders to take, as paths under it. */
  readonly folders: readonly string[];
  readonly backupKey: Buffer;
  readonly keyId: string;
  readonly signal?: AbortSignal;
};

/**
 * Whether a path is a folder.
 *
 * @param target - The path.
 * @returns True when it exists and is a folder.
 */
async function isFolder(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Writes an archive: the manifest, the dump and the folders, as a tar, encrypted.
 *
 * @param options - See {@link WriteArchiveOptions}.
 * @returns The archive's size.
 */
export async function writeArchive(options: WriteArchiveOptions): Promise<{ bytes: number }> {
  const manifestPath = path.join(options.stagingDir, MANIFEST_ENTRY);

  await writeFile(manifestPath, JSON.stringify(options.manifest, null, 2), { mode: 0o600 });

  // One tar from one working directory - the file system's root - with each entry renamed to
  // where it belongs in the archive as it is written: the staging folder and the data directory
  // are different places, and the archive's layout is neither.
  const root = path.parse(options.stagingDir).root;
  /**
   * A path from the root, as tar writes it.
   *
   * @param target - An absolute path.
   * @returns It, relative to the root, with forward slashes.
   */
  const relative = (target: string): string =>
    path.relative(root, target).split(path.sep).join('/');
  const renames: { from: string; to: string }[] = [
    { from: relative(manifestPath), to: MANIFEST_ENTRY },
  ];

  if (options.databaseDump !== null) {
    renames.push({ from: relative(options.databaseDump), to: DATABASE_ENTRY });
  }

  for (const folder of options.folders) {
    const absolute = path.join(options.dataDir, folder);

    // eslint-disable-next-line no-await-in-loop -- a handful of folders, checked in order.
    if (await isFolder(absolute)) {
      renames.push({ from: relative(absolute), to: `${FILES_ENTRY}/${folder}` });
    }
  }

  const packed = create(
    {
      cwd: root,
      // Not `portable`: the entries keep their owners, which the containers' folders need back
      // (FILE_SECTIONS). A restore, running as root, extracts them as they were.
      /**
       * Moves an entry to where it belongs in the archive.
       *
       * @param entry - The entry about to be written.
       */
      onWriteEntry: (entry) => {
        const current = entry.path.replace(/\/$/u, '');
        const rename = renames.find(
          (each) => current === each.from || current.startsWith(`${each.from}/`),
        );

        if (rename !== undefined) {
          entry.path = `${rename.to}${current.slice(rename.from.length)}${entry.path.endsWith('/') ? '/' : ''}`;
        }
      },
    },
    renames.map((each) => each.from),
  );

  const publicData: ArchivePublicData = {
    format: 'nebulahome-backup',
    formatVersion: 1,
    createdAt: options.manifest.createdAt,
    sections: options.manifest.sections,
    platformVersion: options.manifest.platformVersion,
    schema: options.manifest.schema,
    timescaledbVersion: options.manifest.database.timescaledbVersion,
  };

  await pipeline(
    packed as unknown as Readable,
    createEncryptStream(options.backupKey, options.keyId, publicData),
    createWriteStream(options.output, { mode: 0o600 }),
    { signal: options.signal ?? new AbortController().signal },
  );

  return { bytes: (await stat(options.output)).size };
}

/**
 * Whether an entry of an archive may be written back.
 *
 * @param entryPath - The entry's path, as the archive has it.
 * @returns True for the manifest, the dump, and what is under the folders an archive carries.
 */
export function isRestorableEntry(entryPath: string): boolean {
  const normalised = entryPath.replace(/^\.\//u, '').replace(/\/$/u, '');

  if (normalised.split('/').includes('..') || path.isAbsolute(normalised)) {
    return false;
  }

  if (
    normalised === MANIFEST_ENTRY ||
    normalised === DATABASE_ENTRY ||
    normalised === FILES_ENTRY
  ) {
    return true;
  }

  return FILE_SECTIONS.some((each) => {
    const prefix = `${FILES_ENTRY}/${each.path}`;

    return (
      normalised === prefix ||
      normalised.startsWith(`${prefix}/`) ||
      prefix.startsWith(`${normalised}/`)
    );
  });
}

/**
 * Opens an archive into a folder: decrypted, and only the entries an archive may carry.
 *
 * @param options - Where it comes from, how to open it, where it goes.
 * @param options.source - The archive's bytes.
 * @param options.keyFor - The backup key for a key id, or null.
 * @param options.destination - The folder, which must exist.
 * @param options.signal - Aborts the extraction.
 */
export async function extractArchive(options: {
  readonly source: Readable;
  readonly keyFor: (keyId: string) => Buffer | null;
  readonly destination: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  await pipeline(
    options.source,
    createDecryptStream(options.keyFor),
    extract({
      cwd: options.destination,
      strict: true,
      preservePaths: false,
      /**
       * Keeps only what an archive may carry.
       *
       * @param entryPath - The entry's path.
       * @returns Whether to write it.
       */
      filter: (entryPath) => isRestorableEntry(entryPath),
    }),
    { signal: options.signal ?? new AbortController().signal },
  );
}

/**
 * Reads the manifest an archive was opened into a folder with.
 *
 * @param directory - The folder.
 * @returns The manifest.
 * @throws {Error} When there is none, or it is not one.
 */
export async function readManifest(directory: string): Promise<ArchiveManifest> {
  const manifest = JSON.parse(
    await readFile(path.join(directory, MANIFEST_ENTRY), 'utf8'),
  ) as Partial<ArchiveManifest>;

  if (manifest.format !== 'nebulahome-backup' || manifest.formatVersion !== 1) {
    throw new Error('The archive has no manifest this build can read');
  }

  return manifest as ArchiveManifest;
}

/**
 * Opens a file as a readable stream.
 *
 * @param file - The file.
 * @returns Its bytes.
 */
export function readFileStream(file: string): Readable {
  return createReadStream(file);
}
