/**
 * `nebulahome-integration validate`: the sources hold together, the way `hub` reads a bundle
 * (INTEGRATIONS_DOCS.md 8.2).
 *
 * It runs the hub's own loader over `src/` - the same schemas, the same checks of every id
 * against its folder, of the runtime range, of the logo, of the containers, of every file and
 * module the bundle names - with the version and the range the build will write, and imports no
 * code. What it passes, `hub` loads; a driver or a `discovery.json` that does not hold is a
 * problem here, though `hub` would load the rest of the vendor without it.
 */
import { readVendorDirectory, type VendorDeclaration } from '@nebulahome/package-runtime';

import {
  IntegrationError,
  readProject,
  runtimeVersion,
  SOURCE_DIRECTORY,
  sourceModule,
  type IntegrationProject,
} from './project.js';

/** What checking found: the project, and what its sources declare. */
export type CheckResult = {
  readonly project: IntegrationProject;
  readonly declaration: VendorDeclaration;
};

/**
 * Says where a problem is, from the repository's folder.
 *
 * @param project - The project.
 * @param directory - Where it is.
 * @returns The folder, relative.
 */
function where(project: IntegrationProject, directory: string): string {
  const relative = directory.slice(project.root.length).replaceAll('\\', '/').replace(/^\//u, '');

  return relative === '' ? SOURCE_DIRECTORY : relative;
}

/**
 * Checks an integration's sources the way `hub` reads a bundle, importing nothing.
 *
 * @param options - Where the repository is.
 * @param options.root - Its folder.
 * @returns The project and what it declares.
 * @throws {IntegrationError} With every problem found.
 */
export async function checkIntegration(options: { readonly root: string }): Promise<CheckResult> {
  const project = await readProject(options.root);
  let declaration: VendorDeclaration;

  try {
    declaration = await readVendorDirectory(project.sourceDirectory, {
      expectedId: project.vendorId,
      stamp: project.stamp,
      runtimeVersion: runtimeVersion(),
      resolveModule: sourceModule,
    });
  } catch (error: unknown) {
    throw new IntegrationError([
      `${SOURCE_DIRECTORY}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  if (declaration.failures.length > 0) {
    throw new IntegrationError(
      declaration.failures.map(
        (failure) => `${where(project, failure.directory)}: ${failure.message}`,
      ),
    );
  }

  return { project, declaration };
}
