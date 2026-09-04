/**
 * The complete Drizzle schema, re-exported under one namespace per PostgreSQL schema.
 *
 * Namespaced rather than flattened because table names repeat across schemas by design, and a
 * flat export would have to rename them - at which point the TypeScript name and the SQL name
 * stop matching, which is exactly the confusion this file exists to avoid.
 */

export * as auth from './auth.js';
export * as history from './history.js';
export * as registry from './registry.js';
export * as system from './system.js';
export * from './columns.js';
