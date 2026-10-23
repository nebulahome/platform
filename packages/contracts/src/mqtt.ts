/**
 * The house's MQTT broker, as the hub runs it and the Brokers page shows it.
 *
 * MQTT is one of the platform's brokers: the hub listens on the house's network - port 1883 - and
 * every MQTT device and program of the house meets on it. Who may connect is the broker's to say:
 * the hub, a container the platform runs (Zigbee2MQTT), and each client the owner adds, held to
 * the topics it was given.
 *
 * What it carries becomes devices of the house two ways. A device that announces itself - the
 * MQTT discovery convention most firmware speaks, a retained JSON document on
 * `<prefix>/<component>/[<node>/]<object>/config` - is added at once, and so is one the owner
 * maps by hand from the topic it publishes on. Each is a device of the integration whose
 * `discovery.json` recognises it from {@link mqttIdentitySchema}, or of the platform's own `mqtt`
 * vendor when none does.
 */
import { z } from 'zod';

import { BROKER_STATES } from './brokers.js';
import { integrationIdSchema, integrationKindIdSchema, VENDOR_ID_PATTERN } from './integrations.js';
import { timestampSchema } from './timestamp.js';

/** The platform transport every device the broker hears is reached through. */
export const MQTT_HOUSE_TRANSPORT = 'mqtt-house';

/** The platform's own vendor: the devices the broker hears that no integration claims. */
export const MQTT_VENDOR = 'mqtt';

/** The driver of the platform's own vendor, which maps any announced or mapped device. */
export const MQTT_GENERIC_KIND = `${MQTT_VENDOR}/generic`;

/** The TCP port the broker listens on unless told otherwise. */
export const MQTT_PORT = 1883;

/** Where the broker stands. */
export const HUB_MQTT_STATUS_METHOD = 'mqtt_status';

/** The devices the broker hears, with the device each is in the house. */
export const HUB_MQTT_DEVICES_METHOD = 'mqtt_devices';

/** Brings back a device removed from the house that the broker still hears. */
export const HUB_MQTT_RESTORE_METHOD = 'mqtt_restore';

/** Saves the owner's settings of the broker, which starts it again. */
export const HUB_MQTT_SETTINGS_METHOD = 'mqtt_settings';

/** Stops the broker and starts it again. */
export const HUB_MQTT_RESTART_METHOD = 'mqtt_restart';

/** Who may connect, and who is connected. */
export const HUB_MQTT_CLIENTS_METHOD = 'mqtt_clients';

/** Adds a client, whose password is answered once. */
export const HUB_MQTT_CLIENT_ADD_METHOD = 'mqtt_client_add';

/** Removes a client, and closes its connections. */
export const HUB_MQTT_CLIENT_REMOVE_METHOD = 'mqtt_client_remove';

/** The last message of every topic. */
export const HUB_MQTT_TOPICS_METHOD = 'mqtt_topics';

/** The owner's mappings. */
export const HUB_MQTT_MAPPINGS_METHOD = 'mqtt_mappings';

/** Saves a mapping, new or changed. */
export const HUB_MQTT_MAPPING_SAVE_METHOD = 'mqtt_mapping_save';

/** Removes a mapping. */
export const HUB_MQTT_MAPPING_REMOVE_METHOD = 'mqtt_mapping_remove';

/** A username for a container the platform runs, which only the supervisor may ask for. */
export const HUB_MQTT_CREDENTIALS_METHOD = 'mqtt_credentials';

/** The components of an announcement the broker turns into entities. */
export const MQTT_COMPONENTS = [
  'sensor',
  'binary_sensor',
  'switch',
  'light',
  'cover',
  'button',
  'number',
  'select',
  'lock',
] as const;

/** A component the broker turns into entities. */
export type MqttComponent = (typeof MQTT_COMPONENTS)[number];

/** What the owner maps by hand: a sensor, a binary sensor or a switch. */
export const MQTT_MAPPING_COMPONENTS = ['sensor', 'binary_sensor', 'switch'] as const;

/** How many items a list in an identity holds at most. */
const MAXIMUM_LIST = 64;

/** The owner's settings of the broker. */
export const mqttSettingsSchema = z.object({
  /** Whether a client may connect without a username. */
  allowAnonymous: z.boolean().default(false),

  /** Whether devices that announce themselves are added. */
  isDiscoveryEnabled: z.boolean().default(true),

  /** The topic announcements are published under: what the devices' firmware uses. */
  discoveryPrefix: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u, 'Topic levels of letters, digits, - and _')
    .default('homeassistant'),
});

/** The owner's settings of the broker. */
export type MqttSettings = z.output<typeof mqttSettingsSchema>;

/** Where a device the broker hears comes from. */
export const MQTT_DEVICE_SOURCES = ['announced', 'mapped', 'broker'] as const;

/**
 * Who a device the broker hears says it is: what an integration's rules match and the Brokers
 * page shows.
 *
 * What an announcement's `device` and `origin` blocks say, each field null when it does not say
 * it. `deviceKey` is the device's own identifier - its first identifier, or its first connection
 * - which is also its external id.
 */
