/**
 * The `auth` schema: users, roles, permissions, sessions and tokens.
 *
 * Only `api` holds a role with access to these tables. `core` never reads a password hash or a
 * token, which is why the grants in DATABASE.md 12 give it nothing here at all.
 *
 * Mirrors DATABASE.md 4. The migration is the authority on the SQL; this file is the authority
 * on the types the query builder produces.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgSchema,
  smallint,
  timestamp,
  text,
  uniqueIndex,
  uuid,
  inet,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { bytea, citext } from './columns.js';

/** The `auth` schema. */
export const authSchema = pgSchema('auth');

/**
 * Roles: named permission templates.
 *
 * Built-in roles are seeded with `isBuiltin` and cannot be deleted. Their grants are editable
 * except for `owner`, which the application pins to the full permission set.
 */
export const roles = authSchema.table(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isBuiltin: boolean('is_builtin').notNull().default(false),
    sortOrder: smallint('sort_order').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [],
);

/**
 * The catalogue of permission kinds.
 *
 * Seeded by migration, never created at runtime: a permission exists because the code checks
 * for it, so a row nothing checks would be a control that does nothing.
 */
export const permissions = authSchema.table('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  description: text('description').notNull().default(''),
  isScopable: boolean('is_scopable').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Users.
 *
 * Soft deleted: the audit log and `registry.automations.created_by` reference them, and an audit
 * trail that loses the identity of the actor is not an audit trail. Deleting in the interface
 * sets `deletedAt`, clears the password hash and revokes every session.
 */
export const users = authSchema.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: citext('username').notNull(),
    email: citext('email'),
    displayName: text('display_name').notNull(),

    /** An argon2id encoded string, never a raw digest. */
    passwordHash: text('password_hash').notNull(),

    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    locale: text('locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('UTC'),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),

    /** Combined with `lockedUntil` to throttle sign-in. The policy itself lives in `api`. */
    failedLoginCount: integer('failed_login_count').notNull().default(0),

    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Uniqueness applies to living users only, so a name is reusable after a deletion.
    uniqueIndex('users_username_active_key')
      .on(table.username)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex('users_email_active_key')
      .on(table.email)
      .where(sql`deleted_at IS NULL AND email IS NOT NULL`),
    index('users_role_id_idx').on(table.roleId),
  ],
);

/** What a role grants, optionally narrowed to an area, entity or tag. */
export const rolePermissions = authSchema.table(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),

    /** `*` rather than null: null values do not compare equal, so a null would let duplicates through. */
    scope: text('scope').notNull().default('*'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('role_permissions_permission_id_idx').on(table.permissionId)],
);

/**
 * Per-user grants layered on top of the role, including denials.
 *
 * Resolution order - deny beats allow, narrower scope beats wider, expired grants are ignored -
 * is implemented once in `api`, in TypeScript, where it is unit-tested. Encoding it in SQL as
 * well would mean two implementations of one security policy that can silently diverge.
 */
export const userPermissions = authSchema.table(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull().default('*'),
    effect: text('effect').notNull().default('allow'),
    grantedBy: uuid('granted_by').references((): typeof users.id => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('user_permissions_permission_id_idx').on(table.permissionId),
    index('user_permissions_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`expires_at IS NOT NULL`),
  ],
);

/** A sign-in session, which is also the refresh token family used for reuse detection. */
export const sessions = authSchema.table(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`revoked_at IS NULL`),
  ],
);

/**
 * Refresh tokens, one family per session.
 *
 * Only `sha256(token)` is stored. Presenting a token whose `usedAt` is already set means it was
 * stolen, so `api` revokes the whole session with `revokedReason = 'token_reuse'`.
 */
export const refreshTokens = authSchema.table(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /**
     * The token issued in this one's place on rotation.
     *
     * Typed through {@link AnyPgColumn} because it points back at this table, and Drizzle
     * cannot infer the type of a reference to the table being defined.
     */
    replacedBy: uuid('replaced_by').references((): AnyPgColumn => refreshTokens.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('refresh_tokens_session_id_idx').on(table.sessionId),
    index('refresh_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * Personal access tokens for scripts and external integrations.
 *
 * A token's effective permissions are the intersection of its declared set and the owning user's
 * current permissions, so demoting a user immediately narrows every token they issued.
 */
export const accessTokens = authSchema.table(
  'access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),

    /** Shown in the interface so a user can recognise which token a row refers to. */
    tokenPrefix: text('token_prefix').notNull(),

    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('access_tokens_user_id_idx').on(table.userId)],
);

/** What one access token is allowed to do. */
export const accessTokenPermissions = authSchema.table(
  'access_token_permissions',
  {
    accessTokenId: uuid('access_token_id')
      .notNull()
      .references(() => accessTokens.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull().default('*'),
  },
  (table) => [index('access_token_permissions_permission_id_idx').on(table.permissionId)],
);

/**
 * Two-factor secrets.
 *
 * Enabled only once `confirmedAt` is set: a user proves they can generate a code before codes
 * start being required, otherwise a mistyped setup locks them out permanently.
 */
export const totpSecrets = authSchema.table('totp_secrets', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  /** Encrypted with the instance key. Never stored in plaintext. */
  secret: bytea('secret').notNull(),

  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A picture for each person.
 *
 * Its own table rather than columns on {@link users}, for the same reason {@link totpSecrets} is:
 * the users row is read on every authenticated request, and a `bytea` in it would be dragged
 * along by any query that ever forgets to name its columns.
 */
export const userAvatars = authSchema.table('user_avatars', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  /** The image itself. Capped at 64 KiB by a CHECK, not only by the application. */
  image: bytea('image').notNull(),

  /** One of `image/webp`, `image/png` or `image/jpeg`. Never SVG: it is a document. */
  mime: text('mime').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Single-use recovery codes for when the second factor is unavailable. */
export const totpRecoveryCodes = authSchema.table(
  'totp_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: bytea('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('totp_recovery_codes_user_id_idx').on(table.userId)],
);
