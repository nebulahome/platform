/**
 * `pkg-mqtt`: the house's MQTT broker (PACKAGES.md 13).
 *
 * A system package, shipped in the image and never removed. It runs aedes on the house's network,
 * turns what devices announce through Home Assistant discovery - and what the owner maps by hand -
 * into devices of the house, and hands the platform its credentials: the hub's, which reaches
 * every topic, and one for each container that speaks MQTT, which reaches its own.
 *
 * Its page reads it through its methods: where it stands, the clients and who may connect, the
 * topics and their last messages, the mappings.
 */
import path from 'node:path';

import { z } from 'zod';

import type { EntityDomain, JsonValue } from '@nebula-home/contracts';
import { definePackage, type PackageContext, type PackageDevice } from '@nebula-home/package-sdk';

import { clientAccess, FULL_ACCESS } from './acl.js';
import { Broker } from './broker.js';
import { readAnnouncement } from './discovery.js';
import { House, type HouseDevice } from './house.js';
import { entityOfMapping, MappingStore, mappingSchema } from './mappings.js';
import { PLATFORM_PREFIX, PrincipalStore, USERNAME_PATTERN } from './principals.js';
import { TopicLog, textOfPayload } from './topics.js';

/** What the owner saved, with the defaults of `setup.json`. */
export const settingsSchema = z.object({
  port: z.coerce.number().int().min(1).max(65_535).default(1883),
  allowAnonymous: z.boolean().default(false),
  isDiscoveryEnabled: z.boolean().default(true),
  discoveryPrefix: z
    .string()
    .regex(/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/u)
    .default('homeassistant'),
});

/** What the package's settings are. */
export type Settings = z.output<typeof settingsSchema>;

/** How long a burst of announcements is let settle before the devices are synced. */
const SYNC_SETTLE_MS = 750;

/** How often the broker's own two readings are reported. */
const BROKER_REPORT_MS = 10_000;

/** The broker's own device, and its two readings. */
const BROKER_DEVICE = 'broker';

/** `svc.mqtt.credentials`: who asks. */
const credentialsRequestSchema = z.discriminatedUnion('principal', [
  z.object({ principal: z.literal('hub') }),
  z.object({
    principal: z.literal('container'),

    /** Whose container: `vendor:zigbee2mqtt`, `package:nvr`. */
    owner: z.string().regex(/^(vendor|package):[a-z][a-z0-9-]{1,63}$/u),

    /** The topics it may use; every topic when not said. */
    topics: z.array(z.string().min(1).max(256)).max(16).optional(),
  }),
]);

/**
 * The device the package syncs for one of the house's.
 *
 * @param device - As the house holds it.
 * @returns As the SDK takes it.
 */
function packageDeviceOf(device: HouseDevice): PackageDevice {
  return {
    externalId: device.externalId,
    name: device.name.slice(0, 128),
    ...(device.manufacturer === undefined ? {} : { manufacturer: device.manufacturer }),
    ...(device.model === undefined ? {} : { model: device.model }),
    ...(device.swVersion === undefined ? {} : { swVersion: device.swVersion }),
    entities: device.entities.map((entity) => ({
      domain: entity.domain,
      objectId: entity.objectId,
      name: entity.name,
      capabilities: entity.capabilities,
      ...(entity.unitOfMeasurement === undefined
        ? {}
        : { unitOfMeasurement: entity.unitOfMeasurement }),
      ...(entity.deviceClass === undefined ? {} : { deviceClass: entity.deviceClass }),
      ...(entity.stateClass === undefined ? {} : { stateClass: entity.stateClass }),
    })),
  };
}

/** The broker's own device. */
const BROKER_PACKAGE_DEVICE: PackageDevice = {
  externalId: BROKER_DEVICE,
  name: 'MQTT broker',
  manufacturer: 'NebulaHome',
  model: 'aedes',
  icon: 'router',
  entities: [
    {
      domain: 'sensor',
      objectId: 'broker_clients',
      name: 'MQTT clients online',
      capabilities: { sensor_numeric: {} },
      stateClass: 'measurement',
    },
    {
      domain: 'sensor',
      objectId: 'broker_messages',
      name: 'MQTT messages per second',
      capabilities: { sensor_numeric: {} },
      unitOfMeasurement: 'msg/s',
      stateClass: 'measurement',
      displayPrecision: 1,
    },
  ],
};

/**
 * Starts the broker and everything around it.
 *
 * @param ctx - What the SDK hands the package.
 * @returns What stops it.
 */
