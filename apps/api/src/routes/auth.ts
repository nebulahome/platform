/**
 * Signing in, staying in, and signing out.
 *
 * The three things this file gets right or gets wrong:
 *
 * 1. **Enumeration.** A wrong username and a wrong password produce the same message after the
 *    same amount of work, because the username path hashes against a decoy.
 * 2. **Reuse detection.** A refresh token is single-use. Presenting a spent one means it was
 *    copied, so the whole session family is revoked rather than the request merely refused - the
 *    legitimate holder is signed out too, which is the point: they find out.
 * 3. **The second factor is not optional once enabled.** The password step hands back a
 *    challenge id and nothing else. There is no token to intercept, and no branch that issues one
 *    before the code is checked.
 */
import {
  ACCOUNT_LOCK_SECONDS,
  ACCESS_TOKEN_TTL_SECONDS,
  AuthenticationError,
  FAILED_LOGIN_LIMIT,
  authenticatedResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  sessionUserSchema,
  twoFactorRequestSchema,
  type AuthenticatedResponse,
  type GrantedPermission,
  type LoginResponse,
  type SessionUser,
} from '@nebula-home/contracts';
import { schema } from '@nebula-home/db';
import { and, eq, isNull } from 'drizzle-orm';

import { hashPassword, needsRehash, verifyAgainstDecoy, verifyPassword } from '../auth/password.js';
import { resolveGrants } from '../auth/permissions.js';
import {
  findRefreshToken,
  findUserById,
  findUserByUsername,
  hasConfirmedTotp,
  openSession,
  readIdentityGrants,
  readTotpSecret,
  recordLoginAttempt,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
  updatePasswordHash,
  type UserRecord,
} from '../auth/repository.js';
import { generateOpaqueToken, hashOpaqueToken, signAccessToken } from '../auth/tokens.js';
import { decryptSecret, verifyTotp } from '../auth/totp.js';
import type { ApiContext } from '../context.js';
import { definePublicRoute, defineRoute, type RouteEnvironment } from '../http/route.js';

/** One message for every way a sign-in can fail, so none of them is an oracle. */
const REJECTED = 'Username or password is not correct';

/**
 * Builds the user object the interface needs.
 *
 * @param user - The row.
 * @param permissions - Their resolved grants.
 * @param isTwoFactorEnabled - Whether they have confirmed a second factor.
 * @returns The session user.
 */
function toSessionUser(
  user: UserRecord,
  permissions: readonly GrantedPermission[],
  isTwoFactorEnabled: boolean,
): SessionUser {
  return sessionUserSchema.parse({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.roleKey,
    permissions,
    locale: user.locale,
    timezone: user.timezone,
    isTwoFactorEnabled,
    mustChangePassword: user.mustChangePassword,
  });
}

/**
 * Opens a session and mints the first pair of tokens.
 *
 * @param context - The service context.
 * @param user - Who is signing in.
 * @param request - Where from and with what.
 * @param request.ipAddress - The address the sign-in came from.
 * @param request.userAgent - What signed in.
 * @returns The tokens and the user.
 */
async function issueSession(
  context: ApiContext,
  user: UserRecord,
  request: { ipAddress: string | null; userAgent: string | null },
): Promise<AuthenticatedResponse> {
  const now = context.now();
  const refresh = generateOpaqueToken();

  const [permissions, isTwoFactorEnabled, session] = await Promise.all([
    readIdentityGrants(context.db, user, (roleGrants, userGrants) =>
      resolveGrants(roleGrants, userGrants, now),
    ),
    hasConfirmedTotp(context.db, user.id),
    openSession(context.db, {
      userId: user.id,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      refreshDigest: refresh.digest,
      now,
    }),
  ]);

  const accessToken = await signAccessToken(
    {
      userId: user.id,
      sessionId: session.sessionId,
      username: user.username,
      role: user.roleKey,
      permissions,
    },
    context.jwtSecret,
    context.now,
  );

  await recordLoginAttempt(context.db, user.id, { succeeded: true }, now);

  return authenticatedResponseSchema.parse({
    tokens: {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: refresh.secret,
    },
    user: toSessionUser(user, permissions, isTwoFactorEnabled),
  });
}

