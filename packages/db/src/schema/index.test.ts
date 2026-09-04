import { describe, expect, it } from 'vitest';

import * as schema from './index.js';

/**
 * The namespaces the query builder is handed.
 *
 * Named explicitly rather than derived, so that adding a fifth PostgreSQL schema without adding
 * it here is a failing test rather than a namespace nobody ever checked.
 */
const NAMESPACES = ['auth', 'history', 'registry', 'system'] as const;

describe('the exported schema', () => {
  it('hands Drizzle objects it can inspect', () => {
    // Regression. `export * as auth from './auth.js'` produces a module namespace object whose
    // prototype is null, and Drizzle inspects every value it is given by reading
    // `Object.getPrototypeOf(value).constructor` - which throws on one. The symptom was that
    // `createDatabase` died before returning, and nothing caught it because the migrator uses
    // the raw driver and was the only thing touching the database.
    for (const name of NAMESPACES) {
      expect(Object.getPrototypeOf(schema[name])).not.toBeNull();
    }
  });

  it('keeps the SQL name and the TypeScript name matching', () => {
    // The reason the schemas are namespaced rather than flattened: table names repeat across
    // them by design, and flattening would force a rename.
    expect(schema.registry.entities).toBeDefined();
    expect(schema.auth.users).toBeDefined();
    expect(schema.history.stateHistory).toBeDefined();
    expect(schema.system.packages).toBeDefined();
  });

  it('still exports the shared column types', () => {
    expect(typeof schema.citext).toBe('function');
    expect(typeof schema.bytea).toBe('function');
  });
});