export async function startBroker(ctx: PackageContext): Promise<() => Promise<void>> {
  const settings = settingsSchema.parse(ctx.settings);
  const stateFile = path.join(ctx.dataDir, 'broker-state.sqlite');
  const principals = new PrincipalStore(stateFile);
  const mappings = new MappingStore(stateFile);
  const topics = new TopicLog();
  const startedAt = new Date().toISOString();
  let syncTimer: NodeJS.Timeout | undefined;

  /** Syncs the devices once the announcements have settled. */
  const scheduleSync = (): void => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      ctx.devices
        .sync([BROKER_PACKAGE_DEVICE, ...house.devices().map(packageDeviceOf)])
        .then(() => {
          reportBroker();
        })
        .catch((error: unknown) => {
          ctx.logger.warn({ err: error }, 'Could not sync the devices the broker hears');
        });
    }, SYNC_SETTLE_MS);
  };

  // The house is only told what the broker carries once it listens, by which time it is there.
  const broker = new Broker({
    port: settings.port,
    persistenceFile: path.join(ctx.dataDir, 'broker.sqlite'),
    principals,
    allowAnonymous: settings.allowAnonymous,

    /**
     * Hands one message on: to the explorer, then to discovery or the house.
     *
     * @param topic - Where.
     * @param payload - What.
     * @param isRetained - Whether it is kept.
     */
    onMessage: (topic, payload, isRetained): void => {
      topics.record(topic, payload, isRetained);

      const text = textOfPayload(payload);

      if (text === undefined) {
        return;
      }

      if (settings.isDiscoveryEnabled && topic.startsWith(`${settings.discoveryPrefix}/`)) {
        const reading = readAnnouncement(settings.discoveryPrefix, topic, text);

        switch (reading.kind) {
          case 'entity':
            house.put(reading.entity, topic, (other) => topics.lastText(other));

            return;
          case 'removed':
            house.remove(topic);

            return;
          case 'skipped':
            house.skip(reading.skipped);

            return;
          case 'ignored':
            break;
        }
      }

      house.hear(topic, text);
    },

    /** Reports the clients online again: one came or went. */
    onSessionsChanged: (): void => {
      reportBroker();
    },
  });

  const house = new House({
    /**
     * Reports one entity.
     *
     * @param entity - Which.
     * @param domain - Its domain.
     * @param state - Its state.
     * @param isAvailable - Whether its device is there.
     */
    report: (entity, domain: EntityDomain, state, isAvailable): void => {
      ctx.devices.report(ctx.entityId(domain, entity.objectId), state, { isAvailable });
    },

    /**
     * Publishes a command.
     *
     * @param topic - Where.
     * @param payload - What.
     */
    publish: (topic, payload): void => {
      broker.publish(topic, payload).catch((error: unknown) => {
        ctx.logger.warn({ err: error, topic }, 'Could not publish a command');
      });
    },
    changed: scheduleSync,
  });

  /** Reports the broker's two readings. */
  const reportBroker = (): void => {
    ctx.devices.report(ctx.entityId('sensor', 'broker_clients'), {
      sensor_numeric: { value: broker.sessions().length },
    });
    ctx.devices.report(ctx.entityId('sensor', 'broker_messages'), {
      sensor_numeric: { value: topics.rate() },
    });
  };

  /** Reads the owner's mappings into the house again. */
  const readMappings = (): void => {
    const kept = new Set<string>();

    for (const mapping of mappings.list()) {
      const entity = entityOfMapping(mapping);

      kept.add(entity.key);
      house.put(entity, undefined, (topic) => topics.lastText(topic));
    }

    house.retain('mapping', kept);
  };

  readMappings();

  await broker.start();
  scheduleSync();

  const reporting = setInterval(reportBroker, BROKER_REPORT_MS);

  ctx.logger.info(
    {
      port: settings.port,
      discovery: settings.isDiscoveryEnabled ? settings.discoveryPrefix : null,
    },
    'The MQTT broker is listening',
  );

  ctx.devices.onCommand((command) => {
    const [domain = '', objectId = ''] = command.entityId.split('.');
    const prefix = ctx.entityId(domain as EntityDomain, '').split('.')[1] ?? '';

    if (!objectId.startsWith(prefix)) {
      throw new Error(`${command.entityId} is not the broker's`);
    }

    house.command(objectId.slice(prefix.length), command.capability, command.command);
  });

  registerMethods(
    ctx,
    { settings, principals, mappings, topics, house, startedAt, readMappings },
    () => broker.sessions(),
  );

  ctx.services.provide('credentials', async (request): Promise<JsonValue> => {
    const asked = credentialsRequestSchema.parse(request);
    const credentials =
      asked.principal === 'hub'
        ? await principals.platformCredentials(
            `${PLATFORM_PREFIX}hub`,
            'hub',
            'The hub',
            FULL_ACCESS,
          )
        : await principals.platformCredentials(
            `${PLATFORM_PREFIX}${asked.owner.replace(':', '-')}`,
            'container',
            `The ${asked.owner.split(':')[1] ?? asked.owner} container`,
            asked.topics === undefined
              ? FULL_ACCESS
              : { publish: asked.topics, subscribe: asked.topics },
          );

    return { ...credentials, port: settings.port };
  });

  return async (): Promise<void> => {
    clearInterval(reporting);
    clearTimeout(syncTimer);
    await broker.stop();
    principals.close();
    mappings.close();
  };
}

