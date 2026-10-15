/**
 * People, roles, sessions and personal access tokens.
 *
 * Two rules run through the whole file. **A person may always act on themselves** - read their
 * profile, change their own password, list and end their own sessions, manage their own tokens -
 * without holding `user:manage`. And **a person may never raise themselves**: creating a user
 * with a role, or changing someone's role, requires `user:manage`, and nothing here lets a
 * caller grant a permission they do not hold.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  ConflictError,
  NotFoundError,
  PERSONAL_ACCESS_TOKEN_PREFIX,
  TOTP_RECOVERY_CODE_COUNT,
  ValidationError,
  accessTokenViewSchema,
  changePasswordRequestSchema,
  createAccessTokenRequestSchema,
  createAccessTokenResponseSchema,
  createUserRequestSchema,
  isSupportedLocale,
  roleViewSchema,
  sessionViewSchema,
  setAvatarRequestSchema,
  twoFactorConfirmRequestSchema,
  twoFactorConfirmResponseSchema,
  twoFactorSetupResponseSchema,
  updateUserRequestSchema,
  userViewSchema,
  type AccessTokenView,
  type CreateAccessTokenResponse,
  type RoleView,
  type SessionView,
  type SupportedLocale,
  type TwoFactorConfirmResponse,
  type TwoFactorSetupResponse,
  type UserView,
} from '@nebulahome/contracts';
import { schema } from '@nebulahome/db';

import { hashPassword, verifyPassword } from '../auth/password.js';
import { isPermitted, requirePermission } from '../auth/permissions.js';
import { findUserById, revokeAllSessions, revokeSession } from '../auth/repository.js';
import { generateOpaqueToken, hashOpaqueToken } from '../auth/tokens.js';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  totpUri,
  verifyTotp,
} from '../auth/totp.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import { deleteAvatar, readAvatarUrl, readAvatarUrls, writeAvatar } from '../services/avatars.js';

/** The path parameters of the per-user routes. */
const userParamsSchema = z.object({ userId: z.uuid() });

/** The path parameters of routes addressing one of the caller's own things. */
const idParamsSchema = z.object({ id: z.uuid() });

/**
 * A collection response.
 *
 * @param item - What one entry looks like.
 * @returns The schema of a whole collection of them.
 */
const collectionSchema = <TItem extends z.ZodType>(
  item: TItem,
): z.ZodObject<{ items: z.ZodArray<TItem> }> => z.object({ items: z.array(item) });

/** The name shown in an authenticator app. */
const TOTP_ISSUER = 'Nebula Home';

/**
 * A person's language as the API shows it: one this build carries, or null for "the house's".
 *
 * A tag a later build stopped carrying is read as no choice rather than failing every read of
 * the people page.
 *
 * @param stored - The column.
 * @returns The language, or null.
 */
function languageOf(stored: string | null): SupportedLocale | null {
  return isSupportedLocale(stored) ? stored : null;
}

/**
 * Reads a user and shapes it for the API.
 *
 * @param context - The service context.
 * @param userId - Which user.
 * @returns The view.
 * @throws {NotFoundError} When no living user has that id.
 */
async function readUserView(context: ApiContext, userId: string): Promise<UserView> {
  const user = await findUserById(context.db, userId);

  if (user === undefined) {
    throw new NotFoundError('No such user', { details: { userId } });
  }

  const [totp, avatarUrl] = await Promise.all([
    context.db
      .select({ confirmedAt: schema.auth.totpSecrets.confirmedAt })
      .from(schema.auth.totpSecrets)
      .where(eq(schema.auth.totpSecrets.userId, userId))
      .limit(1),
    readAvatarUrl(context.db, userId),
  ]);

  return userViewSchema.parse({
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.roleKey,
    locale: languageOf(user.locale),
    timezone: user.timezone,
    isActive: user.isActive,
    isTwoFactorEnabled: totp[0]?.confirmedAt != null,
    avatarUrl,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    lockedUntil: user.lockedUntil,
    createdAt: user.createdAt,
  });
}

/**
 * Finds a role by its key.
 *
 * @param context - The service context.
 * @param key - The role key.
 * @returns The role's id.
 * @throws {ValidationError} When no role has that key.
 */
