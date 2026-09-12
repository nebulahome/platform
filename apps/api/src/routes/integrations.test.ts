/**
 * The integration routes against a hub that answers on a bus in memory.
 *
 * The database is a stub that rejects everything, which is exactly right for what is asserted:
 * a configuration is checked against the bundle before a row is touched, a probe never touches
 * one at all, and the catalogue comes from the hub. What the hub is given and what comes back
 * from it is the whole of the interest here.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BusClient } from '@nebula-home/bus';
import { FakeTransport } from '@nebula-home/bus/testing';
import {
  busSubjects,
  catalogueRequestSchema,
  HUB_CATALOGUE_METHOD,
  HUB_PROBE_METHOD,
  HUB_SERVICE,
  probeRequestSchema,
  type CatalogueReply,
  type IntegrationSetup,
  type ProbeReply,
  type ProbeRequest,
} from '@nebula-home/contracts';
import { secretsKeyFrom } from '@nebula-home/db';
import { createLogger } from '@nebula-home/logging';

import { Authenticator } from '../auth/authenticator.js';
import { ChallengeStore } from '../auth/challenges.js';
import { signAccessToken } from '../auth/tokens.js';
import { apiEnvSchema } from '../config.js';
import type { ApiContext } from '../context.js';
import { IdempotencyStore } from '../http/idempotency.js';
import { buildServer } from '../server.js';
import { AuditLog } from '../services/audit.js';
import { EventFanout } from '../services/events.js';

/** An environment good enough to build a server from. */
const ENVIRONMENT = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://nebula:nebula@localhost:5432/nebula',
  NATS_URL: 'nats://localhost:4222',
  API_JWT_SECRET: 'a-test-signing-key-of-at-least-32-chars',
  API_TOTP_ENCRYPTION_KEY: '00'.repeat(32),
  NEBULA_SECRETS_KEY: '11'.repeat(32),
};

/** The printer driver's declaration: an address and an access code, a fixed username. */
const PRINTER_SETUP = {
  transport: {
    constants: { username: 'bblp', shouldVerifyCertificate: false },
    fields: [
      {
        key: 'url',
        type: 'text',
        label: 'Printer address',
        isRequired: true,
        maxLength: 512,
      },
      {
        key: 'password',
        type: 'secret',
        label: 'Access code',
        isRequired: true,
        minLength: 8,
        maxLength: 8,
      },
    ],
  },
  options: { constants: {}, fields: [] },
} satisfies IntegrationSetup;

/** What the fake hub says it has loaded: a local vendor, and a cloud one that wants a key. */
const CATALOGUE: CatalogueReply = {
  vendors: [
    {
      id: 'bambu-lab',
      version: '1.0.0',
      name: 'Bambu Lab',
      internetRequired: false,
      transports: ['mqtt'],
      setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
      drivers: [
        {
          id: 'bambu-lab/printer',
          vendorId: 'bambu-lab',
          driverId: 'printer',
          name: 'Printer',
          transport: 'mqtt',
          models: ['X1C', 'P1S'],
          setup: PRINTER_SETUP,
        },
      ],
    },
    {
      id: 'acme',
      version: '2.0.0',
      name: 'ACME',
      internetRequired: true,
      transports: ['mqtt'],
      setup: {
        transport: {
          constants: {},
          fields: [
            { key: 'apiKey', type: 'secret', label: 'API key', isRequired: true, maxLength: 512 },
          ],
        },
        options: { constants: {}, fields: [] },
      },
      drivers: [
        {
          id: 'acme/printer',
          vendorId: 'acme',
          driverId: 'printer',
          name: 'Printer',
          transport: 'mqtt',
          models: [],
          setup: PRINTER_SETUP,
        },
      ],
    },
  ],
};

/**
 * A database with nothing in it.
 *
 * Every query builder chain resolves to no rows, and every write to nothing. For the routes
 * whose interest is what they do when the owner has saved nothing yet - a vendor without its
 * key, a catalogue with no instances - rather than what they refuse to do before touching a row.
 *
 * @returns Something the service layer can call as a database.
 */
