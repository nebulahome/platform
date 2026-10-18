/**
 * The real server around a stub database and a hub that answers on a bus in memory.
 *
 * The database is a stub that rejects everything - or, when asked, one with nothing in it -
 * which is exactly right for what the route tests assert: a configuration is checked against
 * the bundle before a row is touched, a probe never touches one at all, and the catalogue comes
 * from the hub. What the hub is given and what comes back from it is the whole of the interest.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { BusClient } from '@nebulahome/bus';
import { FakeTransport } from '@nebulahome/bus/testing';
import {
  applySceneRequestSchema,
  capabilityStateSchema,
  commandNameOf,
  commandsForTargetState,
  cancelAutomationTestRequestSchema,
  CORE_APPLY_SCENE_METHOD,
  CORE_CANCEL_AUTOMATION_TEST_METHOD,
  CORE_REMOVE_AUTOMATION_METHOD,
  CORE_SYNC_AUTOMATION_METHOD,
  CORE_SYNC_HOUSE_METHOD,
  CORE_TEST_AUTOMATION_BLOCK_METHOD,
  CORE_TRIGGER_AUTOMATION_METHOD,
  removeAutomationRequestSchema,
  syncAutomationRequestSchema,
  syncHouseRequestSchema,
  testAutomationBlockRequestSchema,
  triggerAutomationRequestSchema,
  type ApplySceneReply,
  type ApplySceneRequest,
  type AutomationTestReply,
  type CancelAutomationTestReply,
  type RemoveAutomationReply,
  type SyncAutomationReply,
  type SyncHouseReply,
  type TestAutomationBlockRequest,
  type TriggerAutomationReply,
  accountBeginRequestSchema,
  accountSignOutRequestSchema,
  HUB_ACCOUNT_BEGIN_METHOD,
  HUB_ACCOUNT_SIGN_OUT_METHOD,
  type AccountStep,
  BACKUP_METHODS,
  BACKUP_SERVICE,
  backupBrowseRequestSchema,
  backupEmptyRequestSchema,
  backupRunRequestSchema,
  BUS_PATTERNS,
  busSubjects,
  HUB_MATTER_COMMISSION_METHOD,
  HUB_MATTER_NODES_METHOD,
  HUB_MATTER_REMOVE_METHOD,
  HUB_MATTER_RESTORE_METHOD,
  HUB_MATTER_STATUS_METHOD,
  matterCommissionRequestSchema,
  matterNodesRequestSchema,
  matterRemoveRequestSchema,
  matterRestoreRequestSchema,
  matterStatusRequestSchema,
  type MatterCommissioning,
  type MatterNode,
  type MatterStatus,
  capabilityCommandRequestSchema,
  catalogueRequestSchema,
  CORE_REMOVE_ALIAS_METHOD,
  CORE_SERVICE,
  CORE_SYNC_ALIAS_METHOD,
  CORE_SYSTEM_MONITOR_METHOD,
  CORE_UNREGISTER_METHOD,
  ConflictError,
  containerControlRequestSchema,
  containerRemoveRequestSchema,
  discoveredDeviceSchema,
  discoveredRequestSchema,
  discoverRequestSchema,
  entityImageRequestSchema,
  forgetRequestSchema,
  parseCommandSubject,
  removeAliasRequestSchema,
  syncAliasRequestSchema,
  HUB_CATALOGUE_METHOD,
  HUB_DISCOVER_METHOD,
  HUB_DISCOVERED_METHOD,
  HUB_ENTITY_IMAGE_METHOD,
  HUB_FORGET_METHOD,
  HUB_PROBE_METHOD,
  HUB_RELOAD_METHOD,
  HUB_SERVICE,
  managedRequestSchema,
  NotFoundError,
  probeRequestSchema,
  SUPERVISOR_METHODS,
  SUPERVISOR_SERVICE,
  supervisorEmptyRequestSchema,
  reloadRequestSchema,
  systemMonitorRequestSchema,
  unregisterDeviceRequestSchema,
  type CapabilityCommandRequest,
  type CatalogueReply,
  type CommandAck,
  type ContainerListReply,
  type ContainerSummary,
  type ManagedReply,
  type DiscoveredDevice,
  type DiscoveredReply,
  type DiscoverReply,
  type DiscoverRequest,
  type EntityImageReply,
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
  type BackupStatus,
} from '@nebulahome/contracts';
import { schema, secretsKeyFrom } from '@nebulahome/db';
import { createLogger } from '@nebulahome/logging';

import { Authenticator } from '../auth/authenticator.js';
import { ChallengeStore } from '../auth/challenges.js';
import { signAccessToken } from '../auth/tokens.js';
import { apiEnvSchema } from '../config.js';
import type { ApiContext } from '../context.js';
import { IdempotencyStore } from '../http/idempotency.js';
import { buildServer } from '../server.js';
import { AuditLog } from '../services/audit.js';
import { EventFanout } from '../services/events.js';
import { MaintenanceMonitor } from '../services/maintenance.js';

import { testIcons } from './icons.js';
import { testMapTiles } from './map-tiles.js';
import { servePacketManagerFake } from './packet-manager-fake.js';

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
  failures: [],
  vendors: [
    {
      id: 'bambu-lab',
      version: '1.0.0',
      origin: 'development',
      install: null,
      hasCode: false,
      name: 'Bambu Lab',
      logoPadding: 0,
      internetRequired: false,
      transports: ['mqtt'],
      wires: ['mqtt'],
      discoverySources: [],
      adoption: 'owner',
      pairing: null,
      listener: null,
      passedOver: [],
      requires: { packages: {}, services: [] },
      packageProblems: [],
      account: null,
      containers: [],
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
      origin: 'development',
      install: null,
      hasCode: false,
      name: 'ACME',
      logoPadding: 0,
      internetRequired: true,
      transports: ['mqtt'],
      wires: ['mqtt'],
      discoverySources: [],
      adoption: 'owner',
      pairing: null,
      listener: null,
      passedOver: [],
      requires: { packages: {}, services: [] },
      packageProblems: [],
      account: null,
      containers: [],
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
    {
      id: 'cloudy',
      version: '1.0.0',
      origin: 'development',
      install: null,
      hasCode: true,
      name: 'Cloudy',
      logoPadding: 0,
      internetRequired: true,
      transports: ['cloudy/cloud'],
      wires: ['http'],
      discoverySources: ['module'],
      adoption: 'automatic',
      pairing: null,
      listener: null,
      passedOver: [],
      requires: { packages: {}, services: [] },
      packageProblems: [],
      account: {
        name: 'Cloudy account',
        fields: {
          constants: {},
          fields: [
            { key: 'email', type: 'text', label: 'Email', isRequired: true, maxLength: 256 },
            {
              key: 'password',
              type: 'secret',
              label: 'Password',
              isRequired: true,
              maxLength: 256,
            },
          ],
        },
        identity: 'email',
      },
      containers: [],
      setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
      drivers: [
        {
          id: 'cloudy/robot',
          vendorId: 'cloudy',
          driverId: 'robot',
          name: 'Robot',
          transport: 'cloudy/cloud',
          models: [],
          setup: {
            transport: { constants: {}, fields: [] },
            options: { constants: {}, fields: [] },
          },
        },
      ],
    },
    {
      id: 'relay',
      version: '1.0.0',
      origin: 'development',
      install: null,
      hasCode: false,
      name: 'Relay',
      logoPadding: 0,
      internetRequired: false,
      transports: ['mqtt'],
      wires: ['mqtt'],
      discoverySources: [],
      adoption: 'owner',
      pairing: null,
      listener: null,
      passedOver: [],
      requires: { packages: { mqtt: '^1.0.0' }, services: [] },
      packageProblems: ['Relay needs the MQTT package, which is not running'],
      account: null,
      containers: [],
      setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
      drivers: [
        {
          id: 'relay/switch',
          vendorId: 'relay',
          driverId: 'switch',
          name: 'Switch',
          transport: 'mqtt',
          models: [],
          setup: {
            transport: { constants: {}, fields: [] },
            options: { constants: {}, fields: [] },
          },
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

/**
 * A database whose queries answer in turn: the first awaited query with the first set of rows,
 * the second with the second, and every one after with none.
 *
 * @param answers - The rows of each query, in order.
 * @returns Something the service layer can call as a database.
 */
