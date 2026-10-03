/**
 * `nebulahome-integration pack`: the build, packed into the archive a release carries
 * (INTEGRATIONS_DOCS.md 10).
 *
 * `<vendor>-<version>.tgz`, a gzipped tar of the vendor's folder - `acme/manifest.json`,
 * `acme/panels/driver.json`, … - written in a fixed order without times or links, so the same
 * build packs to the same bytes. The Community Hub imports a GitHub release of
 * `<owner>/integration-<vendor>` tagged `v<version>` with exactly this one archive, and reads the
 * vendor and its drivers out of it; on GitHub Actions the command checks the repository's name,
 * which the Hub would otherwise refuse without saying so to anyone watching the release.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { create } from 'tar';

import { githubRepository } from './config.js';
import { IntegrationError, isFile, readProject, type IntegrationProject } from './project.js';

/** What packing wrote. */
export type PackResult = {
  readonly project: IntegrationProject;

  /** The archive's path. */
  readonly archive: string;

  readonly sha256: string;
  readonly size: number;
};

/**
 * Packs the build.
 *
 * @param options - Where the repository is, and the GitHub repository it is released from.
 * @param options.root - Its folder.
 * @param options.repository - `<owner>/<name>` on GitHub Actions, null elsewhere; read from the
 * environment when not said.
 * @returns The archive, its digest and its size.
 * @throws {IntegrationError} When there is no build of this version, or the repository is not
 * named for the vendor.
 */
export async function packIntegration(options: {
  readonly root: string;
  readonly repository?: string | null;
}): Promise<PackResult> {
  const project = await readProject(options.root);
  const manifestFile = path.join(project.outputDirectory, 'manifest.json');

  if (!(await isFile(manifestFile))) {
    throw new IntegrationError([
      `dist/${project.vendorId} holds no build: run nebulahome-integration build first`,
    ]);
  }

  const built = JSON.parse(await readFile(manifestFile, 'utf8')) as { readonly version?: unknown };

  if (built.version !== project.version) {
    throw new IntegrationError([
      `The build is of ${String(built.version)} and package.json says ${project.version}: run nebulahome-integration build again`,
    ]);
  }

  const repository =
    options.repository === undefined ? githubRepository() : (options.repository ?? undefined);
  const expected = `integration-${project.vendorId}`;

  if (repository !== undefined && repository.split('/')[1] !== expected) {
    throw new IntegrationError([
      `The repository is ${repository}, and the Community Hub imports ${project.vendorId} only from one called ${expected}`,
    ]);
  }

  const files = (await readdir(project.outputDirectory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(project.outputRoot, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/'),
    )
    .sort();
  const archive = path.join(project.root, `${project.vendorId}-${project.version}.tgz`);

  await create(
    {
      gzip: true,
      cwd: project.outputRoot,
      file: archive,
      portable: true,
      follow: false,
      noMtime: true,
    },
    files,
  );

  const bytes = await readFile(archive);

  return {
    project,
    archive,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  };
}
