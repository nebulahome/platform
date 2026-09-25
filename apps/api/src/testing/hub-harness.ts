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
  BUS_PATTERNS,
  busSubjects,
  capabilityCommandRequestSchema,
  catalogueRequestSchema,
  CORE_REMOVE_ALIAS_METHOD,
  CORE_SERVICE,
  CORE_SYNC_ALIAS_METHOD,
  CORE_SYSTEM_MONITOR_METHOD,
  CORE_UNREGISTER_METHOD,
  discoveredDeviceSchema,
  discoveredRequestSchema,
  discoverRequestSchema,
  forgetRequestSchema,
  parseCommandSubject,
  removeAliasRequestSchema,
  syncAliasRequestSchema,
  HUB_CATALOGUE_METHOD,
  HUB_DISCOVER_METHOD,
  HUB_DISCOVERED_METHOD,
  HUB_FORGET_METHOD,
  HUB_PROBE_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
  probeRequestSchema,
  reloadRequestSchema,
  systemMonitorRequestSchema,
  unregisterDeviceRequestSchema,
  type CapabilityCommandRequest,
  type CatalogueReply,
  type CommandAck,
  type DiscoveredDevice,
  type DiscoveredReply,
  type DiscoverReply,
  type DiscoverRequest,
  type ForgetReply,
  type ForgetRequest,
  type IntegrationSetup,
  type ProbeReply,
  type ProbeRequest,
  type ReloadReply,
  type ReloadRequest,
  type RemoveAliasReply,
  type RemoveAliasRequest,
  type SyncAliasReply,
  type SyncAliasRequest,
  type SystemMonitorSnapshot,
  type UnregisterDeviceReply,
  type UnregisterDeviceRequest,
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
import { testMapTiles } from './map-tiles.js';

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
      discoverySources: [],
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
      discoverySources: [],
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

/** What the fake `core` answers the system monitor with. */
export const SYSTEM_SNAPSHOT: SystemMonitorSnapshot = {
  host: {
    hostname: 'nebula',
    platform: 'linux',
    osName: 'Linux 6.8.0',
    arch: 'x64',
    uptimeSeconds: 3600,
    cpuModel: 'Intel(R) N100',
    cpuCount: 4,
  },
  sampleIntervalMs: 10_000,
  samples: [
    {
      at: new Date('2026-09-23T12:00:00.000Z'),
      cpuPercent: 12.5,
      memoryUsedBytes: 4_000_000_000,
      memoryTotalBytes: 16_000_000_000,
      receiveRate: 1200,
      transmitRate: 300,
    },
  ],
  network: { interface: 'eth0', receivedBytes: 10_000_000, transmittedBytes: 2_000_000 },
  disk: {
    totalBytes: 500_000_000_000,
    freeBytes: 300_000_000_000,
    usedBytes: 200_000_000_000,
    otherBytes: 198_000_000_000,
    categories: [
      {
        id: 'core',
        kind: 'core',
        bytes: 2_000_000_000,
        parts: [
          { id: 'database', bytes: 1_900_000_000 },
          { id: 'cache/maps', bytes: 100_000_000 },
        ],
      },
    ],
    measuredAt: new Date('2026-09-23T11:58:00.000Z'),
  },
};

/** A printer the fake hub heard announce itself, identified and matched to its driver. */
export const DISCOVERED_PRINTER: DiscoveredDevice = discoveredDeviceSchema.parse({
  id: '0123456789abcdef',
  vendorId: 'bambu-lab',
  driverId: 'printer',
  kind: 'bambu-lab/printer',
  source: 'mdns',
  address: '192.168.1.70',
  externalId: '01P00A000000001',
  name: 'Workshop',
  model: 'X1C',
  modelChoices: ['X1C'],
  modelCode: 'BL-P001',
  swVersion: '01.08.00.00',
  transportConfig: { url: 'mqtts://192.168.1.70:8883' },
  firstSeenAt: '2026-09-23T10:00:00.000Z',
  lastSeenAt: '2026-09-23T10:05:00.000Z',
});

/** A device of the vendor that still needs setting up, heard all the same. */
export const DISCOVERED_ACME: DiscoveredDevice = discoveredDeviceSchema.parse({
  ...DISCOVERED_PRINTER,
  id: 'fedcba9876543210',
  vendorId: 'acme',
  kind: 'acme/printer',
  model: 'Printer',
  modelChoices: ['Printer'],
});

/** What the fake hub was asked to try, in order; cleared by whoever asserts on it. */
export const probed: ProbeRequest[] = [];

/** What the fake hub was asked to reload, in order. */
export const reloaded: string[] = [];

/** Which vendors the hub was asked to look for, in order. */
export const scanned: string[] = [];

/** What the fake hub was asked to forget, in order. */
export const forgotten: string[] = [];

/** What the fake `core` was asked to release, in order. */
export const unregistered: string[] = [];

/** What the fake `core` was asked to take in, by alias entity id, in order. */
export const aliasesSynced: string[] = [];

