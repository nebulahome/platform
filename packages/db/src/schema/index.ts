/**
 * The complete Drizzle schema, re-exported under one namespace per PostgreSQL schema.
 *
 * Namespaced rather than flattened because table names repeat across schemas by design, and a
 * flat export would have to rename them - at which point the TypeScript name and the SQL name
 * stop matching, which is exactly the confusion this file exists to avoid.
 *
 * Each namespace is spread into a **plain object** rather than re-exported with `export * as`.
 * A module namespace object has a null prototype, and Drizzle inspects every value it is handed
 * by reading `Object.getPrototypeOf(value).constructor` - which throws on one. Spreading gives
 * an ordinary object that Drizzle skips quietly, and leaves `schema.registry.entities` reading
 * exactly as it did before.
 */
import * as authTables from './auth.js';
import * as historyTables from './history.js';
import * as registryTables from './registry.js';
import * as systemTables from './system.js';

/** The `auth` schema: users, sessions, roles and permissions. */
export const auth = { ...authTables };

/** The `history` schema: state history, telemetry, automation runs and logs. */
export const history = { ...historyTables };

/** The `registry` schema: the configured state of the house. */
export const registry = { ...registryTables };

/** The `system` schema: packages, routing, settings, migrations and the audit log. */
export const system = { ...systemTables };

export * from './columns.js';
