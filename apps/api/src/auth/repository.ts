/**
 * Every database read and write the authentication path makes.
 *
 * Kept apart from the rules in `permissions.ts` so that those stay pure and exhaustively
 * testable. Everything here is a query; everything there is a decision.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  REFRESH_TOKEN_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  type GrantedPermission,
  type ScopedPermission,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

import type { StoredGrant } from './permissions.js';

/**
 * Why a session was ended.
 *
 * Exactly the five the `sessions_revoked_reason` constraint allows. The column is not free text,
 * and a value it does not know fails the write - which, because a revocation is usually a side
 * effect of something else succeeding, surfaces as a 500 on an action that otherwise worked.
 */
export const SESSION_REVOKED_REASONS = [
  'logout',
  'expired',
  'token_reuse',
  'admin',
  'password_change',
] as const;

/** Why a session was ended. */
export type SessionRevokedReason = (typeof SESSION_REVOKED_REASONS)[number];

/** A user as the sign-in path needs them. */
export type UserRecord = {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  passwordHash: string;
  roleId: string;
  roleKey: string;
  locale: string;
  timezone: string;
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

/**
 * Finds a living user by username.
 *
 * Soft-deleted users are excluded here rather than checked by the caller: a deleted account
 * that can still be looked up is an account that can still be signed into by whoever forgets
 * the check.
 *
 * @param db - The database.
 * @param username - What the caller typed. The column is `citext`, so case does not matter.
 * @returns The user, or undefined when there is no living account with that name.
 */
export async function findUserByUsername(
  db: Database,
  username: string,
): Promise<UserRecord | undefined> {
  const rows = await db
    .select({
      id: schema.auth.users.id,
      username: schema.auth.users.username,
      email: schema.auth.users.email,
      displayName: schema.auth.users.displayName,
      passwordHash: schema.auth.users.passwordHash,
      roleId: schema.auth.users.roleId,
      roleKey: schema.auth.roles.key,
      locale: schema.auth.users.locale,
      timezone: schema.auth.users.timezone,
      isActive: schema.auth.users.isActive,
      mustChangePassword: schema.auth.users.mustChangePassword,
      failedLoginCount: schema.auth.users.failedLoginCount,
      lockedUntil: schema.auth.users.lockedUntil,
      lastLoginAt: schema.auth.users.lastLoginAt,
      createdAt: schema.auth.users.createdAt,
    })
    .from(schema.auth.users)
    .innerJoin(schema.auth.roles, eq(schema.auth.roles.id, schema.auth.users.roleId))
    .where(and(eq(schema.auth.users.username, username), isNull(schema.auth.users.deletedAt)))
    .limit(1);

  return rows[0];
}

/**
 * Finds a living user by id.
 *
 * @param db - The database.
 * @param userId - The identifier.
 * @returns The user, or undefined.
 */
export async function findUserById(db: Database, userId: string): Promise<UserRecord | undefined> {
  const rows = await db
    .select({
      id: schema.auth.users.id,
      username: schema.auth.users.username,
      email: schema.auth.users.email,
      displayName: schema.auth.users.displayName,
      passwordHash: schema.auth.users.passwordHash,
      roleId: schema.auth.users.roleId,
      roleKey: schema.auth.roles.key,
      locale: schema.auth.users.locale,
      timezone: schema.auth.users.timezone,
      isActive: schema.auth.users.isActive,
      mustChangePassword: schema.auth.users.mustChangePassword,
      failedLoginCount: schema.auth.users.failedLoginCount,
      lockedUntil: schema.auth.users.lockedUntil,
      lastLoginAt: schema.auth.users.lastLoginAt,
      createdAt: schema.auth.users.createdAt,
    })
    .from(schema.auth.users)
    .innerJoin(schema.auth.roles, eq(schema.auth.roles.id, schema.auth.users.roleId))
    .where(and(eq(schema.auth.users.id, userId), isNull(schema.auth.users.deletedAt)))
    .limit(1);

  return rows[0];
}

/**
 * Reads what a role grants.
 *
 * @param db - The database.
 * @param roleId - The role.
 * @returns Its grants. Roles only ever allow, so no effect is read.
 */
export async function readRoleGrants(db: Database, roleId: string): Promise<ScopedPermission[]> {
  const rows = await db
    .select({
      key: schema.auth.permissions.key,
      scope: schema.auth.rolePermissions.scope,
    })
    .from(schema.auth.rolePermissions)
    .innerJoin(
      schema.auth.permissions,
      eq(schema.auth.permissions.id, schema.auth.rolePermissions.permissionId),
    )
    .where(eq(schema.auth.rolePermissions.roleId, roleId));

  // The `permissions` table is seeded from the contract and the `scope` column is constrained by
  // the same pattern the schema uses, so these rows are already the shape the type claims.
  return rows;
}

/**
 * Reads the grants layered on top of a user's role.
 *
 * Expired rows come back too: dropping them is `resolveGrants`' job, which keeps the decision in
 * the tested pure function rather than half here and half there.
 *
 * @param db - The database.
 * @param userId - The user.
 * @returns Their own grants, with expiry.
 */
export async function readUserGrants(db: Database, userId: string): Promise<StoredGrant[]> {
  const rows = await db
    .select({
      key: schema.auth.permissions.key,
      scope: schema.auth.userPermissions.scope,
      effect: schema.auth.userPermissions.effect,
      expiresAt: schema.auth.userPermissions.expiresAt,
    })
    .from(schema.auth.userPermissions)
    .innerJoin(
      schema.auth.permissions,
      eq(schema.auth.permissions.id, schema.auth.userPermissions.permissionId),
    )
    .where(eq(schema.auth.userPermissions.userId, userId));

  return rows as StoredGrant[];
}

/**
 * Reads the full grant set for a user.
 *
 * @param db - The database.
 * @param user - Whose grants to read.
 * @param resolve - The pure resolution function, injected so this stays a query.
 * @returns Everything the user may and may not do.
 */
export async function readIdentityGrants(
  db: Database,
  user: UserRecord,
  resolve: (
    roleGrants: readonly ScopedPermission[],
    userGrants: readonly StoredGrant[],
  ) => GrantedPermission[],
): Promise<GrantedPermission[]> {
  const [roleGrants, userGrants] = await Promise.all([
    readRoleGrants(db, user.roleId),
    readUserGrants(db, user.id),
  ]);

  return resolve(roleGrants, userGrants);
}

/**
 * Says whether a user has confirmed a second factor.
 *
 * @param db - The database.
 * @param userId - Whose second factor.
 * @returns True once enrolment has been confirmed.
 */
export async function hasConfirmedTotp(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ confirmedAt: schema.auth.totpSecrets.confirmedAt })
    .from(schema.auth.totpSecrets)
    .where(eq(schema.auth.totpSecrets.userId, userId))
    .limit(1);

  return rows[0]?.confirmedAt != null;
}

