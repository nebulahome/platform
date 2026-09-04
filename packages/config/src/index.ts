/**
 * Public entry point of the `@nebula-home/config` package.
 *
 * The single place in the platform that reads the process environment. Services import a schema
 * fragment, compose it with their own variables, and load it once at startup.
 */

export * from './env-schemas.js';
export * from './load.js';