function emptyDatabase(): ApiContext['db'] {
  const chain: unknown = new Proxy(() => chain, {
    get: (target, key): unknown =>
      key === 'then'
        ? (resolve: (rows: never[]) => void): void => {
            resolve([]);
          }
        : (): unknown => chain,
    apply: (): unknown => chain,
  });

  return chain as ApiContext['db'];
}

let server: FastifyInstance;
let probed: ProbeRequest[] = [];
let stopHub: () => void;

/**
 * Builds the real server around a stub database and a hub on an in-memory bus.
 *
 * @param isBusUp - Whether the server gets a bus at all.
 * @param database - The database to build around; by default one that rejects every query.
 * @returns The server, ready to inject into.
 */
async function buildTestServer(
  isBusUp: boolean,
  database?: ApiContext['db'],
): Promise<FastifyInstance> {
  const config = apiEnvSchema.parse(ENVIRONMENT);
  const logger = createLogger({ service: 'api', version: '0.0.0', level: 'fatal' });
  const secret = new TextEncoder().encode(config.API_JWT_SECRET);
  const transport = new FakeTransport();

  const hub = new BusClient({ transport, source: 'hub', logger, requestTimeoutMs: 500 });
  const subscriptions = [
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_CATALOGUE_METHOD),
      catalogueRequestSchema,
      (): CatalogueReply => CATALOGUE,
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
      probeRequestSchema,
      (request: ProbeRequest): ProbeReply => {
        probed.push(request);

        const url = request.transportConfig['url'];

        return url === 'mqtt://nowhere:1'
          ? { isReachable: false, detail: 'mqtt://nowhere:1 did not answer: ECONNREFUSED' }
          : { isReachable: true, detail: `Connected to ${typeof url === 'string' ? url : '?'}` };
      },
    ),
  ];

  stopHub = (): void => {
    for (const subscription of subscriptions) {
      subscription.unsubscribe();
    }
  };

  const db =
    database ??
    ({
      /**
       * Stands in for a database that is not there.
       *
       * @returns Never; it always rejects.
       */
      execute: (): Promise<never> => Promise.reject(new Error('no database in this test')),
    } as unknown as ApiContext['db']);

  const context: ApiContext = {
    config,
    db,
    bus: isBusUp
      ? new BusClient({ transport, source: 'api', logger, requestTimeoutMs: 500 })
      : undefined,
    logger,
    authenticator: new Authenticator({ db, secret }),
    challenges: new ChallengeStore(),
    idempotency: new IdempotencyStore(),
    audit: new AuditLog(db, logger),
    events: new EventFanout(logger),
    jwtSecret: secret,
    totpKey: Buffer.from(config.API_TOTP_ENCRYPTION_KEY, 'hex'),
    secretsKey: secretsKeyFrom(config.NEBULA_SECRETS_KEY),

    /**
     * The wall clock.
     *
     * @returns The current moment.
     */
    now: (): Date => new Date(),
  };

  return buildServer(context);
}

/**
 * Mints an access token this server will accept.
 *
 * @param permissions - What it should carry.
 * @returns The bearer header value.
 */
async function bearer(...permissions: string[]): Promise<string> {
  const token = await signAccessToken(
    {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      username: 'tester',
      role: 'owner',
      permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' })),
    },
    new TextEncoder().encode(ENVIRONMENT.API_JWT_SECRET),
  );

  return `Bearer ${token}`;
}