/**
 * Reads a user's encrypted TOTP secret.
 *
 * @param db - The database.
 * @param userId - Whose secret.
 * @returns The stored ciphertext and whether enrolment was ever confirmed.
 */
export async function readTotpSecret(
  db: Database,
  userId: string,
): Promise<{ secret: Buffer; confirmedAt: Date | null } | undefined> {
  const rows = await db
    .select({
      secret: schema.auth.totpSecrets.secret,
      confirmedAt: schema.auth.totpSecrets.confirmedAt,
    })
    .from(schema.auth.totpSecrets)
    .where(eq(schema.auth.totpSecrets.userId, userId))
    .limit(1);

  return rows[0];
}

/** A newly opened session and the first refresh token in its family. */
export type IssuedSession = {
  /** The session row. */
  readonly sessionId: string;

  /** The refresh token row. */
  readonly refreshTokenId: string;
};

/**
 * Opens a session and issues its first refresh token.
 *
 * Both rows are written in one transaction: a session with no refresh token is a sign-in that
 * cannot be continued, and a refresh token with no session is a foreign key violation waiting
 * to happen.
 *
 * @param db - The database.
 * @param input - Who signed in, from where, and the digest of the token they were handed.
 * @param input.userId - The person signing in.
 * @param input.ipAddress - Where the sign-in came from.
 * @param input.userAgent - What signed in.
 * @param input.refreshDigest - The digest of the refresh token handed back.
 * @param input.now - The moment the session opened.
 * @returns The identifiers of both rows.
 */
