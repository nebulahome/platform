/**
 * Installing one release: downloading its archive, checking it, and unpacking it.
 *
 * The archive is a GitHub release asset, fetched over HTTPS - following GitHub's redirect to
 * where it keeps the bytes - or a file of the platform's local folder (`file:`, which only the
 * packet-manager itself names: the index takes HTTPS alone). Either is copied to a file in the
 * package's folder, its SHA-256 and its size counted as it arrives. Only an archive whose size and digest are the index's is unpacked; any other is
 * deleted and refused, naming the two digests. It is unpacked beside the folder it goes to, and
 * moved into place only once whole, so a failure halfway leaves no half-installed release where
 * the packet-manager would find it. Links are not unpacked: an archive of files is all a package
 * needs, and a link is the one entry that could point outside its folder.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';

import { extract } from 'tar';

import { ValidationError, type PackageArtifact } from '@nebulahome/contracts';

import {
  isPackageFolder,
  MANIFEST_FILE,
  readPackageFiles,
  type PackageFiles,
} from './package-files.js';

/** What downloading needs. */
export type DownloadOptions = {
  readonly fetch?: typeof fetch;
  readonly timeoutMs: number;
};

/**
 * The bytes of an archive: a local file's, or what its address answers.
 *
 * @param artifact - Where it is.
 * @param options - The HTTP client and how long it may take.
 * @returns A stream of its bytes.
 * @throws {Error} When it cannot be downloaded.
 */
async function bytesOf(artifact: PackageArtifact, options: DownloadOptions): Promise<Readable> {
  if (artifact.url.startsWith('file:')) {
    return createReadStream(fileURLToPath(artifact.url));
  }

  const response = await (options.fetch ?? globalThis.fetch)(artifact.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  if (!response.ok || response.body === null) {
    throw new Error(`The archive answered HTTP ${String(response.status)}: ${artifact.url}`);
  }

  return Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
}

/**
 * Downloads an archive to a file, checking its size and digest.
 *
 * @param artifact - Where it is, how large, its SHA-256.
 * @param file - Where it goes.
 * @param options - The HTTP client and how long it may take.
 * @returns Once it is there and checked.
 * @throws {ValidationError} When it is larger than said, or its size or digest differ.
 * @throws {Error} When it cannot be downloaded.
 */
export async function downloadArtifact(
  artifact: PackageArtifact,
  file: string,
  options: DownloadOptions,
): Promise<void> {
  const source = await bytesOf(artifact, options);
  const hash = createHash('sha256');
  let size = 0;
  const counter = new Transform({
    /**
     * Counts and hashes a chunk, refusing one past the size said.
     *
     * @param chunk - The bytes.
     * @param encoding - Ignored.
     * @param done - Called with the chunk, or an error.
     */
    transform(chunk: Buffer, encoding, done): void {
      size += chunk.length;

      if (size > artifact.size) {
        done(
          new ValidationError(
            `The archive is larger than the index says: ${String(artifact.size)} bytes`,
          ),
        );

        return;
      }

      hash.update(chunk);
      done(null, chunk);
    },
  });

  try {
    await pipeline(source, counter, createWriteStream(file));
  } catch (error: unknown) {
    await rm(file, { force: true });

    throw error;
  }

  const digest = hash.digest('hex');

  if (size !== artifact.size || digest !== artifact.sha256) {
    await rm(file, { force: true });

    throw new ValidationError('The archive is not the one the index names', {
      details: {
        url: artifact.url,
        size,
        expectedSize: artifact.size,
        digest,
        expected: artifact.sha256,
      },
    });
  }
}

/**
 * Where a package's files are in an unpacked archive: its root, or the one folder it holds.
 *
 * @param folder - Where it was unpacked.
 * @returns The package's root.
 * @throws {ValidationError} When neither holds a manifest.
 */
async function packageRootIn(folder: string): Promise<string> {
  if (await isPackageFolder(folder)) {
    return folder;
  }

  const names = await readdir(folder);

  if (names.length === 1 && names[0] !== undefined) {
    const inner = path.join(folder, names[0]);

    if ((await stat(inner)).isDirectory() && (await isPackageFolder(inner))) {
      return inner;
    }
  }

  throw new ValidationError(`The archive has no ${MANIFEST_FILE} at its root`);
}

/**
 * Unpacks an archive into the folder of its release.
 *
 * @param file - The archive, checked.
 * @param target - `packages/<id>/<version>/`.
 * @param expected - The package and release it must be, by its manifest.
 * @param expected.id - The package.
 * @param expected.version - The release.
 * @returns The release, read.
 * @throws {ValidationError} When the archive is not that package, or not a package.
 */
export async function unpackArchive(
  file: string,
  target: string,
  expected: { readonly id: string; readonly version: string },
): Promise<PackageFiles> {
  const partial = `${target}.partial-${String(process.pid)}-${String(Date.now())}`;

  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });

  try {
    await extract({
      file,
      cwd: partial,
      strict: true,
      preservePaths: false,
      /**
       * Keeps files and folders; never a link.
       *
       * @param entryPath - The entry's path.
       * @param entry - The entry.
       * @returns Whether to write it.
       */
      filter: (entryPath, entry) => {
        const type = 'type' in entry ? entry.type : undefined;

        return type !== 'SymbolicLink' && type !== 'Link';
      },
    });

    const root = await packageRootIn(partial);
    const read = await readPackageFiles(root);

    if (read.manifest.id !== expected.id || read.manifest.version !== expected.version) {
      throw new ValidationError(
        `The archive is ${read.manifest.id} ${read.manifest.version}, not ${expected.id} ${expected.version}`,
      );
    }

    await rm(target, { recursive: true, force: true });
    await rename(root, target);

    return { ...read, root: target };
  } finally {
    await rm(partial, { recursive: true, force: true });
  }
}

/**
 * Downloads, checks and unpacks a release into its folder.
 *
 * @param release - Which package, which version, which archive.
 * @param release.id - The package.
 * @param release.version - The release.
 * @param release.artifact - Its archive, as the index names it.
 * @param packagesDir - The data directory's `packages/`.
 * @param options - The HTTP client and how long a download may take.
 * @returns The release, read, at `packages/<id>/<version>/`.
 */
export async function installRelease(
  release: { readonly id: string; readonly version: string; readonly artifact: PackageArtifact },
  packagesDir: string,
  options: DownloadOptions,
): Promise<PackageFiles> {
  const folder = path.join(packagesDir, release.id);
  const archive = path.join(folder, `${release.id}-${release.version}.tgz`);

  await mkdir(folder, { recursive: true });

  try {
    await downloadArtifact(release.artifact, archive, options);

    return await unpackArchive(archive, path.join(folder, release.version), release);
  } finally {
    await rm(archive, { force: true });
  }
}
