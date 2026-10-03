/**
 * An integration's repository, as the command and the tests read it (INTEGRATIONS_DOCS.md 3).
 *
 * ```
 * integration-acme/
 * ├── package.json      the release's version, and the SDK it is built with
 * ├── src/              the vendor directory, as the hub loads it, its code in TypeScript
 * └── dist/acme/        what the build writes: the vendor directory, its code in JavaScript
 * ```
 *
 * `src/` is the vendor directory itself: `manifest.json`, the logo, one folder per driver. The
 * build writes it to `dist/<vendor>/` - a folder named by the vendor, so that `dist/` is a
 * directory of vendors as `hub` reads one (`HUB_DEV_BUNDLE_DIR`) - with the version and the
 * runtime range written into the manifest and every module compiled.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import semver from 'semver';

import type { ResolveModule } from '@nebulahome/package-runtime';

import { SDK_VERSION, sdkRangeOf } from './version.js';

/** The vendor directory's sources, in the repository. */
export const SOURCE_DIRECTORY = 'src';

/** Where the build writes the vendor directory, under a folder of its id. */
export const OUTPUT_DIRECTORY = 'dist';

/** Every problem found, each a sentence: what the command prints, one per line. */
export class IntegrationError extends Error {
  public readonly problems: readonly string[];

  /**
   * Makes the error.
   *
   * @param problems - Each problem, in a sentence.
   */
  public constructor(problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'IntegrationError';
    this.problems = problems;
  }
}

/** An integration's repository. */
export type IntegrationProject = {
  /** The repository's folder. */
  readonly root: string;

  /** The release's version: `package.json`'s. */
  readonly version: string;

  /** The vendor's id: `src/manifest.json`'s. */
  readonly vendorId: string;

  /** `src/`. */
  readonly sourceDirectory: string;

  /** `dist/`, a directory of vendors. */
  readonly outputRoot: string;

  /** `dist/<vendor>/`. */
  readonly outputDirectory: string;

  /** What the build writes into the manifest: the version, and the runtime range of this SDK. */
  readonly stamp: { readonly version: string; readonly sdk: string };
};

/**
 * Whether a file is there.
 *
 * @param file - The file.
 * @returns True when it is a file.
 */
export async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Reads a JSON file of the repository.
 *
 * @param file - The file.
 * @param what - What it is, for the message.
 * @returns What it holds.
 * @throws {IntegrationError} When it cannot be read or is not JSON.
 */
async function readJson(file: string, what: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;

    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Said below, the same way for a missing file and a broken one.
  }

  throw new IntegrationError([`${what} (${file}) cannot be read as a JSON object`]);
}

/**
 * Reads an integration's repository: its version, its vendor, where its sources and its build are.
 *
 * @param root - The repository's folder.
 * @returns The project.
 * @throws {IntegrationError} When `package.json` or `src/manifest.json` is missing, or the
 * version is not a semantic version.
 */
export async function readProject(root: string): Promise<IntegrationProject> {
  const packageJson = await readJson(path.join(root, 'package.json'), 'package.json');
  const sourceDirectory = path.join(root, SOURCE_DIRECTORY);
  const manifest = await readJson(
    path.join(sourceDirectory, 'manifest.json'),
    `${SOURCE_DIRECTORY}/manifest.json`,
  );
  const version = packageJson['version'];
  const vendorId = manifest['id'];
  const problems: string[] = [];

  if (typeof version !== 'string' || semver.valid(version) === null) {
    problems.push(`package.json's version must be a semantic version, like 1.0.0`);
  }

  if (typeof vendorId !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/u.test(vendorId)) {
    problems.push(
      `${SOURCE_DIRECTORY}/manifest.json's id must be a vendor id: lower case letters, digits and dashes`,
    );
  }

  if (problems.length > 0 || typeof version !== 'string' || typeof vendorId !== 'string') {
    throw new IntegrationError(problems);
  }

  const outputRoot = path.join(root, OUTPUT_DIRECTORY);

  return {
    root,
    version,
    vendorId,
    sourceDirectory,
    outputRoot,
    outputDirectory: path.join(outputRoot, vendorId),
    stamp: { version, sdk: sdkRangeOf(SDK_VERSION) },
  };
}

/** The extensions a module's source may have, by the extension the bundle names it with. */
const SOURCE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.mts', '.js', '.mjs'],
  '.mjs': ['.mts', '.mjs'],
};

/**
 * Finds a module the bundle names in the sources: `./lan/transport.js` is `lan/transport.ts` -
 * or `.js`, for a module written in JavaScript - since the bundle names what the build writes.
 *
 * @param directory - The folder the name is relative to.
 * @param file - The name, as the bundle writes it.
 * @returns The source's path, or null when there is none.
 */
export const sourceModule: ResolveModule = async (directory, file) => {
  const extension = path.extname(file);
  const stem = file.slice(0, file.length - extension.length);

  for (const candidate of SOURCE_EXTENSIONS[extension] ?? [extension]) {
    const found = path.join(directory, `${stem}${candidate}`);

    // One after another: the first that is there is the one, as a resolver reads them.
    // eslint-disable-next-line no-await-in-loop -- see above
    if (await isFile(found)) {
      return found;
    }
  }

  return null;
};

/**
 * The version the runtime is checked against: this SDK's, without a prerelease, which a range
 * would not match.
 *
 * @returns The version.
 */
export function runtimeVersion(): string {
  return semver.coerce(SDK_VERSION)?.version ?? SDK_VERSION;
}