/**
 * Checks a code against the user's authenticator, then against their recovery codes.
 *
 * A recovery code is burned whether or not the rest of the sign-in succeeds, because it has been
 * disclosed by being typed - leaving it usable would mean a code shoulder-surfed once is a code
 * that works again.
 *
 * @param context - The service context.
 * @param userId - Whose second factor.
 * @param code - What they typed.
 * @returns True when the code was accepted.
 */
async function verifySecondFactor(
  context: ApiContext,
  userId: string,
  code: string,
): Promise<boolean> {
  const stored = await readTotpSecret(context.db, userId);

  if (stored?.confirmedAt == null) {
    return false;
  }

  if (verifyTotp(decryptSecret(stored.secret, context.totpKey), code, context.now)) {
    return true;
  }

  const candidates = await context.db
    .select({
      id: schema.auth.totpRecoveryCodes.id,
      codeHash: schema.auth.totpRecoveryCodes.codeHash,
    })
    .from(schema.auth.totpRecoveryCodes)
    .where(
      and(
        eq(schema.auth.totpRecoveryCodes.userId, userId),
        isNull(schema.auth.totpRecoveryCodes.usedAt),
      ),
    );

  const digest = hashOpaqueToken(code.trim().toLowerCase());
  const match = candidates.find((candidate) => candidate.codeHash.equals(digest));

  if (match === undefined) {
    return false;
  }

  await context.db
    .update(schema.auth.totpRecoveryCodes)
    .set({ usedAt: context.now() })
    .where(eq(schema.auth.totpRecoveryCodes.id, match.id));

  return true;
}

