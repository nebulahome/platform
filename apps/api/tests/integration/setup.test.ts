/**
 * The first-run setup against a database of its own: the owner and the house come in one
 * transaction, `core` is told about the house, and the endpoint closes behind itself.
 *
 * Setup only runs on an installation with no users, which the development database is not, so
 * this file makes a scratch database, migrates it, and drops it at the end.
 *
 * Requires the development stack:
 *
 * ```
 * pnpm infra:up
 * ```
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, schema, type DatabaseHandle } from '@nebulahome/db';

import { bearerFor, buildTestServer, houseSyncs, stopHub } from '@/testing/hub-harness.js';

const ADMIN_URL = 'postgres://nebula:nebula@localhost:5432/postgres';
const NAME = `nebula_setup_${randomUUID().slice(0, 8)}`;
const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

let database: DatabaseHandle;
let server: FastifyInstance;

/** A setup body: the owner, and the house when given. */
const OWNER = {
  username: 'roberto',
  displayName: 'Roberto',
  password: 'a long enough password',
  locale: 'it',
  timezone: 'Europe/Rome',
};

/** The house the setup's second step asks about. */
const HOME = {
  name: 'Casa Rossi',
  latitude: 45.4642,
  longitude: 9.19,
  timeZone: 'Europe/Rome',
  temperatureUnit: 'celsius',
};

/**
 * Posts a setup body.
 *
 * @param payload - The body.
 * @returns The status and the body.
 */
async function setUp(payload: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const response = await server.inject({ method: 'POST', url: '/api/v1/setup', payload });

  return { status: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });

  await admin.unsafe(`CREATE DATABASE ${NAME}`);
  await admin.end();

  const fresh = postgres(`postgres://nebula:nebula@localhost:5432/${NAME}`, {
    max: 1,
    onnotice: () => undefined,
  });

  await applyMigrations(fresh, MIGRATIONS);
  await fresh.end();

  database = createDatabase({
    connectionString: `postgres://nebula:nebula@localhost:5432/${NAME}`,
    applicationName: 'api-setup',
  });
  server = await buildTestServer(true, database.db);
}, 120_000);

afterAll(async () => {
  stopHub();
  await server.close();
  await database.close();

  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });

  await admin.unsafe(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
  await admin.end();
});

describe('first-run setup', () => {
  it('speaks English before anybody chose a language', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/setup' });

    expect(response.json()).toEqual({ isRequired: true, locale: 'en' });
  });

  it('refuses a house that stands nowhere on Earth, and writes nothing', async () => {
    const { status } = await setUp({ ...OWNER, home: { ...HOME, latitude: 123 } });
    const users = await database.db.select().from(schema.auth.users);

    expect(status).toBe(400);
    expect(users).toHaveLength(0);
  });

  it('creates the owner and the house together, and tells core where it stands', async () => {
    const syncs = houseSyncs.count;
    const { status, body } = await setUp({ ...OWNER, home: HOME });
    const [owner] = await database.db
      .select({ locale: schema.auth.users.locale })
      .from(schema.auth.users);
    const areas = await database.db.select().from(schema.registry.areas);
    const settings = new Map(
      (
        await database.db
          .select({ key: schema.system.settings.key, value: schema.system.settings.value })
          .from(schema.system.settings)
      ).map((row) => [row.key, row.value]),
    );

    expect(status).toBe(201);
    expect(areas).toEqual([
      expect.objectContaining({
        kind: 'house',
        key: 'casa_rossi',
        name: 'Casa Rossi',
        latitude: 45.4642,
        longitude: 9.19,
      }),
    ]);
    expect(settings.get('house.timezone')).toBe('Europe/Rome');
    expect(settings.get('units.temperature')).toBe('celsius');
    expect(houseSyncs.count).toBe(syncs + 1);

    // The language the first run was read in is the house's; the owner follows it.
    expect(settings.get('house.locale')).toBe('it');
    expect(owner?.locale).toBeNull();
    expect(body).toMatchObject({ user: { locale: null, houseLocale: 'it' } });
  });

  it('tells the sign-in screen the house language', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/setup' });

    expect(response.json()).toEqual({ isRequired: false, locale: 'it' });
  });

  it('closes behind itself', async () => {
    const { status } = await setUp({ ...OWNER, username: 'somebody', home: HOME });

    expect(status).toBe(409);
    expect(await database.db.select().from(schema.registry.areas)).toHaveLength(1);
  });
});

describe('the languages, once the house is set up', () => {
  /**
   * Calls the API as the owner the setup made, with every grant the calls below need.
   *
   * @param method - The verb.
   * @param url - The path under `/api/v1`.
   * @param payload - The body, if any.
   * @returns The status and the parsed body.
   */
  async function asOwner(
    method: 'GET' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    const [owner] = await database.db
      .select({ id: schema.auth.users.id })
      .from(schema.auth.users)
      .where(eq(schema.auth.users.username, OWNER.username));
    const response = await server.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        authorization: await bearerFor(
          owner?.id ?? '',
          { key: 'settings:read', scope: '*' },
          { key: 'settings:write', scope: '*' },
        ),
      },
      ...(payload === undefined ? {} : { payload }),
    });

    return { status: response.statusCode, body: response.json() };
  }

  it('follows a change of the house language in every session', async () => {
    const { status } = await asOwner('PATCH', '/settings', { changes: { 'house.locale': 'en' } });
    const session = await asOwner('GET', '/auth/session');

    expect(status).toBe(200);
    expect(session.body).toMatchObject({ locale: null, houseLocale: 'en' });
  });

  it('refuses a language the interface does not carry', async () => {
    const { status } = await asOwner('PATCH', '/settings', { changes: { 'house.locale': 'de' } });

    expect(status).toBe(400);
  });

  it("keeps a person's own language apart from the house's", async () => {
    const session = await asOwner('GET', '/auth/session');
    const id = (session.body as { id: string }).id;
    const chosen = await asOwner('PATCH', `/users/${id}`, { locale: 'it' });
    const after = await asOwner('GET', '/auth/session');
    const followed = await asOwner('PATCH', `/users/${id}`, { locale: null });

    expect(chosen.body).toMatchObject({ locale: 'it' });
    expect(after.body).toMatchObject({ locale: 'it', houseLocale: 'en' });
    expect(followed.body).toMatchObject({ locale: null });
  });

  it('tells core when the house changes time zone', async () => {
    const syncs = houseSyncs.count;
    const { status } = await asOwner('PATCH', '/settings', {
      changes: { 'house.timezone': 'Europe/London' },
    });

    expect(status).toBe(200);
    expect(houseSyncs.count).toBe(syncs + 1);
  });
});