export const mqttIdentitySchema = z.object({
  deviceKey: z.string().min(1).max(256),
  source: z.enum(MQTT_DEVICE_SOURCES),
  name: z.string().max(256),
  manufacturer: z.string().max(256).nullable(),
  model: z.string().max(256).nullable(),
  modelId: z.string().max(256).nullable(),
  swVersion: z.string().max(256).nullable(),
  hwVersion: z.string().max(256).nullable(),
  serialNumber: z.string().max(256).nullable(),

  /** Every identifier it announces. */
  identifiers: z.array(z.string().max(256)).max(MAXIMUM_LIST),

  /** The hardware addresses among its connections, lower-case and colon-separated. */
  macAddresses: z.array(z.string().max(64)).max(MAXIMUM_LIST),

  /** The device it is reached through, by that device's identifier. */
  viaDevice: z.string().max(256).nullable(),

  /** The firmware or program that announced it - `Tasmota`, `Zigbee2MQTT` - and its version. */
  originName: z.string().max(256).nullable(),
  originSwVersion: z.string().max(256).nullable(),

  /** The components its entities are, each once. */
  components: z.array(z.enum(MQTT_COMPONENTS)).max(MQTT_COMPONENTS.length),
});

/** Who a device the broker hears says it is. */
export type MqttIdentity = z.output<typeof mqttIdentitySchema>;

/** An announcement the broker did not take, and why. */
export const mqttSkippedSchema = z.object({
  topic: z.string().max(512),
  reason: z.string().max(512),
});

/** Where the broker stands, as the Brokers page shows it. */
export const mqttStatusSchema = z.object({
  state: z.enum(BROKER_STATES),

  /** Why it failed, in a sentence; null while it runs. */
  error: z.string().max(2048).nullable(),

  /** The TCP port it listens on, or is to. */
  port: z.int().min(0).max(65_535),

  /** When it last started listening; null while it is not. */
  startedAt: timestampSchema.nullable(),

  settings: mqttSettingsSchema,

  clientsOnline: z.int().min(0),
  messagesPerSecond: z.number().min(0),

  /** What it makes of what it carries: the entities announced and mapped, and their devices. */
  discovery: z.object({
    announced: z.int().min(0),
    mapped: z.int().min(0),
    devices: z.int().min(0),

    /** The latest announcements it did not take, the newest last. */
    skipped: z.array(mqttSkippedSchema).max(50),
  }),
});

/** Where the broker stands. */
export type MqttStatus = z.output<typeof mqttStatusSchema>;

/** One device the broker hears, with the device it is in the house. */
export const mqttDeviceSchema = z.object({
  identity: mqttIdentitySchema,

  /** How many entities it has. */
  entityCount: z.int().min(0),

  /** The device added for it; null while it is not, or after it was removed from the house. */
  deviceId: integrationIdSchema.nullable(),

  /** The driver it was added as; null while it is not added. */
  kind: integrationKindIdSchema.nullable(),

  /**
   * The integrations whose rules all take it. One is the integration it belongs to; several, and
   * it is added as the platform's own and the page says who else wants it.
   */
  claimedBy: z.array(z.string().regex(VENDOR_ID_PATTERN)).max(16),

  /** Removed from the house while the broker still hears it: the page offers it back. */
  isRemoved: z.boolean(),
});

/** One device the broker hears. */
export type MqttDevice = z.output<typeof mqttDeviceSchema>;

/** The devices the broker hears, by name. */
export const mqttDevicesReplySchema = z.object({ items: z.array(mqttDeviceSchema) });

/** Brings back a device removed from the house. */
export const mqttRestoreRequestSchema = z.object({ deviceKey: z.string().min(1).max(256) });

/** Whether it was removed, and is now offered to be added again. */
export const mqttRestoreReplySchema = z.object({ isRestored: z.boolean() });

/** Who a username is: the hub, a container the platform runs, or a client the owner added. */
export const MQTT_PRINCIPAL_KINDS = ['hub', 'container', 'client'] as const;

/** One connection to the broker. */
export const mqttSessionSchema = z.object({
  clientId: z.string().max(256),
  username: z.string().max(64).nullable(),
  address: z.string().max(256).nullable(),
  connectedAt: timestampSchema,
});

/** One connection to the broker. */
export type MqttSession = z.output<typeof mqttSessionSchema>;

/** One username, what it may reach, and its connections now. */
export const mqttPrincipalSchema = z.object({
  username: z.string().max(64),
  kind: z.enum(MQTT_PRINCIPAL_KINDS),
  label: z.string().max(128),
  publish: z.array(z.string().max(256)).max(32),
  subscribe: z.array(z.string().max(256)).max(32),
  createdAt: timestampSchema,
  sessions: z.array(mqttSessionSchema),
});

/** One username. */
export type MqttPrincipal = z.output<typeof mqttPrincipalSchema>;

/** Who may connect, and who is connected without a username. */
export const mqttClientsReplySchema = z.object({
  items: z.array(mqttPrincipalSchema),
  anonymous: z.array(mqttSessionSchema),
});