/**
 * Registers the sign-in endpoints.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerAuthRoutes(environment: RouteEnvironment, context: ApiContext): void {
  definePublicRoute(
    environment,
    {
      method: 'POST',
      url: '/auth/login',
      summary: 'Exchange a username and password for tokens, or for a two-factor challenge',
      tag: 'Authentication',
      body: loginRequestSchema,
      response: loginResponseSchema,
    },

    /**
     * Checks a password and either signs the caller in or asks for their second factor.
     *
     * @param route - The parsed body and the raw request.
     * @returns Tokens, or a challenge.
     * @throws {AuthenticationError} When the credentials are wrong, the account is inactive, or
     * it is locked after repeated failures.
     */
    async (route): Promise<LoginResponse> => {
      const now = context.now();
      const ipAddress = route.request.ip;
      const userAgent = route.request.headers['user-agent'] ?? null;
      const user = await findUserByUsername(context.db, route.body.username);

      if (user === undefined) {
        // The work is done anyway, so that a missing account and a wrong password take the same
        // time. Skipping it here is what turns a login endpoint into a list of valid usernames.
        await verifyAgainstDecoy(route.body.password);
        await context.audit.record({
          action: 'auth.login',
          resourceType: 'user',
          result: 'failure',
          actorLabel: route.body.username,
          ipAddress,
          userAgent,
          traceId: route.request.traceId,
          details: { reason: 'unknown_user' },
        });

        throw new AuthenticationError(REJECTED);
      }

      if ((user.lockedUntil?.getTime() ?? 0) > now.getTime()) {
        await context.audit.record({
          action: 'auth.login',
          resourceType: 'user',
          resourceId: user.id,
          result: 'failure',
          actorLabel: user.username,
          ipAddress,
          userAgent,
          traceId: route.request.traceId,
          details: { reason: 'locked' },
        });

        throw new AuthenticationError('This account is temporarily locked');
      }

      const isCorrect = await verifyPassword(user.passwordHash, route.body.password);

      if (!isCorrect || !user.isActive) {
        const attempts = user.failedLoginCount + 1;

        await recordLoginAttempt(
          context.db,
          user.id,
          {
            succeeded: false,
            lockedUntil:
              attempts >= FAILED_LOGIN_LIMIT
                ? new Date(now.getTime() + ACCOUNT_LOCK_SECONDS * 1000)
                : null,
          },
          now,
        );

        await context.audit.record({
          action: 'auth.login',
          resourceType: 'user',
          resourceId: user.id,
          result: 'failure',
          actorLabel: user.username,
          ipAddress,
          userAgent,
          traceId: route.request.traceId,
          details: { reason: isCorrect ? 'inactive' : 'bad_password', attempts },
        });

        throw new AuthenticationError(REJECTED);
      }

      // The plaintext is in hand exactly once per sign-in, which is the only moment a hash made
      // with weaker parameters can be upgraded without asking anyone to reset anything.
      if (needsRehash(user.passwordHash)) {
        await updatePasswordHash(context.db, user.id, await hashPassword(route.body.password), now);
      }

      if (await hasConfirmedTotp(context.db, user.id)) {
        const challenge = context.challenges.open(user.id, ipAddress, userAgent);

        return loginResponseSchema.parse({
          status: 'two_factor_required',
          challengeId: challenge.id,
          expiresAt: challenge.expiresAt.toISOString(),
        });
      }

      const issued = await issueSession(context, user, { ipAddress, userAgent });

      await context.audit.record({
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user.id,
        result: 'success',
        actorLabel: user.username,
        ipAddress,
        userAgent,
        traceId: route.request.traceId,
      });

      return loginResponseSchema.parse({ status: 'authenticated', ...issued });
    },
  );

  definePublicRoute(
    environment,
    {
      method: 'POST',
      url: '/auth/two-factor',
      summary: 'Complete a sign-in with a one-time code or a recovery code',
      tag: 'Authentication',
      body: twoFactorRequestSchema,
      response: authenticatedResponseSchema,
    },

    /**
     * Checks the second factor and finishes the sign-in.
     *
     * @param route - The parsed body and the raw request.
     * @returns The tokens and the user.
     * @throws {AuthenticationError} When the challenge is unknown, expired or exhausted, or the
     * code is wrong.
     */
    async (route): Promise<AuthenticatedResponse> => {
      const challenge = context.challenges.attempt(route.body.challengeId);

      if (challenge === undefined) {
        throw new AuthenticationError('This sign-in has expired, start again');
      }

      if (!(await verifySecondFactor(context, challenge.userId, route.body.code))) {
        await context.audit.record({
          action: 'auth.two_factor',
          resourceType: 'user',
          resourceId: challenge.userId,
          result: 'failure',
          ipAddress: challenge.ipAddress,
          userAgent: challenge.userAgent,
          traceId: route.request.traceId,
        });

        throw new AuthenticationError('That code is not correct');
      }

      context.challenges.close(route.body.challengeId);

      const user = await findUserById(context.db, challenge.userId);

      if (!user?.isActive) {
        throw new AuthenticationError(REJECTED);
      }

      const issued = await issueSession(context, user, {
        ipAddress: challenge.ipAddress,
        userAgent: challenge.userAgent,
      });

      await context.audit.record({
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user.id,
        result: 'success',
        actorLabel: user.username,
        ipAddress: challenge.ipAddress,
        userAgent: challenge.userAgent,
        traceId: route.request.traceId,
        details: { secondFactor: true },
      });

      return issued;
    },
  );

  definePublicRoute(
    environment,
    {
      method: 'POST',
      url: '/auth/refresh',
      summary: 'Exchange a refresh token for a new pair',
      tag: 'Authentication',
      body: refreshRequestSchema,
      response: authenticatedResponseSchema,
    },

    /**
     * Rotates a refresh token.
     *
     * @param route - The parsed body and the raw request.
     * @returns A new pair of tokens and the current user.
     * @throws {AuthenticationError} When the token is unknown, expired, revoked, or has already
     * been used - the last of which also revokes the entire session.
     */
    async (route): Promise<AuthenticatedResponse> => {
      const now = context.now();
      const record = await findRefreshToken(context.db, hashOpaqueToken(route.body.refreshToken));

      if (record === undefined) {
        throw new AuthenticationError('That refresh token is not valid');
      }

      if (record.usedAt !== null) {
        // A spent token being presented again means two parties hold it, and only one of them
        // is supposed to. There is no way to tell which, so the session ends for both.
        await revokeSession(context.db, record.sessionId, 'token_reuse', now);

        // The username is looked up for the trail rather than left as "unknown". This is the
        // one entry an owner will go looking for after a security scare, and an audit record
        // that cannot say whose session was stolen is most of the way to useless.
        const owner = await findUserById(context.db, record.userId);

        await context.audit.record({
          action: 'auth.token_reuse',
          resourceType: 'session',
          resourceId: record.sessionId,
          result: 'failure',
          actorLabel: owner?.username ?? 'unknown',
          ipAddress: route.request.ip,
          userAgent: route.request.headers['user-agent'] ?? null,
          traceId: route.request.traceId,
          details: { userId: record.userId },
        });

        context.logger.warn(
          { sessionId: record.sessionId, userId: record.userId },
          'Refresh token reuse detected, session revoked',
        );

        throw new AuthenticationError('That refresh token is not valid');
      }

      if (
        record.revokedAt !== null ||
        record.sessionRevokedAt !== null ||
        record.expiresAt.getTime() <= now.getTime() ||
        record.sessionExpiresAt.getTime() <= now.getTime()
      ) {
        throw new AuthenticationError('That refresh token is not valid');
      }

      const user = await findUserById(context.db, record.userId);

      if (!user?.isActive) {
        await revokeSession(context.db, record.sessionId, 'user_inactive', now);

        throw new AuthenticationError('That refresh token is not valid');
      }

      const next = generateOpaqueToken();

      await rotateRefreshToken(context.db, {
        previousId: record.id,
        sessionId: record.sessionId,
        digest: next.digest,
        now,
      });

      const [permissions, isTwoFactorEnabled] = await Promise.all([
        readIdentityGrants(context.db, user, (roleGrants, userGrants) =>
          resolveGrants(roleGrants, userGrants, now),
        ),
        hasConfirmedTotp(context.db, user.id),
      ]);

      const accessToken = await signAccessToken(
        {
          userId: user.id,
          sessionId: record.sessionId,
          username: user.username,
          role: user.roleKey,
          permissions,
        },
        context.jwtSecret,
        context.now,
      );

      return authenticatedResponseSchema.parse({
        tokens: {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          refreshToken: next.secret,
        },
        user: toSessionUser(user, permissions, isTwoFactorEnabled),
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/auth/logout',
      summary: 'End this session, or every session',
      tag: 'Authentication',
      permission: null,
      body: logoutRequestSchema,
      successStatus: 204,
    },

    /**
     * Revokes the caller's session or all of them.
     *
     * @param route - The parsed body and who is asking.
     */
    async (route): Promise<void> => {
      const now = context.now();

      if (route.body.allSessions) {
        const count = await revokeAllSessions(
          context.db,
          route.identity.userId,
          'user_logout_all',
          now,
        );

        await context.audit.record({
          action: 'auth.logout_all',
          resourceType: 'user',
          resourceId: route.identity.userId,
          result: 'success',
          identity: route.identity,
          ipAddress: route.request.ip,
          traceId: route.request.traceId,
          details: { sessions: count },
        });
      } else if (route.identity.sessionId !== undefined) {
        await revokeSession(context.db, route.identity.sessionId, 'user_logout', now);

        await context.audit.record({
          action: 'auth.logout',
          resourceType: 'session',
          resourceId: route.identity.sessionId,
          result: 'success',
          identity: route.identity,
          ipAddress: route.request.ip,
          traceId: route.request.traceId,
        });
      }

      void route.reply.status(204);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/auth/session',
      summary: 'Who the current credential belongs to',
      tag: 'Authentication',
      permission: null,
      response: sessionUserSchema,
    },

    /**
     * Describes the caller.
     *
     * @param route - Who is asking.
     * @returns The session user.
     * @throws {AuthenticationError} When the credential names a user who no longer exists.
     */
    async (route): Promise<SessionUser> => {
      const user = await findUserById(context.db, route.identity.userId);

      if (user === undefined) {
        throw new AuthenticationError('This account no longer exists');
      }

      return toSessionUser(
        user,
        route.identity.permissions,
        await hasConfirmedTotp(context.db, user.id),
      );
    },
  );
}