async function requireRoleId(context: ApiContext, key: string): Promise<string> {
  const rows = await context.db
    .select({ id: schema.auth.roles.id })
    .from(schema.auth.roles)
    .where(eq(schema.auth.roles.key, key))
    .limit(1);

  const role = rows[0];

  if (role === undefined) {
    throw new ValidationError(`No role ${key}`, { details: { role: key } });
  }

  return role.id;
}

/**
 * Registers the people and credentials endpoints.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerUserRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/users',
      summary: 'List people with accounts',
      tag: 'People',
      permission: 'user:read',
      response: collectionSchema(userViewSchema),
    },

    /**
     * Lists users.
     *
     * @param route - Who is asking.
     * @returns Every living account.
     */
    async (route): Promise<{ items: UserView[] }> => {
      requirePermission(route.identity, 'user:read');

      const rows = await context.db
        .select({
          id: schema.auth.users.id,
          username: schema.auth.users.username,
          email: schema.auth.users.email,
          displayName: schema.auth.users.displayName,
          role: schema.auth.roles.key,
          locale: schema.auth.users.locale,
          timezone: schema.auth.users.timezone,
          isActive: schema.auth.users.isActive,
          mustChangePassword: schema.auth.users.mustChangePassword,
          lastLoginAt: schema.auth.users.lastLoginAt,
          lockedUntil: schema.auth.users.lockedUntil,
          createdAt: schema.auth.users.createdAt,
          confirmedAt: schema.auth.totpSecrets.confirmedAt,
        })
        .from(schema.auth.users)
        .innerJoin(schema.auth.roles, eq(schema.auth.roles.id, schema.auth.users.roleId))
        .leftJoin(schema.auth.totpSecrets, eq(schema.auth.totpSecrets.userId, schema.auth.users.id))
        .where(isNull(schema.auth.users.deletedAt))
        .orderBy(asc(schema.auth.users.username));

      // One query for every avatar rather than one per row: a household of twenty people is a
      // page, and a page must not be twenty round trips.
      const avatars = await readAvatarUrls(
        context.db,
        rows.map((row) => row.id),
      );

      return {
        items: rows.map((row) =>
          userViewSchema.parse({
            ...row,
            locale: languageOf(row.locale),
            isTwoFactorEnabled: row.confirmedAt != null,
            avatarUrl: avatars.get(row.id) ?? null,
          }),
        ),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/users',
      summary: 'Create an account',
      tag: 'People',
      permission: 'user:manage',
      body: createUserRequestSchema,
      response: userViewSchema,
      successStatus: 201,
    },

    /**
     * Creates a user.
     *
     * @param route - The parsed body and who is asking.
     * @returns The new account.
     * @throws {ConflictError} When the username or email is already taken by a living account.
     */
    async (route): Promise<UserView> => {
      requirePermission(route.identity, 'user:manage');

      const roleId = await requireRoleId(context, route.body.role);
      const now = context.now();

      const existing = await context.db
        .select({ id: schema.auth.users.id })
        .from(schema.auth.users)
        .where(
          and(
            eq(schema.auth.users.username, route.body.username),
            isNull(schema.auth.users.deletedAt),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictError('That username is taken', {
          details: { username: route.body.username },
        });
      }

      const [created] = await context.db
        .insert(schema.auth.users)
        .values({
          username: route.body.username,
          email: route.body.email ?? null,
          displayName: route.body.displayName,
          passwordHash: await hashPassword(route.body.password),
          roleId,
          locale: route.body.locale,
          timezone: route.body.timezone,
          mustChangePassword: route.body.mustChangePassword,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: schema.auth.users.id });

      if (created === undefined) {
        throw new ConflictError('The account could not be created');
      }

      await context.audit.record({
        action: 'user.create',
        resourceType: 'user',
        resourceId: created.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { username: route.body.username, role: route.body.role },
      });

      void route.reply
        .status(201)
        .header('location', `${environment.basePath}/users/${created.id}`);

      return readUserView(context, created.id);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/users/me',
      summary: 'Read your own account',
      tag: 'People',
      permission: null,
      response: userViewSchema,
    },

    /**
     * Reads the caller's own account.
     *
     * @param route - Who is asking.
     * @returns Their account.
     */
    async (route): Promise<UserView> => readUserView(context, route.identity.userId),
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/users/:userId',
      summary: 'Read one account',
      tag: 'People',
      permission: 'user:read',
      params: userParamsSchema,
      response: userViewSchema,
    },

    /**
     * Reads one account.
     *
     * @param route - The path parameters and who is asking.
     * @returns The account.
     */
    async (route): Promise<UserView> => {
      if (route.params.userId !== route.identity.userId) {
        requirePermission(route.identity, 'user:read');
      }

      return readUserView(context, route.params.userId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PATCH',
      url: '/users/:userId',
      summary: 'Change an account',
      tag: 'People',
      permission: 'user:manage',
      params: userParamsSchema,
      body: updateUserRequestSchema,
      response: userViewSchema,
    },

    /**
     * Changes an account.
     *
     * A person may edit their own profile without `user:manage`, but not their own role or
     * whether they are active - those are the two fields that would let anyone promote
     * themselves.
     *
     * @param route - The path parameters, the body and who is asking.
     * @returns The updated account.
     */
    async (route): Promise<UserView> => {
      const isSelf = route.params.userId === route.identity.userId;
      const changesPrivilege = route.body.role !== undefined || route.body.isActive !== undefined;

      if (!isSelf || changesPrivilege) {
        requirePermission(route.identity, 'user:manage');
      }

      const values: Record<string, unknown> = { updatedAt: context.now() };

      if (route.body.email !== undefined) {
        values['email'] = route.body.email;
      }

      if (route.body.displayName !== undefined) {
        values['displayName'] = route.body.displayName;
      }

      if (route.body.locale !== undefined) {
        values['locale'] = route.body.locale;
      }

      if (route.body.timezone !== undefined) {
        values['timezone'] = route.body.timezone;
      }

      if (route.body.isActive !== undefined) {
        values['isActive'] = route.body.isActive;
      }

      if (route.body.role !== undefined) {
        values['roleId'] = await requireRoleId(context, route.body.role);
      }

      const updated = await context.db
        .update(schema.auth.users)
        .set(values)
        .where(
          and(eq(schema.auth.users.id, route.params.userId), isNull(schema.auth.users.deletedAt)),
        )
        .returning({ id: schema.auth.users.id });

      if (updated.length === 0) {
        throw new NotFoundError('No such user', { details: { userId: route.params.userId } });
      }

      if (changesPrivilege) {
        await context.audit.record({
          action: 'user.update',
          resourceType: 'user',
          resourceId: route.params.userId,
          result: 'success',
          identity: route.identity,
          ipAddress: route.request.ip,
          traceId: route.request.traceId,
          details: {
            ...(route.body.role === undefined ? {} : { role: route.body.role }),
            ...(route.body.isActive === undefined ? {} : { isActive: route.body.isActive }),
          },
        });
      }

      return readUserView(context, route.params.userId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/users/:userId',
      summary: 'Delete an account',
      tag: 'People',
      permission: 'user:manage',
      params: userParamsSchema,
      successStatus: 204,
    },

    /**
     * Soft-deletes an account and revokes everything it could sign in with.
     *
     * Soft, because `system.audit_log` and `registry.automations.created_by` name this user, and
     * an audit trail that loses the identity of the actor is not an audit trail.
     *
     * @param route - The path parameters and who is asking.
     * @throws {ValidationError} When a caller tries to delete their own account. Someone else has
     * to do it, which is what stops the last owner deleting themselves out of the system.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'user:manage');

      if (route.params.userId === route.identity.userId) {
        throw new ValidationError('You cannot delete your own account');
      }

      const now = context.now();
      const deleted = await context.db
        .update(schema.auth.users)
        .set({
          deletedAt: now,
          isActive: false,

          // Cleared rather than kept: a soft-deleted row that still holds a verifiable hash is
          // a dormant account waiting for the deletion to be undone by a bug.
          passwordHash: '',
          updatedAt: now,
        })
        .where(
          and(eq(schema.auth.users.id, route.params.userId), isNull(schema.auth.users.deletedAt)),
        )
        .returning({ id: schema.auth.users.id, username: schema.auth.users.username });

      const row = deleted[0];

      if (row === undefined) {
        throw new NotFoundError('No such user', { details: { userId: route.params.userId } });
      }

      await revokeAllSessions(context.db, row.id, 'admin', now);
      await context.db
        .update(schema.auth.accessTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(schema.auth.accessTokens.userId, row.id),
            isNull(schema.auth.accessTokens.revokedAt),
          ),
        );

      await context.audit.record({
        action: 'user.delete',
        resourceType: 'user',
        resourceId: row.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { username: row.username },
      });

      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/users/me/password',
      summary: 'Change your own password',
      tag: 'People',
      permission: null,
      body: changePasswordRequestSchema,
      successStatus: 204,
    },

    /**
     * Replaces the caller's password and signs every other session out.
     *
     * @param route - The parsed body and who is asking.
     * @throws {ValidationError} When the current password is wrong.
     */
    async (route): Promise<void> => {
      const user = await findUserById(context.db, route.identity.userId);

      if (user === undefined) {
        throw new NotFoundError('No such user');
      }

      if (!(await verifyPassword(user.passwordHash, route.body.currentPassword))) {
        throw new ValidationError('The current password is not correct');
      }

      const now = context.now();

      await context.db
        .update(schema.auth.users)
        .set({
          passwordHash: await hashPassword(route.body.newPassword),
          mustChangePassword: false,
          updatedAt: now,
        })
        .where(eq(schema.auth.users.id, user.id));

      // Every session but this one: changing a password is what someone does after suspecting
      // it was learned, and leaving the other sessions alive would leave the suspicion standing.
      await revokeAllSessions(context.db, user.id, 'password_change', now);

      await context.audit.record({
        action: 'user.password_change',
        resourceType: 'user',
        resourceId: user.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
      });

      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/users/me/sessions',
      summary: 'List your own sessions',
      tag: 'People',
      permission: null,
      response: collectionSchema(sessionViewSchema),
    },

    /**
     * Lists the caller's live sessions.
     *
     * @param route - Who is asking.
     * @returns Every session that has not been revoked.
     */
    async (route): Promise<{ items: SessionView[] }> => {
      const rows = await context.db
        .select({
          id: schema.auth.sessions.id,
          ipAddress: schema.auth.sessions.ipAddress,
          userAgent: schema.auth.sessions.userAgent,
          createdAt: schema.auth.sessions.createdAt,
          lastSeenAt: schema.auth.sessions.lastSeenAt,
          expiresAt: schema.auth.sessions.expiresAt,
        })
        .from(schema.auth.sessions)
        .where(
          and(
            eq(schema.auth.sessions.userId, route.identity.userId),
            isNull(schema.auth.sessions.revokedAt),
          ),
        )
        .orderBy(asc(schema.auth.sessions.createdAt));

      return {
        items: rows.map((row) =>
          sessionViewSchema.parse({ ...row, isCurrent: row.id === route.identity.sessionId }),
        ),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/users/me/sessions/:id',
      summary: 'End one of your own sessions',
      tag: 'People',
      permission: null,
      params: idParamsSchema,
      successStatus: 204,
    },

    /**
     * Revokes one of the caller's sessions.
     *
     * @param route - The path parameters and who is asking.
     * @throws {NotFoundError} When the session is not theirs. Not `403`: whether a session id
     * exists is not something one person should learn about another.
     */
    async (route): Promise<void> => {
      const rows = await context.db
        .select({ id: schema.auth.sessions.id })
        .from(schema.auth.sessions)
        .where(
          and(
            eq(schema.auth.sessions.id, route.params.id),
            eq(schema.auth.sessions.userId, route.identity.userId),
          ),
        )
        .limit(1);

      if (rows.length === 0) {
        throw new NotFoundError('No such session');
      }

      await revokeSession(context.db, route.params.id, 'logout', context.now());
      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/users/me/tokens',
      summary: 'List your own personal access tokens',
      tag: 'People',
      permission: null,
      response: collectionSchema(accessTokenViewSchema),
    },

    /**
     * Lists the caller's tokens.
     *
     * @param route - Who is asking.
     * @returns Every token they have issued and not revoked.
     */
    async (route): Promise<{ items: AccessTokenView[] }> => {
      const rows = await context.db
        .select({
          id: schema.auth.accessTokens.id,
          name: schema.auth.accessTokens.name,
          tokenPrefix: schema.auth.accessTokens.tokenPrefix,
          lastUsedAt: schema.auth.accessTokens.lastUsedAt,
          expiresAt: schema.auth.accessTokens.expiresAt,
          createdAt: schema.auth.accessTokens.createdAt,
        })
        .from(schema.auth.accessTokens)
        .where(
          and(
            eq(schema.auth.accessTokens.userId, route.identity.userId),
            isNull(schema.auth.accessTokens.revokedAt),
          ),
        )
        .orderBy(asc(schema.auth.accessTokens.createdAt));

      const grants =
        rows.length === 0
          ? []
          : await context.db
              .select({
                accessTokenId: schema.auth.accessTokenPermissions.accessTokenId,
                key: schema.auth.permissions.key,
                scope: schema.auth.accessTokenPermissions.scope,
              })
              .from(schema.auth.accessTokenPermissions)
              .innerJoin(
                schema.auth.permissions,
                eq(schema.auth.permissions.id, schema.auth.accessTokenPermissions.permissionId),
              );

      const byToken = new Map<string, { key: string; scope: string }[]>();

      for (const grant of grants) {
        byToken.set(grant.accessTokenId, [
          ...(byToken.get(grant.accessTokenId) ?? []),
          { key: grant.key, scope: grant.scope },
        ]);
      }

      return {
        items: rows.map((row) =>
          accessTokenViewSchema.parse({ ...row, permissions: byToken.get(row.id) ?? [] }),
        ),
      };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/users/me/tokens',
      summary: 'Issue a personal access token',
      tag: 'People',
      permission: null,
      body: createAccessTokenRequestSchema,
      response: createAccessTokenResponseSchema,
      successStatus: 201,
    },

    /**
     * Issues a token, scoped to permissions the caller already holds.
     *
     * @param route - The parsed body and who is asking.
     * @returns The token, with its secret shown exactly once.
     * @throws {PermissionError} When the token would declare something the caller cannot do.
     * Refused rather than silently narrowed: a token that quietly does less than it was asked
     * for fails later, somewhere else, for reasons nobody can see.
     */
    async (route): Promise<CreateAccessTokenResponse> => {
      for (const declared of route.body.permissions) {
        if (
          !isPermitted(
            route.identity.permissions,
            declared.key,
            declared.scope === '*' ? [] : [declared.scope],
          )
        ) {
          requirePermission(route.identity, declared.key, [declared.scope]);
        }
      }

      const now = context.now();
      const secret = generateOpaqueToken(PERSONAL_ACCESS_TOKEN_PREFIX);
      const tokenPrefix = secret.secret.slice(0, PERSONAL_ACCESS_TOKEN_PREFIX.length + 6);

      const created = await context.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.auth.accessTokens)
          .values({
            userId: route.identity.userId,
            name: route.body.name,
            tokenHash: secret.digest,
            tokenPrefix,
            expiresAt: route.body.expiresAt === null ? null : new Date(route.body.expiresAt),
            createdAt: now,
          })
          .returning({ id: schema.auth.accessTokens.id });

        if (row === undefined) {
          throw new ConflictError('The token could not be created');
        }

        const keys = route.body.permissions.map((entry) => entry.key);
        const permissionRows = await tx
          .select({ id: schema.auth.permissions.id, key: schema.auth.permissions.key })
          .from(schema.auth.permissions)
          .where(inArray(schema.auth.permissions.key, keys));

        const idByKey = new Map(permissionRows.map((entry) => [entry.key, entry.id]));

        await tx.insert(schema.auth.accessTokenPermissions).values(
          route.body.permissions.map((entry) => {
            const permissionId = idByKey.get(entry.key);

            if (permissionId === undefined) {
              throw new ValidationError(`No permission ${entry.key}`, {
                details: { permission: entry.key },
              });
            }

            return { accessTokenId: row.id, permissionId, scope: entry.scope };
          }),
        );

        return row.id;
      });

      await context.audit.record({
        action: 'token.create',
        resourceType: 'access_token',
        resourceId: created,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: route.body.name, permissions: route.body.permissions.map((e) => e.key) },
      });

      void route.reply.status(201);

      return createAccessTokenResponseSchema.parse({
        token: {
          id: created,
          name: route.body.name,
          tokenPrefix,
          permissions: route.body.permissions,
          lastUsedAt: null,
          expiresAt: route.body.expiresAt === null ? null : new Date(route.body.expiresAt),
          createdAt: now,
        },
        secret: secret.secret,
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/users/me/tokens/:id',
      summary: 'Revoke one of your own personal access tokens',
      tag: 'People',
      permission: null,
      params: idParamsSchema,
      successStatus: 204,
    },

    /**
     * Revokes a token.
     *
     * @param route - The path parameters and who is asking.
     * @throws {NotFoundError} When the token is not theirs.
     */
    async (route): Promise<void> => {
      const revoked = await context.db
        .update(schema.auth.accessTokens)
        .set({ revokedAt: context.now() })
        .where(
          and(
            eq(schema.auth.accessTokens.id, route.params.id),
            eq(schema.auth.accessTokens.userId, route.identity.userId),
            isNull(schema.auth.accessTokens.revokedAt),
          ),
        )
        .returning({ id: schema.auth.accessTokens.id });

      if (revoked.length === 0) {
        throw new NotFoundError('No such token');
      }

      await context.audit.record({
        action: 'token.revoke',
        resourceType: 'access_token',
        resourceId: route.params.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
      });

      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/users/me/two-factor',
      summary: 'Begin two-factor enrolment',
      tag: 'People',
      permission: null,
      response: twoFactorSetupResponseSchema,

      // 200, not the 201 a POST defaults to: this starts an enrolment, it does not create a
      // resource with a location. Nothing is enforced until the next call confirms it.
      successStatus: 200,
    },

    /**
     * Generates and stores an unconfirmed secret.
     *
     * Nothing is enforced yet. A secret stored as confirmed here would lock out anyone who
     * scanned the code into the wrong app or lost the phone before testing it.
     *
     * @param route - Who is asking.
     * @returns The secret and the URI to scan.
     */
    async (route): Promise<TwoFactorSetupResponse> => {
      const secret = generateTotpSecret();
      const now = context.now();

      await context.db
        .insert(schema.auth.totpSecrets)
        .values({
          userId: route.identity.userId,
          secret: encryptSecret(secret, context.totpKey),
          confirmedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.auth.totpSecrets.userId,
          set: {
            secret: encryptSecret(secret, context.totpKey),
            confirmedAt: null,
            updatedAt: now,
          },
        });

      return twoFactorSetupResponseSchema.parse({
        secret: secret.toString('base64'),
        uri: totpUri(secret, route.identity.username, TOTP_ISSUER),
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/users/me/two-factor/confirm',
      summary: 'Confirm two-factor enrolment and receive recovery codes',
      tag: 'People',
      permission: null,
      body: twoFactorConfirmRequestSchema,
      response: twoFactorConfirmResponseSchema,
      successStatus: 200,
    },

    /**
     * Confirms enrolment by checking one generated code.
     *
     * @param route - The parsed body and who is asking.
     * @returns The recovery codes, shown exactly once.
     * @throws {ValidationError} When enrolment was never started, or the code is wrong.
     */
    async (route): Promise<TwoFactorConfirmResponse> => {
      const rows = await context.db
        .select({ secret: schema.auth.totpSecrets.secret })
        .from(schema.auth.totpSecrets)
        .where(eq(schema.auth.totpSecrets.userId, route.identity.userId))
        .limit(1);

      const stored = rows[0];

      if (stored === undefined) {
        throw new ValidationError('Two-factor enrolment has not been started');
      }

      if (
        !verifyTotp(decryptSecret(stored.secret, context.totpKey), route.body.code, context.now)
      ) {
        throw new ValidationError('That code is not correct');
      }

      const now = context.now();
      const codes = generateRecoveryCodes(TOTP_RECOVERY_CODE_COUNT);

      await context.db.transaction(async (tx) => {
        await tx
          .update(schema.auth.totpSecrets)
          .set({ confirmedAt: now, updatedAt: now })
          .where(eq(schema.auth.totpSecrets.userId, route.identity.userId));

        await tx
          .delete(schema.auth.totpRecoveryCodes)
          .where(eq(schema.auth.totpRecoveryCodes.userId, route.identity.userId));

        await tx.insert(schema.auth.totpRecoveryCodes).values(
          codes.map((code) => ({
            userId: route.identity.userId,
            codeHash: hashOpaqueToken(code),
            createdAt: now,
          })),
        );
      });

      await context.audit.record({
        action: 'user.two_factor_enabled',
        resourceType: 'user',
        resourceId: route.identity.userId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
      });

      return twoFactorConfirmResponseSchema.parse({ recoveryCodes: codes });
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/users/me/two-factor',
      summary: 'Turn off two-factor authentication',
      tag: 'People',
      permission: null,
      successStatus: 204,
    },

    /**
     * Removes the caller's second factor.
     *
     * @param route - Who is asking.
     */
    async (route): Promise<void> => {
      await context.db.transaction(async (tx) => {
        await tx
          .delete(schema.auth.totpSecrets)
          .where(eq(schema.auth.totpSecrets.userId, route.identity.userId));
        await tx
          .delete(schema.auth.totpRecoveryCodes)
          .where(eq(schema.auth.totpRecoveryCodes.userId, route.identity.userId));
      });

      await context.audit.record({
        action: 'user.two_factor_disabled',
        resourceType: 'user',
        resourceId: route.identity.userId,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
      });

      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/users/:userId/avatar',
      summary: 'Set a picture for an account',
      tag: 'People',
      permission: 'user:manage',
      params: userParamsSchema,
      body: setAvatarRequestSchema,
      response: userViewSchema,
      successStatus: 200,
    },

    /**
     * Stores a picture.
     *
     * A person may set their own without `user:manage`, on the same rule as the rest of their
     * profile: a picture says who you are, and who you are is yours to say.
     *
     * @param route - The path parameters, the body and who is asking.
     * @returns The account as it now stands.
     * @throws {NotFoundError} When no living user has that id.
     */
    async (route): Promise<UserView> => {
      const isSelf = route.params.userId === route.identity.userId;

      if (!isSelf) {
        requirePermission(route.identity, 'user:manage');
      }

      // Read first, so an id that names nobody is a 404 rather than a foreign key violation
      // reported as a 500.
      const target = await findUserById(context.db, route.params.userId);

      if (target === undefined) {
        throw new NotFoundError('No such user', { details: { userId: route.params.userId } });
      }

      await writeAvatar(context.db, route.params.userId, route.body.mime, route.body.data);

      if (!isSelf) {
        // Only when it is somebody else's account. Changing your own picture is not an event
        // anybody needs to be able to look up later.
        await context.audit.record({
          action: 'user.avatar_set',
          resourceType: 'user',
          resourceId: route.params.userId,
          result: 'success',
          identity: route.identity,
          ipAddress: route.request.ip,
          traceId: route.request.traceId,
        });
      }

      return readUserView(context, route.params.userId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/users/:userId/avatar',
      summary: 'Remove the picture from an account',
      tag: 'People',
      permission: 'user:manage',
      params: userParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a picture.
     *
     * Silent when there was none. The caller asked for an account with no picture and that is
     * what they have.
     *
     * @param route - The path parameters and who is asking.
     */
    async (route): Promise<void> => {
      if (route.params.userId !== route.identity.userId) {
        requirePermission(route.identity, 'user:manage');
      }

      await deleteAvatar(context.db, route.params.userId);

      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/roles',
      summary: 'List roles and what they grant',
      tag: 'People',
      permission: 'user:read',
      response: collectionSchema(roleViewSchema),
    },

    /**
     * Lists roles.
     *
     * @param route - Who is asking.
     * @returns Every role, its grants and how many people hold it.
     */
    async (route): Promise<{ items: RoleView[] }> => {
      requirePermission(route.identity, 'user:read');

      const rows = await context.db
        .select({
          id: schema.auth.roles.id,
          key: schema.auth.roles.key,
          name: schema.auth.roles.name,
          description: schema.auth.roles.description,
          isBuiltin: schema.auth.roles.isBuiltin,
          sortOrder: schema.auth.roles.sortOrder,
          userCount: sql<number>`count(${schema.auth.users.id})::int`,
        })
        .from(schema.auth.roles)
        .leftJoin(
          schema.auth.users,
          and(
            eq(schema.auth.users.roleId, schema.auth.roles.id),
            isNull(schema.auth.users.deletedAt),
          ),
        )
        .groupBy(schema.auth.roles.id)
        .orderBy(asc(schema.auth.roles.sortOrder));

      const grants = await context.db
        .select({
          roleId: schema.auth.rolePermissions.roleId,
          key: schema.auth.permissions.key,
          scope: schema.auth.rolePermissions.scope,
        })
        .from(schema.auth.rolePermissions)
        .innerJoin(
          schema.auth.permissions,
          eq(schema.auth.permissions.id, schema.auth.rolePermissions.permissionId),
        );

      const byRole = new Map<string, { key: string; scope: string; effect: 'allow' }[]>();

      for (const grant of grants) {
        byRole.set(grant.roleId, [
          ...(byRole.get(grant.roleId) ?? []),
          { key: grant.key, scope: grant.scope, effect: 'allow' },
        ]);
      }

      return {
        items: rows.map((row) =>
          roleViewSchema.parse({ ...row, permissions: byRole.get(row.id) ?? [] }),
        ),
      };
    },
  );
}
