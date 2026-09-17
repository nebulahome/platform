/**
 * The real server around a stub database and a hub that answers on a bus in memory.
 *
 * The database is a stub that rejects everything - or, when asked, one with nothing in it -
 * which is exactly right for what the route tests assert: a configuration is checked against
 * the bundle before a row is touched, a probe never touches one at all, and the catalogue comes
 * from the hub. What the hub is given and what comes back from it is the whole of the interest.
 */
import type { FastifyInstance } from 'fastify';

import { BusClient } from '@nebula-home/bus';
import { FakeTransport } from '@nebula-home/bus/testing';
import {
  busSubjects,
  catalogueRequestSchema,
  HUB_CATALOGUE_METHOD,
  HUB_PROBE_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
  probeRequestSchema,
  reloadRequestSchema,
  type CatalogueReply,
  type IntegrationSetup,
  type ProbeReply,
  type ProbeRequest,
  type ReloadReply,
  type ReloadRequest,
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

import { testIcons } from './icons.js';

/** An environment good enough to build a server from. */
export const ENVIRONMENT = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgres://nebula:nebula@localhost:5432/nebula',
  NATS_URL: 'nats://localhost:4222',
  API_JWT_SECRET: 'a-test-signing-key-of-at-least-32-chars',
  API_TOTP_ENCRYPTION_KEY: '00'.repeat(32),
  NEBULA_SECRETS_KEY: '11'.repeat(32),
};

/** The printer driver's declaration: an address and an access code, a fixed username. */
export const PRINTER_SETUP = {
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
export const CATALOGUE: CatalogueReply = {
  vendors: [
    {
      id: 'bambu-lab',
      version: '1.0.0',
      name: 'Bambu Lab',
      logoPadding: 0,
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
          defaultIcon: 'printer',
          setup: PRINTER_SETUP,
        },
      ],
    },
    {
      id: 'acme',
      version: '2.0.0',
      name: 'ACME',
      logoPadding: 0,
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
export function emptyDatabase(): ApiContext['db'] {
  const chain: unknown = new Proxy(() => chain, {
    /**
     * Answers every property with the chain, and `then` with a resolver of nothing.
     *
     * @param target - Ignored.
     * @param key - The property asked for.
     * @returns The chain, or a `then` that resolves to no rows.
     */
    get: (target, key): unknown =>
      key === 'then'
        ? (resolve: (rows: never[]) => void): void => {
            resolve([]);
          }
        : (): unknown => chain,

    /**
     * Answers every call with the chain.
     *
     * @returns The chain.
     */
    apply: (): unknown => chain,
  });

  return chain as ApiContext['db'];
}

/** What the fake hub was asked to try, in order; cleared by whoever asserts on it. */
export const probed: ProbeRequest[] = [];

/** What the fake hub was asked to reload, in order. */
export const reloaded: string[] = [];

/** What stops the fake hub the last {@link buildTestServer} started. */
let stopCurrentHub: () => void = (): void => {
  // Nothing served yet.
};

/** Stops the fake hub the last server was built around. */
export function stopHub(): void {
  stopCurrentHub();
}

/**
 * Builds the real server around a stub database and a hub on an in-memory bus.
 *
 * @param isBusUp - Whether the server gets a bus at all.
 * @param database - The database to build around; by default one that rejects every query.
 * @returns The server, ready to inject into.
 */
export async function buildTestServer(
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
      busSubjects.service(HUB_SERVICE, HUB_RELOAD_METHOD),
      reloadRequestSchema,
      (request: ReloadRequest): ReloadReply => {
        reloaded.push(request.integrationId);

        return { state: 'identifying', lastError: null };
      },
    ),
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

  /** Unsubscribes the fake hub's subjects. */
  stopCurrentHub = (): void => {
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
    icons: await testIcons(),
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
export async function bearer(...permissions: string[]): Promise<string> {
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
