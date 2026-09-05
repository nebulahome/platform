/**
 * The one-time first-boot flow.
 *
 * Two endpoints that both stop working the instant they have been used once. Everything about
 * this file is about that "once" being true even when two requests arrive together: the check
 * for an existing user and the insert of the new one happen inside one transaction, behind an
 * advisory lock, so a second concurrent request waits and then finds the account it was about to
 * create. Checking first and inserting afterwards would leave a window in which an installation
 * exposed on a network gets a second owner nobody asked for.
 */
import { eq, sql } from 'drizzle-orm';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  ConflictError,
  authenticatedResponseSchema,
  sessionUserSchema,
  setupRequestSchema,
  setupResponseSchema,
  setupStatusSchema,
  type SetupResponse,
  type SetupStatus,
} from '@nebula-home/contracts';
import { schema, type Database } from '@nebula-home/db';

import { hashPassword } from '../auth/password.js';
import { resolveGrants } from '../auth/permissions.js';
import { openSession, readIdentityGrants, findUserById } from '../auth/repository.js';
import { generateOpaqueToken, signAccessToken } from '../auth/tokens.js';
import type { ApiContext } from '../context.js';
import { definePublicRoute, type RouteEnvironment } from '../http/route.js';

/**
 * The advisory lock the setup transaction takes.
 *
 * An arbitrary constant, and it only has to be one nothing else in the platform uses. A lock on
 * a row is not available here: the thing being guarded is the *absence* of rows, which is
 * exactly what row locks cannot express.
 */
const SETUP_LOCK_KEY = 6_198_450_137;

/**
 * Says whether the installation still has no accounts.
 *
 * Soft-deleted users count as existing. An installation that once had an owner and had them
 * deleted must not fall back into offering an unauthenticated way to create a new one.
 *
 * @param db - The database.
 * @returns True when `auth.users` is empty.
 */
export async function isSetupRequired(db: Database): Promise<boolean> {
  const rows = await db.select({ id: schema.auth.users.id }).from(schema.auth.users).limit(1);

  return rows.length === 0;
}

/**
 * Registers the first-boot endpoints.
 *
 * @param environment - The server, the registry and the version prefix.
 * @param context - The service context.
 */
export function registerSetupRoutes(environment: RouteEnvironment, context: ApiContext): void {
  definePublicRoute(
    environment,
    {
      method: 'GET',
      url: '/setup',
      summary: 'Whether this installation still needs its first account',
      tag: 'Setup',
      response: setupStatusSchema,
    },

    /**
     * Reports whether the setup flow is still open.
     *
     * @returns Whether an account still has to be created.
     */
    async (): Promise<SetupStatus> =>
      setupStatusSchema.parse({ isRequired: await isSetupRequired(context.db) }),
  );

  definePublicRoute(
    environment,
    {
      method: 'POST',
      url: '/setup',
      summary: 'Create the initial owner account',
      tag: 'Setup',
      body: setupRequestSchema,
      response: setupResponseSchema,
      successStatus: 201,
    },

    /**
     * Creates the first owner and signs them in.
     *
     * @param route - The parsed body and the raw request.
     * @returns The tokens and the new account.
     * @throws {ConflictError} When an account already exists. This is the endpoint closing
     * behind itself, and it is deliberately the same answer whether the account was made a
     * second ago by a racing request or a year ago by the owner.
     */
    async (route): Promise<SetupResponse> => {
      const now = context.now();
      const passwordHash = await hashPassword(route.body.password);

      const created = await context.db.transaction(async (tx) => {
        // Serialises every concurrent setup attempt on this database. Taken before the check, so
        // the check and the insert cannot be interleaved by another transaction.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);

        const existing = await tx
          .select({ id: schema.auth.users.id })
          .from(schema.auth.users)
          .limit(1);

        if (existing.length > 0) {
          throw new ConflictError('This installation has already been set up');
        }

        const roles = await tx
          .select({ id: schema.auth.roles.id })
          .from(schema.auth.roles)
          .where(eq(schema.auth.roles.key, 'owner'))
          .limit(1);

        const role = roles[0];

        if (role === undefined) {
          throw new ConflictError('The owner role is missing; run `pnpm db:migrate`');
        }

        const [user] = await tx
          .insert(schema.auth.users)
          .values({
            username: route.body.username,
            email: route.body.email ?? null,
            displayName: route.body.displayName,
            passwordHash,
            roleId: role.id,
            locale: route.body.locale,
            timezone: route.body.timezone,

            // False, unlike every other account this API creates. Nobody handed this password
            // to them - they chose it thirty seconds ago.
            mustChangePassword: false,

            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: schema.auth.users.id });

        if (user === undefined) {
          throw new ConflictError('The account could not be created');
        }

        return user.id;
      });

      const user = await findUserById(context.db, created);

      if (user === undefined) {
        throw new ConflictError('The account could not be created');
      }

      const refresh = generateOpaqueToken();
      const [permissions, session] = await Promise.all([
        readIdentityGrants(context.db, user, (roleGrants, userGrants) =>
          resolveGrants(roleGrants, userGrants, now),
        ),
        openSession(context.db, {
          userId: user.id,
          ipAddress: route.request.ip,
          userAgent: route.request.headers['user-agent'] ?? null,
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

      await context.audit.record({
        action: 'setup.complete',
        resourceType: 'user',
        resourceId: user.id,
        result: 'success',
        actorLabel: user.username,
        ipAddress: route.request.ip,
        userAgent: route.request.headers['user-agent'] ?? null,
        traceId: route.request.traceId,
      });

      context.logger.warn(
        { userId: user.id, username: user.username },
        'Initial owner account created; the setup endpoint is now closed',
      );

      void route.reply.status(201);

      return authenticatedResponseSchema.parse({
        tokens: {
          accessToken,
          tokenType: 'Bearer',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          refreshToken: refresh.secret,
        },
        user: sessionUserSchema.parse({
          // Nobody has a picture four seconds after their account was created.
          avatarUrl: null,
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.roleKey,
          permissions,
          locale: user.locale,
          timezone: user.timezone,
          isTwoFactorEnabled: false,
          mustChangePassword: false,
        }),
      });
    },
  );
}
