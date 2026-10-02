/**
 * The package host: the platform's side of a package's process (PACKAGES.md 4).
 *
 * What a package is written with is the public `@nebulahome/package-sdk`; this is what runs it.
 * The packet-manager starts a `node` package with this package's runner
 * (`@nebulahome/package-host/run`), which connects to the bus as the package, loads its server
 * module and hands `start` the context built here - the platform's own implementation of the SDK's
 * `ServerContext`.
 */
export {
  createPackageContext,
  type PackageContextHandle,
  type PackageContextOptions,
} from './context.js';