export async function openSession(
  db: Database,
  input: {
    userId: string;
    ipAddress: string | null;
    userAgent: string | null;
    refreshDigest: Buffer;
    now: Date;
  },
): Promise<IssuedSession> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(schema.auth.sessions)
      .values({
        userId: input.userId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        createdAt: input.now,
        lastSeenAt: input.now,
        expiresAt: new Date(input.now.getTime() + SESSION_TTL_SECONDS * 1000),
      })
      .returning({ id: schema.auth.sessions.id });

    if (session === undefined) {
      throw new Error('Session insert returned no row');
    }

    const [refresh] = await tx
      .insert(schema.auth.refreshTokens)
      .values({
        sessionId: session.id,
        tokenHash: input.refreshDigest,
        issuedAt: input.now,
        expiresAt: new Date(input.now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      })
      .returning({ id: schema.auth.refreshTokens.id });

    if (refresh === undefined) {
      throw new Error('Refresh token insert returned no row');
    }

    return { sessionId: session.id, refreshTokenId: refresh.id };
  });
}

/** A refresh token row, joined to the session it belongs to. */
export type RefreshTokenRecord = {
  id: string;
  sessionId: string;
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  sessionRevokedAt: Date | null;
  sessionExpiresAt: Date;
};

/**
 * Looks a refresh token up by its digest.
 *
 * @param db - The database.
 * @param digest - The SHA-256 of what the caller presented.
 * @returns The row and its session, or undefined when the token was never issued.
 */
export async function findRefreshToken(
  db: Database,
  digest: Buffer,
): Promise<RefreshTokenRecord | undefined> {
  const rows = await db
    .select({
      id: schema.auth.refreshTokens.id,
      sessionId: schema.auth.refreshTokens.sessionId,
      userId: schema.auth.sessions.userId,
      issuedAt: schema.auth.refreshTokens.issuedAt,
      expiresAt: schema.auth.refreshTokens.expiresAt,
      usedAt: schema.auth.refreshTokens.usedAt,
      revokedAt: schema.auth.refreshTokens.revokedAt,
      sessionRevokedAt: schema.auth.sessions.revokedAt,
      sessionExpiresAt: schema.auth.sessions.expiresAt,
    })
    .from(schema.auth.refreshTokens)
    .innerJoin(
      schema.auth.sessions,
      eq(schema.auth.sessions.id, schema.auth.refreshTokens.sessionId),
    )
    .where(eq(schema.auth.refreshTokens.tokenHash, digest))
    .limit(1);

  return rows[0];
}

/**
 * Rotates a refresh token: marks the old one used and issues its replacement.
 *
 * One transaction, because the window between the two writes is exactly the window in which the
 * old token is spent and the new one does not exist.
 *
 * @param db - The database.
 * @param input - The token being replaced and the digest of its replacement.
 * @param input.previousId - The token being spent.
 * @param input.sessionId - The family both tokens belong to.
 * @param input.digest - The digest of the replacement.
 * @param input.now - The moment of the rotation.
 * @returns The new token's id.
 */
export async function rotateRefreshToken(
  db: Database,
  input: { previousId: string; sessionId: string; digest: Buffer; now: Date },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [next] = await tx
      .insert(schema.auth.refreshTokens)
      .values({
        sessionId: input.sessionId,
        tokenHash: input.digest,
        issuedAt: input.now,
        expiresAt: new Date(input.now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      })
      .returning({ id: schema.auth.refreshTokens.id });

    if (next === undefined) {
      throw new Error('Refresh token insert returned no row');
    }

    await tx
      .update(schema.auth.refreshTokens)
      .set({ usedAt: input.now, replacedBy: next.id })
      .where(eq(schema.auth.refreshTokens.id, input.previousId));

    await tx
      .update(schema.auth.sessions)
      .set({ lastSeenAt: input.now })
      .where(eq(schema.auth.sessions.id, input.sessionId));

    return next.id;
  });
}

/**
 * Revokes one session and every token in its family.
 *
 * @param db - The database.
 * @param sessionId - The session to end.
 * @param reason - Why, recorded on the row. `token_reuse` is the one that matters later.
 * @param now - When.
 */
export async function revokeSession(
  db: Database,
  sessionId: string,
  reason: SessionRevokedReason,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.auth.sessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(schema.auth.sessions.id, sessionId), isNull(schema.auth.sessions.revokedAt)));

    await tx
      .update(schema.auth.refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.auth.refreshTokens.sessionId, sessionId),
          isNull(schema.auth.refreshTokens.revokedAt),
        ),
      );
  });
}

/**
 * Revokes every session a user has.
 *
 * @param db - The database.
 * @param userId - Whose sessions.
 * @param reason - Why.
 * @param now - When.
 * @returns How many sessions were ended.
 */
