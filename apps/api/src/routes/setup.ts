/**
 * The one-time first-boot flow.
 *
 * Two endpoints that both stop working the instant they have been used once. Everything about
 * this file is about that "once" being true even when two requests arrive together: the check
 * for an existing user and the insert of the new one happen inside one transaction, behind an
 * advisory lock, so a second concurrent request waits and then finds the account it was about to
 * create. Checking first and inserting afterwards would leave a window in which an installation
 * exposed on a network gets a second owner nobody asked for.
 *
 * The same transaction writes the house the setup asks about: its name, where it stands, the
 * time zone it keeps and how temperatures are shown. Nothing about it leaves the machine - the
 * position is typed or taken from the browser, never looked up, and no map is fetched for it -
 * and `core` is told once it is written, so the sun's entities appear at once.
 */
import { eq, like, sql } from 'drizzle-orm';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  ConflictError,
  authenticatedResponseSchema,
  sessionUserSchema,
  setupRequestSchema,
  setupResponseSchema,
  setupStatusSchema,
  toTagKey,
  type SetupHome,
  type SetupResponse,
  type SetupStatus,
} from '@nebulahome/contracts';
import { schema, type Database } from '@nebulahome/db';

import { hashPassword } from '../auth/password.js';
import { resolveGrants } from '../auth/permissions.js';
import { openSession, readIdentityGrants, findUserById } from '../auth/repository.js';
import { generateOpaqueToken, signAccessToken } from '../auth/tokens.js';
import type { ApiContext } from '../context.js';
import { definePublicRoute, type RouteEnvironment } from '../http/route.js';
import { syncHouseOnCore } from '../services/automations-core.js';
import { chooseFreeKey, keyPrefixOf } from '../services/keys.js';
import { readHouseLocale } from '../services/settings.js';

/**
 * The advisory lock the setup transaction takes.
 *
 * An arbitrary constant, and it only has to be one nothing else in the platform uses. A lock on
 * a row is not available here: the thing being guarded is the *absence* of rows, which is
 * exactly what row locks cannot express.
 */
const SETUP_LOCK_KEY = 6_198_450_137;

/** The key a house gets when its name makes none. */
const HOUSE_FALLBACK_KEY = 'home';

/** A transaction on the database, as Drizzle hands it to a callback. */
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Writes the house the setup asked about, and the settings that go with it.
 *
 * An installation set up once already has no users and so cannot get here; one whose owner was
 * removed still has its users. The house may exist all the same - areas outlive accounts - and is
 * then renamed and placed rather than doubled.
 *
 * @param tx - The setup's transaction.
 * @param home - The house.
 * @param userId - The owner just created, who wrote the settings.
 */
async function writeHome(tx: Transaction, home: SetupHome, userId: string): Promise<void> {
  const { areas } = schema.registry;
  const [existing] = await tx
    .select({ id: areas.id })
    .from(areas)
    .where(eq(areas.kind, 'house'))
    .limit(1);

  if (existing === undefined) {
    const base = toTagKey(home.name) || HOUSE_FALLBACK_KEY;
    const taken = await tx
      .select({ key: areas.key })
      .from(areas)
      .where(like(areas.key, `${keyPrefixOf(base)}%`));

    await tx.insert(areas).values({
      key: chooseFreeKey(base, new Set(taken.map((row) => row.key))),
      name: home.name,
      kind: 'house',
      latitude: home.latitude,
      longitude: home.longitude,
    });
  } else {
    await tx
      .update(areas)
      .set({ name: home.name, latitude: home.latitude, longitude: home.longitude })
      .where(eq(areas.id, existing.id));
  }

  for (const [key, value] of [
    ['house.timezone', home.timeZone],
    ['units.temperature', home.temperatureUnit],
  ] as const) {
    // Two statements, one after the other, on the one connection a transaction holds.
    // eslint-disable-next-line no-await-in-loop -- see above
    await tx
      .update(schema.system.settings)
      .set({ value, updatedBy: userId })
      .where(eq(schema.system.settings.key, key));
  }
}

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
      setupStatusSchema.parse({
        isRequired: await isSetupRequired(context.db),
        locale: await readHouseLocale(context.db),
      }),
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
     * Creates the first owner, and the house when the setup asked about it, and signs them in.
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

            // The owner follows the house language, like everybody after them, until they choose.
            locale: null,
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

        // The language the first run was read in becomes the house's, so the sign-in screen
        // and everyone added later speak it too.
        await tx
          .update(schema.system.settings)
          .set({ value: route.body.locale, updatedBy: user.id })
          .where(eq(schema.system.settings.key, 'house.locale'));

        if (route.body.home !== undefined) {
          await writeHome(tx, route.body.home, user.id);
        }

        return user.id;
      });

      if (route.body.home !== undefined) {
        // Best effort, as every house change is: a `core` that does not answer reads the house
        // when it next starts.
        await syncHouseOnCore({
          bus: context.bus,
          traceId: route.request.traceId,
          timeoutMs: context.config.API_BUS_TIMEOUT_MS,
          logger: context.logger,
        });
      }

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
          locale: null,
          houseLocale: route.body.locale,
          timezone: user.timezone,
          isTwoFactorEnabled: false,
          mustChangePassword: false,
        }),
      });
    },
  );
}