/** What the fake `core` was asked to remove, by alias entity id, in order. */
export const aliasesRemoved: string[] = [];

/** Every command the fake `core` accepted, in order. */
export const commanded: { entityId: string; capability: string; command: string }[] = [];

/** What the fake `core` throws instead of releasing, when a test wants it to refuse. */
export let coreRefuses: Error | null = null;

/**
 * Makes the fake `core` refuse the next releases and alias removals, or stop refusing.
 *
 * @param error - What it should throw, or null to release as usual.
 */
export function makeCoreRefuse(error: Error | null): void {
  coreRefuses = error;
}

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
  const core = new BusClient({ transport, source: 'core', logger, requestTimeoutMs: 500 });
  const subscriptions = [
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_FORGET_METHOD),
      forgetRequestSchema,
      (request: ForgetRequest): ForgetReply => {
        forgotten.push(request.integrationId);

        return { wasRunning: true };
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_UNREGISTER_METHOD),
      unregisterDeviceRequestSchema,
      (request: UnregisterDeviceRequest): UnregisterDeviceReply => {
        if (coreRefuses !== null) {
          throw coreRefuses;
        }

        unregistered.push(request.integrationId);

        return { deviceId: null, entityIds: [] };
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_ALIAS_METHOD),
      syncAliasRequestSchema,
      (request: SyncAliasRequest): SyncAliasReply => {
        aliasesSynced.push(request.entityId);

        return { isLoaded: true };
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_REMOVE_ALIAS_METHOD),
      removeAliasRequestSchema,
      (request: RemoveAliasRequest): RemoveAliasReply => {
        if (coreRefuses !== null) {
          throw coreRefuses;
        }

        aliasesRemoved.push(request.entityId);

        return { entityId: request.entityId };
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYSTEM_MONITOR_METHOD),
      systemMonitorRequestSchema,
      (): SystemMonitorSnapshot => SYSTEM_SNAPSHOT,
    ),
    core.serve(
      BUS_PATTERNS.allCommands,
      capabilityCommandRequestSchema,
      (request: CapabilityCommandRequest, message): CommandAck => {
        const target = parseCommandSubject(message.subject);

        if (target === null) {
          throw new Error(`Not a command subject: ${message.subject}`);
        }

        commanded.push({
          entityId: target.entityId,
          capability: target.capability,
          command: typeof request.command['command'] === 'string' ? request.command['command'] : '',
        });

        return {
          entityId: target.entityId,
          capability: target.capability,
          acceptedAt: new Date(),
        };
      },
    ),
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
      busSubjects.service(HUB_SERVICE, HUB_DISCOVERED_METHOD),
      discoveredRequestSchema,
      (): DiscoveredReply => ({ items: [DISCOVERED_PRINTER, DISCOVERED_ACME] }),
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_DISCOVER_METHOD),
      discoverRequestSchema,
      (request: DiscoverRequest): DiscoverReply => {
        scanned.push(request.vendorId);

        return { vendors: [request.vendorId], lookingForMs: 24_000 };
      },
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_PROBE_METHOD),
      probeRequestSchema,
      (request: ProbeRequest): ProbeReply => {
        probed.push(request);

        const url = request.transportConfig['url'];

        if (url === 'mqtt://detected:1883') {
          return {
            isReachable: true,
            detail: 'Connected to mqtt://detected:1883',
            detected: { kind: 'bambu-lab/printer', model: 'P1S', modelChoices: ['P1S'] },
          };
        }

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
    mapTiles: testMapTiles(),
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
 * @param permissions - What it should carry, each everywhere.
 * @returns The bearer header value.
 */
export async function bearer(...permissions: string[]): Promise<string> {
  return scopedBearer(...permissions.map((key) => ({ key, scope: '*' })));
}

/**
 * Mints an access token whose grants may be narrowed to an area, an entity or a tag.
 *
 * @param grants - What it should carry, each with its scope.
 * @returns The bearer header value.
 */
export async function scopedBearer(
  ...grants: { readonly key: string; readonly scope: string }[]
): Promise<string> {
  return bearerFor('00000000-0000-4000-8000-000000000001', ...grants);
}

/**
 * Mints an access token for one particular user, for a test whose writes record who made them
 * against a real `auth.users` row.
 *
 * @param userId - Whose token it is.
 * @param grants - What it should carry, each with its scope.
 * @returns The bearer header value.
 */
export async function bearerFor(
  userId: string,
  ...grants: { readonly key: string; readonly scope: string }[]
): Promise<string> {
  const token = await signAccessToken(
    {
      userId,
      sessionId: '00000000-0000-4000-8000-000000000002',
      username: 'tester',
      role: 'owner',
      permissions: grants.map((grant) => ({ ...grant, effect: 'allow' })),
    },
    new TextEncoder().encode(ENVIRONMENT.API_JWT_SECRET),
  );

  return `Bearer ${token}`;
}
