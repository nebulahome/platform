/**
 * The platform's local folders: releases put there by hand, to try a package or an integration
 * before it is released (PACKAGES_DOCS.md 10, INTEGRATIONS_DOCS.md).
 *
 * Each `<id>-<version>.tgz` there - what `nebulahome-package pack` or `nebulahome-integration pack`
 * writes - is a release like the index's: its manifest is read out of the archive, and its size
 * and SHA-256 are counted here, so it is installed, checked and unpacked by the same code a
 * downloaded one is. What a folder holds is read again each time it is asked, which costs a
 * directory listing: a file's manifest and digest are kept while its size and time stay what they
 * were.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import { list } from 'tar';
import { z } from 'zod';

import {
  compareVersions,
  packageManifestSchema,
  packageRequiresSchema,
  VENDOR_ID_PATTERN,
  type IntegrationIndexEntry,
  type IntegrationRelease,
  type PackageIndexEntry,
  type PackageManifest,
  type PackageRelease,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import { VENDOR_MANIFEST_FILE } from './installer.js';
import { MANIFEST_FILE } from './package-files.js';

/**
 * A vendor's manifest, as far as a local file's is read: who it is, which release, what it needs.
 * The rest is the hub's to check when it loads the bundle.
 */
const vendorManifestSchema = z.looseObject({
  id: z.string().regex(VENDOR_ID_PATTERN),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/iu),
  sdk: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  url: z.string().max(1024).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/u)
    .optional(),
  internetRequired: z.boolean().default(false),
  requires: packageRequiresSchema,
});

/** A vendor's manifest, as a local file's is read. */
type VendorManifest = z.output<typeof vendorManifestSchema>;

/** One file of a folder, read. */
type LocalArchive<TManifest> = {
  readonly size: number;
  readonly mtimeMs: number;
  readonly manifest: TManifest;
  readonly sha256: string;

  /** Whether it holds a module of code (`.js`, `.mjs`) as well as its JSON. */
  readonly hasCode: boolean;
};

/**
 * Says whether an archive's entry is the manifest: at its root, or in its one folder.
 *
 * @param entryPath - The entry's path in the archive.
 * @param manifestFile - The manifest's name.
 * @returns True for the manifest.
 */
