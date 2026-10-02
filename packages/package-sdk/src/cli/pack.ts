/**
 * `nebulahome-package pack`: a built release, packed into the archive an installation downloads,
 * with its entry for the package index (PACKAGES_DOCS.md 8.2, 10).
 *
 * The archive is a gzipped tar of `dist/` at its root - what the packet-manager unpacks - written
 * with the same library the packet-manager reads it with, without links. The index entry is
 * checked against the index's own schema, so a release the index would refuse is refused here.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { create } from 'tar';

import { packageReleaseSchema } from '@nebulahome/contracts';

import { isRecord } from '../build/fields.js';
import { RELEASE_PATHS } from '../build/manifest.js';
import { PackageConfigError } from '../build/problems.js';
import { githubEnvironment } from '../config.js';

/** What packing takes. */
export type PackOptions = {
  /** The package's folder. */
  readonly root: string;

  /** The built release. */
  readonly outDir: string;

  /** Where the archive will be downloaded from, without its file name; GitHub's when not said. */
  readonly urlBase?: string;

  /** When the release is published; now when not said. */
  readonly now?: Date;
};

/** What packing wrote. */
export type PackResult = {
  readonly archive: string;
  readonly indexEntry: string;
  readonly sha256: string;
  readonly size: number;
};

/**
 * Packs a built release and writes its index entry, both into the package's folder.
 *
 * @param options - Where the package and its release are, and where the archive will be.
 * @returns What was written, with the archive's digest and size.
 * @throws {PackageConfigError} When there is no release, or no address for its archive.
 */
export async function packRelease(options: PackOptions): Promise<PackResult> {
  const { root, outDir } = options;
  let manifest: unknown;

  try {
    manifest = JSON.parse(await readFile(path.join(outDir, RELEASE_PATHS.manifest), 'utf8'));
  } catch {
    throw new PackageConfigError([
      `${outDir} holds no release: run nebulahome-package build first`,
    ]);
  }

  if (
    !isRecord(manifest) ||
    typeof manifest['id'] !== 'string' ||
    typeof manifest['version'] !== 'string'
  ) {
    throw new PackageConfigError([`${RELEASE_PATHS.manifest} is not a package's manifest`]);
  }

  const file = `${manifest['id']}-${manifest['version']}.tgz`;
  const archive = path.join(root, file);
  const github = githubEnvironment();
  const base =
    options.urlBase ??
    (github === undefined
      ? undefined
      : `${github.serverUrl}/${github.repository}/releases/download/${github.refName}`);

  if (base === undefined) {
    throw new PackageConfigError([
      'Where will the archive be downloaded from? Pass --url <base>, or pack on GitHub Actions',
    ]);
  }

  await create(
    { gzip: true, cwd: outDir, file: archive, portable: true, follow: false, noMtime: true },
    (await readdir(outDir)).sort(),
  );

  const bytes = await readFile(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const release = packageReleaseSchema.safeParse({
    version: manifest['version'],
    platform: manifest['platform'],
    sdk: manifest['sdk'],
    requires: manifest['requires'],
    provides: manifest['provides'],
    artifact: { url: `${base.replace(/\/$/, '')}/${file}`, sha256, size: bytes.length },
    publishedAt: (options.now ?? new Date()).toISOString(),
    ...(github === undefined || options.urlBase !== undefined
      ? {}
      : {
          changelogUrl: `${github.serverUrl}/${github.repository}/releases/tag/${github.refName}`,
        }),
  });

  if (!release.success) {
    throw new PackageConfigError(
      release.error.issues.map(
        (issue) => `index-entry.json ${issue.path.join('.')}: ${issue.message}`,
      ),
    );
  }

  const indexEntry = path.join(root, 'index-entry.json');

  await writeFile(indexEntry, `${JSON.stringify(release.data, null, 2)}\n`);

  return { archive, indexEntry, sha256, size: bytes.length };
}
