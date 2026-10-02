/**
 * `@nebulahome/package-sdk`: what a NebulaHome package is declared with, in its
 * `nebula.config.ts` (PACKAGES_DOCS.md 4).
 *
 * Everything here runs at build time, in Node, and is small and free of side effects: a package's
 * server and interface import its definitions for their types, and keep nothing else of it.
 */
export { SDK_VERSION } from './version.js';