function isManifestEntry(entryPath: string, manifestFile: string): boolean {
  const parts = entryPath.replace(/^\.\//u, '').split('/');

  return parts.at(-1) === manifestFile && parts.length <= 2;
}

/**
 * An archive's manifest, read out of it without unpacking it, and whether it holds code.
 *
 * @param file - The archive.
 * @param manifestFile - The manifest's name.
 * @returns What the manifest holds, as text - undefined when it has none - and whether a module
 *   of code is in it.
 */
async function readArchive(
  file: string,
  manifestFile: string,
): Promise<{ text: string | undefined; hasCode: boolean }> {
  const found: { chunks?: Buffer[]; hasCode: boolean } = { hasCode: false };

  await list({
    file,

    /**
     * Reads the manifest's entry, and none after it; notes a module of code on the way.
     *
     * @param entryPath - The entry's path.
     * @returns Whether to read it.
     */
    filter: (entryPath) => {
      if (/\.m?js$/u.test(entryPath)) {
        found.hasCode = true;
      }

      return found.chunks === undefined && isManifestEntry(entryPath, manifestFile);
    },

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

  return {
    text: found.chunks === undefined ? undefined : Buffer.concat(found.chunks).toString('utf8'),
    hasCode: found.hasCode,
  };
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

/** One local folder's archives, read when asked. */
class LocalArchives<TManifest> {
  readonly #folder: string | undefined;
  readonly #logger: PlatformLogger;
  readonly #schema: z.ZodType<TManifest>;
  readonly #manifestFile: string;
  readonly #what: string;
  readonly #read = new Map<string, LocalArchive<TManifest>>();

  /**
   * Keeps where the folder is.
   *
   * @param folder - The folder; undefined when the platform has none.
   * @param logger - Where a file that is no release is said.
   * @param manifest - Its archives' manifest: its name, and what it holds.
   * @param manifest.file - The manifest's name.
   * @param manifest.schema - What it holds.
   * @param what - What a release is of, for a message: "a package's".
   */
  public constructor(
    folder: string | undefined,
    logger: PlatformLogger,
    manifest: { readonly file: string; readonly schema: z.ZodType<TManifest> },
    what: string,
  ) {
    this.#folder = folder;
    this.#logger = logger;
    this.#schema = manifest.schema;
    this.#manifestFile = manifest.file;
    this.#what = what;
  }

  /**
   * Every archive of the folder that is a release, by name.
   *
   * @returns Each file's path and what it is; none when there is no folder.
   */
  public async archives(): Promise<[string, LocalArchive<TManifest>][]> {
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

    return files.flatMap((each) => (each === undefined ? [] : [each]));
  }

  /**
   * One archive, read - or as it was read, while it is unchanged.
   *
   * @param file - The archive.
   * @returns It, with what it is; undefined when it is no release.
   */
  async #fileOf(file: string): Promise<[string, LocalArchive<TManifest>] | undefined> {
    try {
      const { size, mtimeMs } = await stat(file);
      const known = this.#read.get(file);

      if (known?.size === size && known.mtimeMs === mtimeMs) {
        return [file, known];
      }

      const { text, hasCode } = await readArchive(file, this.#manifestFile);
      const parsed = this.#schema.safeParse(
        text === undefined ? undefined : (JSON.parse(text) as unknown),
      );

      if (!parsed.success) {
        this.#logger.warn(
          { file, issues: parsed.error.issues.slice(0, 5) },
          `A local file is not ${this.#what} release: it has no ${this.#manifestFile} that holds together`,
        );

        return undefined;
      }

      const read: LocalArchive<TManifest> = {
        size,
        mtimeMs,
        manifest: parsed.data,
        sha256: await sha256Of(file),
        hasCode,
      };

      this.#read.set(file, read);

      return [file, read];
    } catch (error: unknown) {
      this.#logger.warn({ err: error, file }, 'A local file could not be read');

      return undefined;
    }
  }
}

/**
 * The archives of a folder grouped by what they are a release of.
 *
 * @param archives - The folder's archives.
 * @param idOf - What an archive is a release of.
 * @returns For each id, its first manifest and every archive of it.
 */
function grouped<TManifest>(
  archives: readonly [string, LocalArchive<TManifest>][],
  idOf: (manifest: TManifest) => string,
): Map<string, { manifest: TManifest; files: [string, LocalArchive<TManifest>][] }> {
  const byId = new Map<
    string,
    { manifest: TManifest; files: [string, LocalArchive<TManifest>][] }
  >();

  for (const [file, read] of archives) {
    const id = idOf(read.manifest);
    const found = byId.get(id) ?? { manifest: read.manifest, files: [] };

    found.files.push([file, read]);
    byId.set(id, found);
  }

  return byId;
}

/** The local packages folder, read when asked. */
export class LocalReleases {
  readonly #archives: LocalArchives<PackageManifest>;

  /**
   * Keeps where the folder is.
   *
   * @param folder - The folder; undefined when the platform has none.
   * @param logger - Where a file that is no release is said.
   */
  public constructor(folder: string | undefined, logger: PlatformLogger) {
    this.#archives = new LocalArchives(
      folder,
      logger,
      { file: MANIFEST_FILE, schema: packageManifestSchema },
      "a package's",
    );
  }

  /**
   * The packages the folder holds, each with its releases, newest first, in the index's shape.
   *
   * @returns The packages; none when there is no folder.
   */
  public async entries(): Promise<PackageIndexEntry[]> {
    const byId = grouped(await this.#archives.archives(), (manifest) => manifest.id);

    return [...byId.values()].map(({ manifest, files }) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      repository: manifest.repository ?? `local/${manifest.id}`,
      category: manifest.category,
      versions: files
        .map(([file, read]): PackageRelease => ({
          version: read.manifest.version,
          platform: read.manifest.platform,
          sdk: read.manifest.sdk,
          requires: read.manifest.requires,
          provides: read.manifest.provides,
          artifact: { url: pathToFileURL(file).href, sha256: read.sha256, size: read.size },
          publishedAt: new Date(read.mtimeMs),
        }))
        .sort((left, right) => compareVersions(right.version, left.version)),
    }));
  }
}

/** The local integrations folder, read when asked. */
export class LocalIntegrationReleases {
  readonly #archives: LocalArchives<VendorManifest>;

  /**
   * Keeps where the folder is.
   *
   * @param folder - The folder; undefined when the platform has none.
   * @param logger - Where a file that is no release is said.
   */
  public constructor(folder: string | undefined, logger: PlatformLogger) {
    this.#archives = new LocalArchives(
      folder,
      logger,
      { file: VENDOR_MANIFEST_FILE, schema: vendorManifestSchema },
      "an integration's",
    );
  }

  /**
   * The integrations the folder holds, each with its releases, newest first, in the index's shape.
   *
   * @returns The integrations; none when there is no folder.
   */
  public async entries(): Promise<IntegrationIndexEntry[]> {
    const byId = grouped(await this.#archives.archives(), (manifest) => manifest.id);

    return [...byId.values()].map(({ manifest, files }) => ({
      id: manifest.id,
      name: manifest.name,
      ...(manifest.description === undefined ? {} : { description: manifest.description }),
      repository: `local/${manifest.id}`,
      ...(manifest.color === undefined ? {} : { color: manifest.color }),
      internetRequired: manifest.internetRequired,
      models: [],
      versions: files
        .map(([file, read]): IntegrationRelease => ({
          version: read.manifest.version,
          sdk: read.manifest.sdk,
          requires: read.manifest.requires,
          bundleKind: read.hasCode ? 'code' : 'declarative',
          artifact: { url: pathToFileURL(file).href, sha256: read.sha256, size: read.size },
          publishedAt: new Date(read.mtimeMs),
        }))
        .sort((left, right) => compareVersions(right.version, left.version)),
    }));
  }
}