/**
 * A value as JSON: what is undefined left out, as the bus would.
 *
 * @param value - The value.
 * @returns It, as JSON.
 */
function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** What the page's methods read. */
type MethodsContext = {
  readonly settings: Settings;
  readonly principals: PrincipalStore;
  readonly mappings: MappingStore;
  readonly topics: TopicLog;
  readonly house: House;
  readonly startedAt: string;
  readonly readMappings: () => void;
};

/**
 * Registers the methods the page and the card call.
 *
 * @param ctx - What the SDK hands the package.
 * @param parts - What they read.
 * @param sessions - The clients connected now.
 */
function registerMethods(
  ctx: PackageContext,
  parts: MethodsContext,
  sessions: () => ReturnType<Broker['sessions']>,
): void {
  const { settings, principals, mappings, topics, house, startedAt, readMappings } = parts;

  ctx.rpc.method('status', { access: 'read' }, () => ({
    port: settings.port,
    allowAnonymous: settings.allowAnonymous,
    clientsOnline: sessions().length,
    messagesPerSecond: topics.rate(),
    startedAt,
    discovery: {
      isEnabled: settings.isDiscoveryEnabled,
      prefix: settings.discoveryPrefix,
      ...house.counts(),
      skipped: house.skipped().slice(-50),
    },
  }));

  ctx.rpc.method('clients', { access: 'read' }, () => {
    const connected = sessions();

    return {
      principals: principals.list().map((principal) => ({
        username: principal.username,
        kind: principal.kind,
        label: principal.label,
        publish: [...principal.access.publish],
        subscribe: [...principal.access.subscribe],
        createdAt: principal.createdAt,
        sessions: connected
          .filter((session) => session.username === principal.username)
          .map((session) => ({ ...session })),
      })),
      anonymous: connected
        .filter((session) => session.username === null)
        .map((session) => ({ ...session })),
    };
  });

  ctx.rpc.method(
    'addClient',
    {
      access: 'configure',
      input: z.object({
        username: z.string().regex(USERNAME_PATTERN),
        label: z.string().trim().max(64).default(''),
        access: z.enum(['prefix', 'all']).default('prefix'),
      }),
    },
    async (input) => ({
      username: input.username,
      password: await principals.addClient(
        input.username,
        input.label === '' ? input.username : input.label,
        clientAccess(input.username, input.access, settings.discoveryPrefix),
      ),
    }),
  );

  ctx.rpc.method(
    'removeClient',
    { access: 'configure', input: z.object({ username: z.string().min(1).max(64) }) },
    (input) => ({ isRemoved: principals.removeClient(input.username) }),
  );

  ctx.rpc.method(
    'topics',
    {
      access: 'read',
      input: z
        .object({
          prefix: z.string().max(256).default(''),
          limit: z.int().min(1).max(2000).default(500),
        })
        .nullable()
        .transform((value) => value ?? { prefix: '', limit: 500 }),
    },
    (input) => {
      const listed = topics.list(input.prefix, input.limit);

      return { items: listed.items.map((entry) => ({ ...entry })), total: listed.total };
    },
  );

  ctx.rpc.method('mappings', { access: 'read' }, () => asJson(mappings.list()));

  ctx.rpc.method('saveMapping', { access: 'configure', input: mappingSchema }, (input) => {
    const saved = mappings.save(input);

    readMappings();

    return asJson(saved);
  });

  ctx.rpc.method(
    'removeMapping',
    { access: 'configure', input: z.object({ id: z.string().min(1).max(64) }) },
    (input) => {
      const isRemoved = mappings.remove(input.id);

      readMappings();

      return { isRemoved };
    },
  );
}

// The runner loads the entry's default export (PACKAGES.md 4).
// eslint-disable-next-line import-x/no-default-export
export default definePackage({
  /**
   * Starts the broker.
   *
   * @param ctx - What the SDK hands the package.
   * @returns What stops it.
   */
  start: async (ctx) => startBroker(ctx),
});
