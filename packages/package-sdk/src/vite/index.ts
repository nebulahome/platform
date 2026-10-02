/**
 * `@nebulahome/package-sdk/vite`: building a package (PACKAGES_DOCS.md 8).
 *
 * `nebula()` goes in the package's `vite.config.ts`; `buildPackage` and `checkPackage` are what
 * the `nebulahome-package` command runs, for a script of its own that wants them.
 */
export { PackageConfigError } from '../generate/problems.js';
export { buildPackage, checkPackage, type BuildOptions, type CheckedPackage } from './build.js';
export { nebula, type NebulaOptions } from './plugin.js';
