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

import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, schema, type DatabaseHandle } from '@nebulahome/db';

import { buildTestServer, houseSyncs, stopHub } from '@/testing/hub-harness.js';

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
  it('refuses a house that stands nowhere on Earth, and writes nothing', async () => {
    const { status } = await setUp({ ...OWNER, home: { ...HOME, latitude: 123 } });
    const users = await database.db.select().from(schema.auth.users);

    expect(status).toBe(400);
    expect(users).toHaveLength(0);
  });

  it('creates the owner and the house together, and tells core where it stands', async () => {
    const syncs = houseSyncs.count;
    const { status } = await setUp({ ...OWNER, home: HOME });
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
  });

  it('closes behind itself', async () => {
    const { status } = await setUp({ ...OWNER, username: 'somebody', home: HOME });

    expect(status).toBe(409);
    expect(await database.db.select().from(schema.registry.areas)).toHaveLength(1);
  });
});