export function databaseAnswering(...answers: readonly (readonly unknown[])[]): ApiContext['db'] {
  let asked = 0;
  const chain: unknown = new Proxy(() => chain, {
    /**
     * Answers every property with the chain, and `then` with the next set of rows.
     *
     * @param target - Ignored.
     * @param key - The property asked for.
     * @returns The chain, or a `then` that resolves to the rows.
     */
    get: (target, key): unknown =>
      key === 'then'
        ? (resolve: (rows: readonly unknown[]) => void): void => {
            const rows = answers[asked] ?? [];

            asked += 1;
            resolve(rows);
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

/** The picture the fake hub holds, for `image.hall_map`. */
export const HALL_MAP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>';

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

/** What the fake hub was asked to sign in with, in order. */
export const accountRequests: { method: string; payload: unknown }[] = [];

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

/** What the fake `core` was asked about automations, in order: `sync:<id>`, `remove:<id>`. */
export const automationsSynced: string[] = [];

/** What the fake `core` was asked to run, in order. */
export const automationsTriggered: { automationId: string; userId: string | undefined }[] = [];

/** What the fake `core` was asked to apply, in order. */
export const scenesApplied: ApplySceneRequest[] = [];

/** The blocks the fake `core` was asked to test, in order. */
export const blocksTested: TestAutomationBlockRequest[] = [];

/** The tests the fake `core` was asked to stop, in order. */
export const testsCancelled: string[] = [];

/** How many times the fake `core` was asked to read the house again. */
export const houseSyncs: { count: number } = { count: 0 };

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

/** What the fake backup service was asked to start, in order. */
export const backupRequests: { method: string; payload: unknown }[] = [];

/** The maintenance state of the last server built, to put it into a restore. */
export let lastMaintenance: MaintenanceMonitor | null = null;

/** What the fake backup service answers for its state. */
export const BACKUP_STATUS: BackupStatus = {
  isEnabled: true,
  schedule: { mode: 'quietest', time: '03:45', timezone: 'Europe/Rome', nextRunAt: null },
  quietTime: {
    state: 'ready',
    time: '03:45',
    meanLoadPercent: 4.2,
    daysOfData: 14,
    daysNeeded: 3,
    profile: [],
    reason: null,
  },
  estimates: null,
  lastBackup: null,
  active: null,
  key: { keyId: 'ab'.repeat(16), source: 'file', createdAt: new Date('2026-09-27T00:00:00Z') },
  capabilities: { canMount: true, mountProblem: null },
  problems: [],
  maintenance: {
    state: 'normal',
    runId: null,
    phase: null,
    percent: null,
    outcome: null,
    message: null,
    tokensInvalidBefore: null,
  },
  canRestore: true,
};

/** Stops the fake hub the last server was built around. */
export function stopHub(): void {
  stopCurrentHub();
}

/**
 * One container, as the fake supervisor lists it.
 *
 * @param name - Its name.
 * @param fields - What differs from a plain running container.
 * @returns The container.
 */
function container(name: string, fields: Partial<ContainerSummary> = {}): ContainerSummary {
  return {
    id: name.padEnd(64, '0').replaceAll(/[^0-9a-f]/g, 'a'),
    name,
    displayName: name,
    deviceId: `container-${name}`,
    image: `example/${name}:1.0.0`,
    version: '1.0.0',
    state: 'running',
    status: 'Up 2 hours',
    health: null,
    createdAt: new Date('2026-09-20T10:00:00Z'),
    startedAt: new Date('2026-09-27T08:00:00Z'),
    isSelf: false,
    isSystem: false,
    managedBy: null,
    compose: null,
    registryUrl: `https://hub.docker.com/r/example/${name}`,
    cpuPercent: 1.5,
    memoryUsedBytes: 64_000_000,
    memoryLimitBytes: 8_000_000_000,
    update: {
      installedVersion: '1.0.0',
      latestVersion: '1.0.0',
      isAvailable: false,
      checkedAt: null,
      error: null,
      isInstalling: false,
      progress: null,
    },
    refusal: null,
    ...fields,
  };
}

/** What the fake supervisor lists: the platform's own, one an integration runs, one plain. */
export const CONTAINERS: ContainerListReply = {
  docker: {
    isAvailable: true,
    version: '28.1.1',
    apiVersion: '1.47',
    reason: null,
    platformNetwork: 'bridge',
    composeVersion: '2.39.1',
  },
  containers: [
    container('nebulahome', { isSelf: true, isSystem: true, deviceId: null, refusal: 'self' }),
    container('nebulahome-zigbee2mqtt', {
      managedBy: {
        ownerKind: 'vendor',
        vendorId: 'zigbee2mqtt',
        dependencyId: 'zigbee2mqtt',
        isReleased: false,
      },
      refusal: 'managed',
    }),
    container('adguard'),
  ],
  installs: [],
  composeOperations: [],
};

/** What the fake hub's Matter broker was asked, as `method payload`. */
export const matterRequests: string[] = [];

/** The fake hub's one Matter node: a lamp not added to the house. */
export const MATTER_LAMP: MatterNode = {
  nodeId: '7',
  isAvailable: true,
  devices: [
    {
      identity: {
        nodeId: '7',
        endpoint: null,
        vendorId: 4107,
        productId: 7,
        vendorName: 'Signify',
        productName: 'Hue color lamp',
        productLabel: null,
        nodeLabel: 'Kitchen',
        serialNumber: null,
        uniqueId: null,
        hardwareVersion: null,
        hardwareVersionString: null,
        softwareVersion: 123,
        softwareVersionString: '1.2.3',
        macAddresses: [],
        deviceTypes: [22, 269],
        clusters: [6, 8, 768],
        isBridge: false,
        isBridged: false,
      },
      mappedClusters: [6, 8, 768],
      unmappedClusters: [],
      deviceId: null,
      kind: null,
      claimedBy: [],
      isRemoved: true,
    },
  ],
};

/** The containers the fake supervisor was asked to control, as `name:action`. */
export const controlled: string[] = [];

/** The containers the fake supervisor was asked to remove, as `name:removeVolumes`. */
export const removed: string[] = [];

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
  const backup = new BusClient({ transport, source: 'backup', logger, requestTimeoutMs: 500 });
  const supervisor = new BusClient({
    transport,
    source: 'supervisor',
    logger,
    requestTimeoutMs: 500,
  });

  controlled.length = 0;
  removed.length = 0;

  backupRequests.length = 0;

  const subscriptions = [
    ...servePacketManagerFake(
      new BusClient({ transport, source: 'packet-manager', logger, requestTimeoutMs: 500 }),
      new BusClient({ transport, source: 'mqtt', logger, requestTimeoutMs: 500 }),
    ),
    supervisor.serve(
      busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.list),
      supervisorEmptyRequestSchema,
      (): ContainerListReply => CONTAINERS,
    ),
    supervisor.serve(
      busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.control),
      containerControlRequestSchema,
      (request): ContainerSummary => {
        const found =
          CONTAINERS.containers.find((each) => each.name === request.name) ??
          container(request.name);

        if (found.refusal !== null) {
          throw new ConflictError(`${request.name} is not controlled from here`, {
            details: { name: request.name, reason: found.refusal },
          });
        }

        controlled.push(`${request.name}:${request.action}`);

        return { ...found, state: 'exited' };
      },
    ),
    supervisor.serve(
      busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.remove),
      containerRemoveRequestSchema,
      (request): { ok: true } => {
        const found = CONTAINERS.containers.find((each) => each.name === request.name);

        if (found !== undefined && found.refusal !== null) {
          throw new ConflictError(`${request.name} is not removed from here`, {
            details: { name: request.name, reason: found.refusal },
          });
        }

        removed.push(`${request.name}:${String(request.removeVolumes)}`);

        return { ok: true };
      },
    ),
    supervisor.serve(
      busSubjects.service(SUPERVISOR_SERVICE, SUPERVISOR_METHODS.managed),
      managedRequestSchema,
      (): ManagedReply => ({ containers: [] }),
    ),
    backup.serve(
      busSubjects.service(BACKUP_SERVICE, BACKUP_METHODS.status),
      backupEmptyRequestSchema,
      (): BackupStatus => BACKUP_STATUS,
    ),
    backup.serve(
      busSubjects.service(BACKUP_SERVICE, BACKUP_METHODS.run),
      backupRunRequestSchema,
      (request: unknown): { runId: string } => {
        backupRequests.push({ method: 'run', payload: request });

        return { runId: '11111111-1111-4111-8111-111111111111' };
      },
    ),
    backup.serve(
      busSubjects.service(BACKUP_SERVICE, BACKUP_METHODS.browse),
      backupBrowseRequestSchema,
      (request: { path?: string | undefined }) => {
        backupRequests.push({ method: 'browse', payload: request });

        return {
          path: request.path ?? '/',
          parent: request.path === undefined ? null : '/',
          directories: ['usb'],
          isTruncated: false,
          isWritable: true,
        };
      },
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_ENTITY_IMAGE_METHOD),
      entityImageRequestSchema,
      (request): EntityImageReply => {
        if (request.entityId !== 'image.hall_map') {
          throw new NotFoundError('Nothing has been drawn for that entity yet');
        }

        return {
          contentType: 'image/svg+xml',
          revision: 'a1b2c3d4',
          data: Buffer.from(HALL_MAP_SVG).toString('base64'),
        };
      },
    ),
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
      busSubjects.service(CORE_SERVICE, CORE_SYNC_AUTOMATION_METHOD),
      syncAutomationRequestSchema,
      (request): SyncAutomationReply => {
        automationsSynced.push(`sync:${request.automationId}`);

        return { isLoaded: true, problems: [] };
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_REMOVE_AUTOMATION_METHOD),
      removeAutomationRequestSchema,
      (request): RemoveAutomationReply => {
        automationsSynced.push(`remove:${request.automationId}`);

        return { automationId: request.automationId };
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_TRIGGER_AUTOMATION_METHOD),
      triggerAutomationRequestSchema,
      (request): TriggerAutomationReply => {
        automationsTriggered.push({ automationId: request.automationId, userId: request.userId });

        return { runId: '0190f5a1-0000-7000-8000-000000000001', outcome: 'started' };
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_TEST_AUTOMATION_BLOCK_METHOD),
      testAutomationBlockRequestSchema,
      (request): AutomationTestReply => {
        blocksTested.push(request);

        switch (request.target.kind) {
          case 'action': {
            return { kind: 'action', result: 'ok', durationMs: 5, steps: [] };
          }
          case 'condition': {
            return { kind: 'condition', value: true, steps: [] };
          }
          case 'trigger': {
            return { kind: 'trigger', matches: null, nextAt: null, detail: 'Fires at its moment' };
          }
        }
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_CANCEL_AUTOMATION_TEST_METHOD),
      cancelAutomationTestRequestSchema,
      (request): CancelAutomationTestReply => {
        testsCancelled.push(request.testId);

        return { wasRunning: false };
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_SYNC_HOUSE_METHOD),
      syncHouseRequestSchema,
      (): SyncHouseReply => {
        houseSyncs.count += 1;

        return { timeZone: 'UTC', hasPosition: false };
      },
    ),
    core.serve(
      busSubjects.service(CORE_SERVICE, CORE_APPLY_SCENE_METHOD),
      applySceneRequestSchema,

      // Applies as `core` would: the members it was not told to skip get the commands their
      // targets produce, recorded in `commanded` as the command subject would have.
      async (request): Promise<ApplySceneReply> => {
        scenesApplied.push(request);

        const rows =
          database === undefined
            ? []
            : await database
                .select({
                  entityId: schema.registry.entities.entityId,
                  targetState: schema.registry.sceneEntities.targetState,
                })
                .from(schema.registry.sceneEntities)
                .innerJoin(
                  schema.registry.entities,
                  eq(schema.registry.entities.id, schema.registry.sceneEntities.entityId),
                )
                .where(eq(schema.registry.sceneEntities.sceneId, request.sceneId));
        const skipped = new Map(
          request.skip.map((entry) => [String(entry.entityId), entry.reason]),
        );
        const members = rows.map((row) => {
          const reason = skipped.get(row.entityId);

          if (reason !== undefined) {
            return { entityId: row.entityId, ok: false, error: reason, sent: [] };
          }

          const sent = commandsForTargetState(capabilityStateSchema.parse(row.targetState), 0);

          for (const entry of sent) {
            commanded.push({
              entityId: row.entityId,
              capability: entry.capability,
              command: commandNameOf(entry.command),
            });
          }

          return { entityId: row.entityId, ok: true, error: null, sent };
        });
        const applied = members.filter((member) => member.ok).length;

        return {
          sceneId: request.sceneId,
          applied,
          failed: members.length - applied,
          members: members as ApplySceneReply['members'],
        };
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
      busSubjects.service(HUB_SERVICE, HUB_ACCOUNT_BEGIN_METHOD),
      accountBeginRequestSchema,
      (request): AccountStep => {
        accountRequests.push({ method: HUB_ACCOUNT_BEGIN_METHOD, payload: request });

        return {
          kind: 'ask',
          flowId: '8f0e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
          message: 'Cloudy emailed a code',
          fields: [{ key: 'code', type: 'text', label: 'Code', isRequired: true, maxLength: 16 }],
        };
      },
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_ACCOUNT_SIGN_OUT_METHOD),
      accountSignOutRequestSchema,
      (request): { wasSignedIn: boolean } => {
        accountRequests.push({ method: HUB_ACCOUNT_SIGN_OUT_METHOD, payload: request });

        return { wasSignedIn: true };
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
      busSubjects.service(HUB_SERVICE, HUB_MATTER_STATUS_METHOD),
      matterStatusRequestSchema,
      (): MatterStatus => ({
        state: 'running',
        error: null,
        fabricId: 'abc',
        isLanReachable: true,
        nodes: { total: 1, online: 1 },
        commissioning: null,
      }),
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_NODES_METHOD),
      matterNodesRequestSchema,
      () => ({ items: [MATTER_LAMP] }),
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_COMMISSION_METHOD),
      matterCommissionRequestSchema,
      (request): MatterCommissioning => {
        matterRequests.push(`commission ${request.code}`);

        return {
          id: 'job-1',
          state: 'running',
          startedAt: new Date('2026-10-18T10:00:00Z'),
          finishedAt: null,
          nodeId: null,
          error: null,
        };
      },
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_REMOVE_METHOD),
      matterRemoveRequestSchema,
      (request) => {
        matterRequests.push(`remove ${request.nodeId}`);

        return { isRemoved: true };
      },
    ),
    hub.serve(
      busSubjects.service(HUB_SERVICE, HUB_MATTER_RESTORE_METHOD),
      matterRestoreRequestSchema,
      (request) => {
        matterRequests.push(`restore ${request.nodeId}:${String(request.endpoint)}`);

        return { isRestored: true };
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

  const authenticator = new Authenticator({ db, secret });
  const maintenance = new MaintenanceMonitor({ authenticator, logger });

  lastMaintenance = maintenance;

  const context: ApiContext = {
    config,
    db,
    bus: isBusUp
      ? new BusClient({ transport, source: 'api', logger, requestTimeoutMs: 500 })
      : undefined,
    logger,
    authenticator,
    maintenance,
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
