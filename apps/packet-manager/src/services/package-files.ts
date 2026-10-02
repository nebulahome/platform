/**
 * What a package's folder holds: its manifest, and what configuring it asks.
 *
 * A package is a folder with `nebula.package.json` at its root - a release unpacked into the
 * data directory, or a system package shipped in the image - and a `setup.json` beside it when
 * the manifest names one. Both are read and checked here, once, when the package is installed or
 * found: a manifest that does not hold together is a package that is not installed.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  integrationSetupSchema,
  PACKAGE_COMPOSE_MAXIMUM_BYTES,
  packageManifestSchema,
  ValidationError,
  type IntegrationSetup,
  type PackageManifest,
} from '@nebulahome/contracts';

/** The manifest's name at a package's root. */
export const MANIFEST_FILE = 'nebula.package.json';

/** One package's folder, read. */
export type PackageFiles = {
  readonly root: string;
  readonly manifest: PackageManifest;
  readonly setup: IntegrationSetup | null;

  /** The compose file it runs, as its release carries it; null for a package that runs none. */
  readonly compose: string | null;
};

/**
 * A JSON file, parsed.
 *
 * @param file - The file.
 * @returns What it holds.
 * @throws {ValidationError} When it is not JSON.
 */
async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8');

  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new ValidationError(`${path.basename(file)} is not JSON`, { cause: error });
  }
}

/**
 * Reads a package's folder.
 *
 * @param root - The folder.
 * @returns Its manifest and setup.
 * @throws {ValidationError} When the manifest or the setup does not hold together.
 */
export async function readPackageFiles(root: string): Promise<PackageFiles> {
  const parsed = packageManifestSchema.safeParse(await readJson(path.join(root, MANIFEST_FILE)));

  if (!parsed.success) {
    throw new ValidationError(`${MANIFEST_FILE} does not hold together`, {
      cause: parsed.error,
      details: {
        root,
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      },
    });
  }

  const manifest = parsed.data;
  let setup: IntegrationSetup | null = null;

  if (manifest.setup !== undefined) {
    const read = integrationSetupSchema.safeParse(await readJson(path.join(root, manifest.setup)));

    if (!read.success) {
      throw new ValidationError(`${manifest.setup} does not hold together`, {
        cause: read.error,
        details: { root },
      });
    }

    setup = read.data;
  }

  let compose: string | null = null;

  if (manifest.compose !== undefined) {
    compose = await readFile(path.join(root, manifest.compose.file), 'utf8');

    if (Buffer.byteLength(compose) > PACKAGE_COMPOSE_MAXIMUM_BYTES) {
      throw new ValidationError(`${manifest.compose.file} is larger than a compose file may be`, {
        details: { root },
      });
    }
  }

  return { root, manifest, setup, compose };
}

/**
 * Says whether a folder is a package: it has a manifest at its root.
 *
 * @param root - The folder.
 * @returns True when it has.
 */
export async function isPackageFolder(root: string): Promise<boolean> {
  try {
    return (await stat(path.join(root, MANIFEST_FILE))).isFile();
  } catch {
    return false;
  }
}

/**
 * The package folders directly under a folder: the system packages the image ships.
 *
 * @param parent - The folder.
 * @returns Each package's root; none when the folder is not there.
 */
export async function packageFoldersIn(parent: string): Promise<string[]> {
  let names: string[];

  try {
    names = await readdir(parent);
  } catch {
    return [];
  }

  const roots = names.map((name) => path.join(parent, name));
  const flags = await Promise.all(roots.map(async (root) => isPackageFolder(root)));

  return roots.filter((root, index) => flags[index] === true).sort();
}
