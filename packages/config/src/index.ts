/**
 * Public entry point of the `@nebulahome/config` package.
 *
 * The single place in the platform that reads the process environment. Services import a schema
 * fragment, compose it with their own variables, and load it once at startup. Also where the data
 * directory is laid out, since where it is comes from the environment too.
 */

export * from './data-layout.js';
export * from './env-schemas.js';
export * from './load.js';
