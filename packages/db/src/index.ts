/**
 * Public entry point of the `@nebulahome/db` package.
 *
 * The only place in the platform that speaks SQL. Services import a typed query builder from
 * here; nobody assembles a query string by hand, and installed packages never connect at all -
 * they reach data through `core` over the bus.
 */

export * from './client.js';
export * from './history-reads.js';
export * from './migrate.js';
export * from './schema-version.js';
export * from './sealed.js';
export * as schema from './schema/index.js';