/** The usernames the platform keeps for itself begin with this. */
export const MQTT_PLATFORM_PREFIX = 'nebula-';

/** A client's username: lower-case letters, digits, `-` and `_`. */
export const MQTT_USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/**
 * Adds a client. `prefix` holds it to its own topics - `<username>/#` - and the announcements';
 * `all` lets it reach every topic.
 */
export const mqttClientAddRequestSchema = z.object({
  username: z
    .string()
    .regex(MQTT_USERNAME_PATTERN, 'Lower-case letters, digits, - and _')
    .refine((username) => !username.startsWith(MQTT_PLATFORM_PREFIX), {
      message: `Usernames beginning with ${MQTT_PLATFORM_PREFIX} are the platform's`,
    }),
  label: z.string().trim().max(64).default(''),
  access: z.enum(['prefix', 'all']).default('prefix'),
});

/** Adds a client. */
export type MqttClientAddRequest = z.output<typeof mqttClientAddRequestSchema>;

/** The client added, and its password - answered this once and never again. */
export const mqttClientAddReplySchema = z.object({
  username: z.string().max(64),
  password: z.string().min(1),
});

/** Removes a client. */
export const mqttClientRemoveRequestSchema = z.object({ username: z.string().min(1).max(64) });

/** Whether there was such a client. */
export const mqttClientRemoveReplySchema = z.object({ isRemoved: z.boolean() });

/** Asks for the last message of the topics under a prefix. */
export const mqttTopicsRequestSchema = z.object({
  prefix: z.string().max(256).default(''),
  limit: z.int().min(1).max(2000).default(500),
});

/** One topic, and its last message. */
export const mqttTopicSchema = z.object({
  topic: z.string(),

  /** Its last payload as text, cut; `<n bytes>` for one that is not text. */
  payload: z.string(),
  size: z.int().min(0),
  isRetained: z.boolean(),
  updatedAt: timestampSchema,

  /** How many messages it carried since the broker started. */
  count: z.int().min(0),
});

/** One topic. */
export type MqttTopic = z.output<typeof mqttTopicSchema>;

/** The topics, the most recent first, and how many there are in all. */
export const mqttTopicsReplySchema = z.object({
  items: z.array(mqttTopicSchema),
  total: z.int().min(0),
});

/** A topic a client may publish on: no wildcards, no `$`. */
const mappedTopicSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^#+$][^#+]*$/u, 'A topic, without wildcards');

/**
 * A device the owner maps by hand: one that does not announce itself, read from the topic it
 * publishes on - a sensor from `tele/garden/SENSOR`'s `AM2301.Temperature`, a switch from
 * `stat/pump/POWER`, commanded on `cmnd/pump/POWER`.
 */
export const mqttMappingInputSchema = z.strictObject({
  /** Its id; a new one is given one. */
  id: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/u)
    .optional(),
  name: z.string().trim().min(1).max(64),
  component: z.enum(MQTT_MAPPING_COMPONENTS),
  stateTopic: mappedTopicSchema,

  /** Where the value is in a JSON payload, dotted: `AM2301.Temperature`. Empty for the payload. */
  valuePath: z
    .string()
    .trim()
    .max(128)
    .regex(/^$|^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/u, 'Keys separated by dots')
    .default(''),
  unit: z.string().trim().max(16).default(''),
  deviceClass: z.string().trim().max(32).default(''),
  commandTopic: mappedTopicSchema.optional(),
  payloadOn: z.string().max(64).default('ON'),
  payloadOff: z.string().max(64).default('OFF'),
});

/** A mapping, as the page sends it. */
export type MqttMappingInput = z.output<typeof mqttMappingInputSchema>;

/** A mapping, saved. */
export const mqttMappingSchema = mqttMappingInputSchema.extend({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/u),
});

/** A mapping, saved. */
export type MqttMapping = z.output<typeof mqttMappingSchema>;

/** Every mapping, by name. */
export const mqttMappingsReplySchema = z.object({ items: z.array(mqttMappingSchema) });

/** Removes a mapping. */
export const mqttMappingRemoveRequestSchema = z.object({ id: z.string().min(1).max(64) });

/** Whether there was such a mapping. */
export const mqttMappingRemoveReplySchema = z.object({ isRemoved: z.boolean() });

/** A username for a container the platform runs: whose it is, and the topics it may use. */
export const mqttCredentialsRequestSchema = z.strictObject({
  /** Whose container: `vendor:zigbee2mqtt`, `package:nvr`. */
  owner: z.string().regex(/^(?:vendor:[a-z]|package:[a-z0-9])[a-z0-9-]{1,63}$/u),

  /** The topics it may use; every topic when not said. */
  topics: z.array(z.string().min(1).max(256)).max(16).optional(),
});

/** A username for a container. */
export type MqttCredentialsRequest = z.output<typeof mqttCredentialsRequestSchema>;

/** The username, its password, and the port the broker listens on. */
export const mqttCredentialsReplySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  port: z.int().min(1).max(65_535),
});

/** What the broker answers. */
export type MqttCredentialsReply = z.output<typeof mqttCredentialsReplySchema>;
