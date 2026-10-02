/**
 * The `system` schema: packages, routing, settings, migration bookkeeping, the audit log and the
 * backups' locations and runs.
 *
 * Mirrors DATABASE.md 7.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';

/** The `system` schema. */
export const systemSchema = pgSchema('system');

/**
 * Installed packages.
 *
 * The primary key is the package id rather than a generated uuid: it is already unique, stable
 * and human-readable, and it is what appears in bus subjects and log lines.
 *
 * There are deliberately no `granted_permissions` or `signature_key_id` columns. Every package is
 * first-party, released on GitHub and checked against the digest the package index gives, so
 * there is no permission grant to record and no signature to verify.
 */
export const packages = systemSchema.table(
  'packages',
  {
    id: text('id').primaryKey(),
    version: text('version').notNull(),
    runtime: text('runtime').notNull(),
    state: text('state').notNull().default('installed'),

    /** `builtin`, `index` or `local`: where it came from. */
    source: text('source').notNull().default('index'),

    /** A package shipped in the image that is never removed, only restarted: the MQTT broker. */
    isSystem: boolean('is_system').notNull().default(false),

    /** Validated against `packageManifestSchema` in `@nebulahome/contracts`. */
    manifest: jsonb('manifest').notNull(),

    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /** What was running before an update, so a failed one is reverted by reinstalling it. */
    previousVersion: text('previous_version'),

    lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
    lastError: text('last_error'),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    installedBy: uuid('installed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [index('packages_state_idx').on(table.state)],
);

/**
 * The routing table `packet-manager` publishes to `proxy`.
 *
 * Rows are written when a package registers its routes on startup, not read from a manifest
 * field: the thing that serves a route is the thing that declares it, so the two cannot drift.
 *
 * The reserved-prefix constraint stops a package hijacking `/api`. It is a database constraint
 * rather than an application check because the consequence of getting it wrong is a package
 * intercepting authenticated traffic.
 */
export const packageRoutes = systemSchema.table(
  'package_routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: text('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
    pathPrefix: text('path_prefix').notNull().unique(),
    upstream: text('upstream').notNull(),
    stripPrefix: boolean('strip_prefix').notNull().default(true),
    requiresPermission: text('requires_permission'),
    isWebsocket: boolean('is_websocket').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('package_routes_package_id_idx').on(table.packageId)],
);

/**
 * Runtime-changeable configuration, as opposed to environment variables.
 *
 * Anything an owner can change while the system runs lives here: retention periods, timeouts,
 * unit preferences. Anything fixed for the life of a process is an environment variable.
 */
export const settings = systemSchema.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),

  /** Names the Zod schema in `@nebulahome/contracts` that validates `value`. */
  schemaRef: text('schema_ref').notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/**
 * Applied migrations.
 *
 * Written by the migrator, never by application code. The column shape matches what drizzle-kit
 * writes, so switching back to its own migrator later requires no data change.
 */
export const schemaMigrations = systemSchema.table('schema_migrations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  hash: text('hash').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

/**
 * The audit trail.
 *
 * **Append-only, enforced by privilege**: `nebula_api` holds INSERT and SELECT here and nothing
 * else, so a compromised API process cannot erase its own trail.
 *
 * `actorUserId` is deliberately not a foreign key, and `actorLabel` snapshots the username at
 * the time of the action: an audit record has to survive the deletion of the user it names, and
 * still say who did the thing.
 */
export const auditLog = systemSchema.table(
  'audit_log',
  {
    time: timestamp('time', { withTimezone: true }).notNull().defaultNow(),
    id: uuid('id').notNull().defaultRandom(),
    actorType: text('actor_type').notNull(),
    actorUserId: uuid('actor_user_id'),

    /** A username snapshot, which survives the user being deleted. */
    actorLabel: text('actor_label').notNull(),

    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    result: text('result').notNull(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    traceId: text('trace_id'),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    index('audit_log_actor_user_id_time_idx')
      .on(table.actorUserId, table.time.desc())
      .where(sql`actor_user_id IS NOT NULL`),
    index('audit_log_action_time_idx').on(table.action, table.time.desc()),
    index('audit_log_resource_idx')
      .on(table.resourceType, table.resourceId, table.time.desc())
      .where(sql`resource_type IS NOT NULL`),
  ],
);

/**
 * Where backups are written.
 *
 * One row of kind `system` - the data directory's `backups/`, seeded by the migration and never
 * deleted - and the owner's own: a folder, an SMB share, an FTP server, an NFS export. `config`
 * holds the kind's settings, validated by `backupTargetInputSchema` in `@nebulahome/contracts`,
 * with the password sealed as `{ "$sealed": "v1:…" }` (sealed.ts).
 */
export const backupLocations = systemSchema.table(
  'backup_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    config: jsonb('config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isEnabled: boolean('is_enabled').notNull().default(true),
    retentionMode: text('retention_mode').notNull().default('count'),
    retentionValue: integer('retention_value').notNull().default(7),
    lastResult: text('last_result'),
    lastError: text('last_error'),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('backup_locations_single_system_idx')
      .on(table.kind)
      .where(sql`kind = 'system'`),
    index('backup_locations_created_by_idx').on(table.createdBy),
  ],
);

/**
 * Every backup and restore: as it runs, and how it ended.
 *
 * Written by the `backup` service only; `api` reads it. `sectionBytes` is what each part of the
 * archive measured, which the next size estimate scales.
 */
export const backupRuns = systemSchema.table(
  'backup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('running'),
    sections: text('sections').array().notNull(),
    archiveName: text('archive_name'),
    archiveBytes: bigint('archive_bytes', { mode: 'number' }),
    sectionBytes: jsonb('section_bytes')
      .notNull()
      .default(sql`'{}'::jsonb`),
    keyId: text('key_id'),
    destinations: jsonb('destinations')
      .notNull()
      .default(sql`'[]'::jsonb`),
    source: jsonb('source'),
    error: text('error'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('backup_runs_started_at_idx').on(table.startedAt.desc(), table.id),
    index('backup_runs_requested_by_idx').on(table.requestedBy),
  ],
);