export async function revokeAllSessions(
  db: Database,
  userId: string,
  reason: SessionRevokedReason,
  now: Date,
): Promise<number> {
  const revoked = await db
    .update(schema.auth.sessions)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(schema.auth.sessions.userId, userId), isNull(schema.auth.sessions.revokedAt)))
    .returning({ id: schema.auth.sessions.id });

  if (revoked.length > 0) {
    await db
      .update(schema.auth.refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          sql`${schema.auth.refreshTokens.sessionId} IN ${revoked.map((row) => row.id)}`,
          isNull(schema.auth.refreshTokens.revokedAt),
        ),
      );
  }

  return revoked.length;
}

/**
 * Records the outcome of a sign-in attempt on the user row.
 *
 * @param db - The database.
 * @param userId - Who tried.
 * @param outcome - Whether it worked, and until when to lock the account if it did not.
 * @param outcome.succeeded - Whether the credentials were accepted.
 * @param outcome.lockedUntil - When the lock lifts, when this failure caused one.
 * @param now - When.
 */
export async function recordLoginAttempt(
  db: Database,
  userId: string,
  outcome: { succeeded: boolean; lockedUntil?: Date | null },
  now: Date,
): Promise<void> {
  if (outcome.succeeded) {
    await db
      .update(schema.auth.users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
      .where(eq(schema.auth.users.id, userId));

    return;
  }

  await db
    .update(schema.auth.users)
    .set({
      failedLoginCount: sql`${schema.auth.users.failedLoginCount} + 1`,
      lockedUntil: outcome.lockedUntil ?? null,
      updatedAt: now,
    })
    .where(eq(schema.auth.users.id, userId));
}

/**
 * Replaces a user's password hash.
 *
 * @param db - The database.
 * @param userId - Whose password.
 * @param passwordHash - The new argon2id string.
 * @param now - When.
 */
export async function updatePasswordHash(
  db: Database,
  userId: string,
  passwordHash: string,
  now: Date,
): Promise<void> {
  await db
    .update(schema.auth.users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: now })
    .where(eq(schema.auth.users.id, userId));
}

/** A personal access token, joined to its owner. */
export type AccessTokenRecord = {
  id: string;
  userId: string;
  name: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

/**
 * Looks a personal access token up by its digest.
 *
 * @param db - The database.
 * @param digest - The SHA-256 of what the caller presented.
 * @returns The row, or undefined.
 */
export async function findAccessToken(
  db: Database,
  digest: Buffer,
): Promise<AccessTokenRecord | undefined> {
  const rows = await db
    .select({
      id: schema.auth.accessTokens.id,
      userId: schema.auth.accessTokens.userId,
      name: schema.auth.accessTokens.name,
      expiresAt: schema.auth.accessTokens.expiresAt,
      revokedAt: schema.auth.accessTokens.revokedAt,
    })
    .from(schema.auth.accessTokens)
    .where(eq(schema.auth.accessTokens.tokenHash, digest))
    .limit(1);

  return rows[0];
}

/**
 * Reads what one personal access token declares.
 *
 * @param db - The database.
 * @param accessTokenId - The token.
 * @returns Its declared grants, before intersection with the owner's own.
 */
export async function readAccessTokenGrants(
  db: Database,
  accessTokenId: string,
): Promise<ScopedPermission[]> {
  const rows = await db
    .select({
      key: schema.auth.permissions.key,
      scope: schema.auth.accessTokenPermissions.scope,
    })
    .from(schema.auth.accessTokenPermissions)
    .innerJoin(
      schema.auth.permissions,
      eq(schema.auth.permissions.id, schema.auth.accessTokenPermissions.permissionId),
    )
    .where(eq(schema.auth.accessTokenPermissions.accessTokenId, accessTokenId));

  return rows;
}

/**
 * Records that a personal access token was used.
 *
 * Deliberately not awaited by the caller on the request path: the timestamp is for the interface
 * to show, and making every authenticated request wait for a write to display it would be a poor
 * trade.
 *
 * @param db - The database.
 * @param accessTokenId - Which token.
 * @param now - When.
 */
export async function touchAccessToken(
  db: Database,
  accessTokenId: string,
  now: Date,
): Promise<void> {
  await db
    .update(schema.auth.accessTokens)
    .set({ lastUsedAt: now })
    .where(eq(schema.auth.accessTokens.id, accessTokenId));
}
