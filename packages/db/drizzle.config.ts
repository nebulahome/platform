/**
 * drizzle-kit configuration.
 *
 * Used for introspection and Drizzle Studio only. **Migrations are not generated from this
 * schema**: most of what the database needs - TimescaleDB hypertables, continuous aggregates,
 * compression and retention policies, roles, grants and seed data - is invisible to a schema
 * differ, so the SQL in `migrations/` is written by hand and applied by `src/migrate.ts`.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  migrations: { schema: 'system', table: 'schema_migrations' },
  dbCredentials: { url: process.env['DATABASE_URL'] ?? '' },
});
