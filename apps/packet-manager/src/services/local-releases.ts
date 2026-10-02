/**
 * The platform's local folder: releases put there by hand, to try a package before it is
 * released (PACKAGES_DOCS.md 10).
 *
 * Each `<id>-<version>.tgz` there - what `nebulahome-package pack` writes - is a release like the
 * index's: its manifest is read out of the archive, and its size and SHA-256 are counted here,
 * so it is installed, checked and unpacked by the same code a downloaded one is. What the folder
 * holds is read again each time it is asked, which costs a directory listing: a file's manifest
 * and digest are kept while its size and time stay what they were.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import { list } from 'tar';

import {
  compareVersions,
  packageManifestSchema,
  type PackageIndexEntry,
  type PackageManifest,
  type PackageRelease,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import { MANIFEST_FILE } from './package-files.js';

/** One file of the folder, read. */
type LocalFile = {
  readonly size: number;
  readonly mtimeMs: number;
  readonly manifest: PackageManifest;
  readonly sha256: string;
};

/**
 * Says whether an archive's entry is the package's manifest: at its root, or in its one folder.
 *
 * @param entryPath - The entry's path in the archive.
 * @returns True for the manifest.
 */
function isManifestEntry(entryPath: string): boolean {
  const parts = entryPath.replace(/^\.\//, '').split('/');

  return parts.at(-1) === MANIFEST_FILE && parts.length <= 2;
}

/**
 * An archive's manifest, read out of it without unpacking it.
 *
 * @param file - The archive.
 * @returns What the manifest holds, as text; undefined when it has none.
 */
async function manifestTextOf(file: string): Promise<string | undefined> {
  const found: { chunks?: Buffer[] } = {};

  await list({
    file,

    /**
     * Reads the manifest's entry, and none after it.
     *
     * @param entryPath - The entry's path.
     * @returns Whether to read it.
     */
    filter: (entryPath) => found.chunks === undefined && isManifestEntry(entryPath),

    /**
     * Keeps the manifest's bytes as they are read.
     *
     * @param entry - The manifest's entry.
     */
    onReadEntry: (entry) => {
      const chunks: Buffer[] = [];

      found.chunks = chunks;
      entry.on('data', (chunk: Buffer) => chunks.push(chunk));
    },
  });

  return found.chunks === undefined ? undefined : Buffer.concat(found.chunks).toString('utf8');
}

/**
 * The SHA-256 of a file.
 *
 * @param file - The file.
 * @returns Its digest, in hexadecimal.
 */
async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');

  await pipeline(createReadStream(file), hash);

  return hash.digest('hex');
}

/** The local folder, read when asked. */
export class LocalReleases {
  readonly #folder: string | undefined;
  readonly #logger: PlatformLogger;
  readonly #read = new Map<string, LocalFile>();

  /**
   * Keeps where the folder is.
   *
   * @param folder - The folder; undefined when the platform has none.
   * @param logger - Where a file that is no release is said.
   */
  public constructor(folder: string | undefined, logger: PlatformLogger) {
    this.#folder = folder;
    this.#logger = logger;
  }

  /**
   * The packages the folder holds, each with its releases, newest first, in the index's shape.
   *
   * @returns The packages; none when there is no folder.
   */
  public async entries(): Promise<PackageIndexEntry[]> {
    const folder = this.#folder;

    if (folder === undefined) {
      return [];
    }

    let names: string[];

    try {
      names = await readdir(folder);
    } catch {
      return [];
    }

    const files = await Promise.all(
      names
        .filter((name) => name.endsWith('.tgz'))
        .sort()
        .map(async (name) => this.#fileOf(path.join(folder, name))),
    );
    const byId = new Map<string, { manifest: PackageManifest; releases: PackageRelease[] }>();

    for (const [file, read] of files.flatMap((each) => (each === undefined ? [] : [each]))) {
      const found = byId.get(read.manifest.id) ?? { manifest: read.manifest, releases: [] };

      found.releases.push({
        version: read.manifest.version,
        platform: read.manifest.platform,
        sdk: read.manifest.sdk,
        requires: read.manifest.requires,
        provides: read.manifest.provides,
        artifact: { url: pathToFileURL(file).href, sha256: read.sha256, size: read.size },
        publishedAt: new Date(read.mtimeMs),
      });
      byId.set(read.manifest.id, found);
    }

    return [...byId.values()].map(({ manifest, releases }) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      repository: manifest.repository ?? `local/${manifest.id}`,
      category: manifest.category,
      versions: releases.sort((left, right) => compareVersions(right.version, left.version)),
    }));
  }

  /**
   * One archive, read - or as it was read, while it is unchanged.
   *
   * @param file - The archive.
   * @returns It, with what it is; undefined when it is no release.
   */
  async #fileOf(file: string): Promise<[string, LocalFile] | undefined> {
    try {
      const { size, mtimeMs } = await stat(file);
      const known = this.#read.get(file);

      if (known?.size === size && known.mtimeMs === mtimeMs) {
        return [file, known];
      }

      const text = await manifestTextOf(file);
      const parsed = packageManifestSchema.safeParse(
        text === undefined ? undefined : (JSON.parse(text) as unknown),
      );

      if (!parsed.success) {
        this.#logger.warn(
          { file, issues: parsed.error.issues.slice(0, 5) },
          `A local file is not a package's release: it has no ${MANIFEST_FILE} that holds together`,
        );

        return undefined;
      }

      const read: LocalFile = {
        size,
        mtimeMs,
        manifest: parsed.data,
        sha256: await sha256Of(file),
      };

      this.#read.set(file, read);

      return [file, read];
    } catch (error: unknown) {
      this.#logger.warn({ err: error, file }, 'A local file could not be read');

      return undefined;
    }
  }
}