describe('with the hub answering', () => {
  beforeAll(async () => {
    server = await buildTestServer(true);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('keeps the catalogue from somebody without the permission', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors',
      headers: { authorization: await bearer('entity:read') },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a model the driver does not offer before touching the database', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/integrations',
      headers: { authorization: await bearer('integration:configure') },
      payload: {
        id: 'bambu-lab-1',
        kind: 'bambu-lab/printer',
        model: 'A1',
        transportConfig: { url: 'mqtt://localhost:1883', password: '12345678' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION',
        details: { issues: [{ path: 'model' }], choices: ['X1C', 'P1S'] },
      },
    });
  });

  it('tries a configuration with the constants added and reports the verdict', async () => {
    probed = [];

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/integrations/probe',
      headers: { authorization: await bearer('integration:configure') },
      payload: {
        kind: 'bambu-lab/printer',
        transportConfig: { url: 'mqtt://localhost:1883', password: '12345678' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      isReachable: true,
      detail: 'Connected to mqtt://localhost:1883',
    });
    expect(probed[0]?.transportConfig).toEqual({
      url: 'mqtt://localhost:1883',
      password: '12345678',
      username: 'bblp',
      shouldVerifyCertificate: false,
    });
  });

  it('reports a configuration that does not work as a verdict, not an error', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/integrations/probe',
      headers: { authorization: await bearer('integration:configure') },
      payload: {
        kind: 'bambu-lab/printer',
        transportConfig: { url: 'mqtt://nowhere:1', password: '12345678' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ isReachable: false });
  });

  it('refuses a configuration that is not what the bundle asks, naming the field', async () => {
    probed = [];

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/integrations/probe',
      headers: { authorization: await bearer('integration:configure') },
      payload: { kind: 'bambu-lab/printer', transportConfig: { url: 'mqtt://localhost:1883' } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION',
        details: { issues: [{ path: 'transportConfig.password' }] },
      },
    });
    expect(probed).toEqual([]);
  });

  it('checks a new instance against the bundle before touching the database', async () => {
    // The database in this test rejects every query. A 400 rather than a 500 is the proof that
    // the check came first.
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/integrations',
      headers: { authorization: await bearer('integration:configure') },
      payload: {
        id: 'bambu-lab-1',
        kind: 'bambu-lab/printer',
        model: 'X1C',
        transportConfig: { url: 'mqtt://localhost:1883', password: 'short', username: 'me' },
      },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json<{ error: { details: { issues: { path: string }[] } } }>();

    expect(body.error.details.issues.map((issue) => issue.path).sort()).toEqual([
      'transportConfig',
      'transportConfig.password',
    ]);
  });

  it('says when the kind is not one the hub has', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/integrations/probe',
      headers: { authorization: await bearer('integration:configure') },
      payload: { kind: 'nothing/installed', transportConfig: {} },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('with the hub answering and nothing saved', () => {
  beforeAll(async () => {
    server = await buildTestServer(true, emptyDatabase());
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('lists the vendors the hub has loaded, saying which still need setting up', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors',
      headers: { authorization: await bearer('integration:read') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          id: 'bambu-lab',
          needsSetup: false,
          isConfigured: false,
          instanceCount: 0,
          drivers: [{ id: 'bambu-lab/printer', models: ['X1C', 'P1S'] }],
        },
        { id: 'acme', needsSetup: true, isConfigured: false },
      ],
    });
  });

  it('reads one vendor by its id, and says when there is no such vendor', async () => {
    const found = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors/acme',
      headers: { authorization: await bearer('integration:read') },
    });
    const missing = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors/nobody',
      headers: { authorization: await bearer('integration:read') },
    });

    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ id: 'acme', name: 'ACME', internetRequired: true });
    expect(missing.statusCode).toBe(404);
  });

  it('refuses to add a device of a vendor nobody has set up, and says so', async () => {
    // The address may be right; the key is missing. The reply sends the owner to the vendor
    // page rather than back to the device form.
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/integrations',
      headers: { authorization: await bearer('integration:configure') },
      payload: {
        id: 'acme-1',
        kind: 'acme/printer',
        model: 'Printer',
        transportConfig: { url: 'mqtt://localhost:1883', password: '12345678' },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { vendorId: 'acme', reason: 'needs-setup' } },
    });
  });

  it("refuses a vendor's settings that are not what the vendor asks", async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/integrations/vendors/acme/config',
      headers: { authorization: await bearer('integration:configure') },
      payload: { transportConfig: { region: 'eu' } },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json<{ error: { details: { issues: { path: string }[] } } }>();

    expect(body.error.details.issues.map((issue) => issue.path).sort()).toEqual([
      'transportConfig',
      'transportConfig.apiKey',
    ]);
  });
});

describe('with the bus away', () => {
  beforeAll(async () => {
    server = await buildTestServer(false);
  });

  afterAll(async () => {
    stopHub();
    await server.close();
  });

  it('cannot list vendors, and says which dependency is missing', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/integrations/vendors',
      headers: { authorization: await bearer('integration:read') },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'DEVICE_UNAVAILABLE' } });
  });
});
