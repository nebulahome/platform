/**
 * The house's Thread broker, as the hub runs it and the Brokers page shows it.
 *
 * Thread is one of the platform's brokers: the house's Thread network, through an OpenThread
 * Border Router (OTBR). The platform runs its own OTBR as one of its services - `otbr-agent` on a
 * radio plugged into the server (SkyConnect / ZBT-1, an nRF52840 dongle, flashed as an OpenThread
 * RCP), its port held through the Serial broker - and keeps it stopped until Thread is set up. An
 * OTBR running elsewhere is used instead by the URL of its REST API.
 *
 * Thread devices are Matter devices in practice: they are added and controlled on the Matter page.
 * This broker is the **network**: its credentials, its border routers, its topology and health.
 * Its network key is never stored by the platform; it stays in OTBR and is read from it on demand.
 */
import { z } from 'zod';

import { brokerJobSchemaOf, BROKER_STATES } from './brokers.js';
import { integrationIdSchema } from './integrations.js';
import { timestampSchema } from './timestamp.js';

/** Where the broker stands. */
export const HUB_THREAD_STATUS_METHOD = 'thread_status';

/** The free serial ports a radio may be on, the recognised radios first. */
export const HUB_THREAD_RADIOS_METHOD = 'thread_radios';

/** Asks a radio which firmware it runs. */
export const HUB_THREAD_RADIO_CHECK_METHOD = 'thread_radio_check';

/** Starts setting Thread up: the border router, the radio, the network, the hand-off to Matter. */
export const HUB_THREAD_SETUP_METHOD = 'thread_setup';

/** Saves the owner's settings: the network's name and channel, and the hand-off to Matter. */
export const HUB_THREAD_SETTINGS_METHOD = 'thread_settings';

/** Joins another network by its dataset, leaving the current one. */
export const HUB_THREAD_JOIN_METHOD = 'thread_join';

/** Restarts the platform's border router. */
export const HUB_THREAD_RESTART_METHOD = 'thread_restart';

/** Removes the border router: Thread is not set up afterwards. */
export const HUB_THREAD_REMOVE_METHOD = 'thread_remove';

/** Reads the network key from the border router. */
export const HUB_THREAD_NETWORK_KEY_METHOD = 'thread_network_key';

/** Reads the active dataset, as TLV hex, from the border router. */
export const HUB_THREAD_DATASET_METHOD = 'thread_dataset';

/** The border routers heard on the network (mDNS `_meshcop._udp`). */
export const HUB_THREAD_BORDER_ROUTERS_METHOD = 'thread_border_routers';

/** The nodes of the network, the house's devices and those it does not have. */
export const HUB_THREAD_DEVICES_METHOD = 'thread_devices';

/** Where the REST API of the platform's own border router listens. */
export const THREAD_LOCAL_REST_URL = 'http://127.0.0.1:8081';

/** The baud rate an OpenThread RCP radio speaks. */
export const THREAD_RCP_BAUD_RATE = 460_800;

/**
 * Whose border router: none (Thread not set up), the platform's own on a radio of this server,
 * or an external one by its URL.
 */
export const THREAD_MODES = ['none', 'local', 'external'] as const;

/** Whose border router. */
export type ThreadMode = (typeof THREAD_MODES)[number];

/** Which role a Thread node has in the network, as OpenThread names its states. */
export const THREAD_NODE_STATES = ['disabled', 'detached', 'child', 'router', 'leader'] as const;

/** A node's role, as the Devices tab chips it: a sleepy end device polls its parent. */
export const THREAD_DEVICE_ROLES = ['leader', 'router', 'end-device', 'sleepy'] as const;

/** A node's role. */
export type ThreadDeviceRole = (typeof THREAD_DEVICE_ROLES)[number];

/** Which firmware a radio answered as: OpenThread RCP, Zigbee (no spinel answer), or not known. */
export const THREAD_FIRMWARES = ['openthread-rcp', 'zigbee', 'unknown'] as const;

/** Why Thread cannot be set up on this server: it needs the host's network, on Linux. */
export const THREAD_SETUP_BLOCKERS = ['bridge', 'desktop'] as const;

/** The steps of setting Thread up, in order. */
export const THREAD_SETUP_STEPS = ['border-router', 'radio', 'network', 'matter'] as const;

/** A network's name: 1 to 16 characters. */
export const threadNetworkNameSchema = z.string().trim().min(1).max(16);

/** A channel of 2.4 GHz Thread: 11 to 26. */
export const threadChannelSchema = z.int().min(11).max(26);

/** An operational dataset, as its TLVs in hex: what another border router or phone app takes. */
export const threadDatasetSchema = z
  .string()
  .trim()
  .max(508)
  .regex(/^(?:[0-9A-Fa-f]{2})+$/u, 'The dataset as hex, two digits a byte')
  .transform((hex) => hex.toLowerCase());

/** The URL of an external border router's REST API: `http://192.168.1.20:8081`. */
export const threadRestUrlSchema = z.url({ protocol: /^https?$/u }).max(512);

/** The network as the Credentials panel and the Network card show it: nothing secret. */
export const threadNetworkSchema = z.object({
  name: z.string().max(16),
  channel: z.int().min(0).max(255),

  /** Four hex digits, `0x1a2b`. */
  panId: z.string().max(6),

  /** Sixteen hex digits. */
  extPanId: z.string().max(16),

  /** `fd11:22::/64`. */
  meshLocalPrefix: z.string().max(64),

  /** The role of this server's border router. */
  role: z.enum(THREAD_NODE_STATES),
});

/** The network, without its key. */
export type ThreadNetwork = z.output<typeof threadNetworkSchema>;

/** One host setting the IPv6 check found wrong, and what it should be. */
export const threadIpv6FixSchema = z.object({
  /** The sysctl: `net.ipv6.conf.eth0.accept_ra`. */
  key: z.string().max(128),
  current: z.string().max(32).nullable(),
  wanted: z.string().max(32),
});

/** Setting Thread up. */
export const threadSetupJobSchema = brokerJobSchemaOf(THREAD_SETUP_STEPS);

/** Setting Thread up. */
export type ThreadSetupJob = z.output<typeof threadSetupJobSchema>;

/** Where the broker stands, as the Brokers page and the health cards show it. */
export const threadStatusSchema = z.object({
  state: z.enum(BROKER_STATES),
  error: z.string().max(2048).nullable(),
  mode: z.enum(THREAD_MODES),

  /** Why it cannot be set up here; null when it can. */
  setupBlockedBy: z.enum(THREAD_SETUP_BLOCKERS).nullable(),

  /** The border router; null while Thread is not set up. */
  borderRouter: z
    .object({
      isRunning: z.boolean(),
      version: z.string().max(128).nullable(),

      /** Its REST API: the platform's own, or the owner's external one. */
      url: z.string().max(512),
    })
    .nullable(),

  /** The radio of the platform's own border router; null for an external one, or none. */
  radio: z
    .object({
      portId: z.uuid(),
      name: z.string().max(256),
      path: z.string().max(512),
      firmware: z.string().max(128).nullable(),
      isConnected: z.boolean(),
    })
    .nullable(),

  /** The network; null before one is formed or joined. */
  network: threadNetworkSchema.nullable(),
  devices: z.object({
    routers: z.int().min(0),
    endDevices: z.int().min(0),
    sleepy: z.int().min(0),
  }),

  /**
   * Whether the server accepts the routes the border router announces, without which the house
   * cannot reach Thread devices; the settings to fix when not.
   */
  ipv6: z.object({
    isOk: z.boolean(),
    interface: z.string().max(32).nullable(),
    fixes: z.array(threadIpv6FixSchema).max(8),
  }),

  /** Whether the network is handed to Matter for devices commissioned over Bluetooth. */
  useForMatter: z.boolean(),

  /** The last setup; null when none ran since the hub started. */
  setup: threadSetupJobSchema.nullable(),
});

/** Where the broker stands. */
export type ThreadStatus = z.output<typeof threadStatusSchema>;

/** A serial port a radio may be on. */
export const threadRadioSchema = z.object({
  portId: z.uuid(),
  name: z.string().max(256),
  path: z.string().max(512),

  /** The radio it is recognised as: `Home Assistant SkyConnect`; null when it is not. */
  model: z.string().max(128).nullable(),

  /** Where its maker's flasher is, for one recognised. */
  flasherUrl: z.url().max(512).nullable(),
});

/** A port a radio may be on. */
export type ThreadRadio = z.output<typeof threadRadioSchema>;

/** The free ports, the recognised radios first. */
export const threadRadiosReplySchema = z.object({ items: z.array(threadRadioSchema) });

/** Asks a radio which firmware it runs. */
export const threadRadioCheckRequestSchema = z.object({ portId: z.uuid() });

/** Which firmware it runs, or why it could not be asked. */
export const threadRadioCheckReplySchema = z.object({
  firmware: z.enum(THREAD_FIRMWARES),

  /** The firmware's version string, as the radio said it. */
  version: z.string().max(256).nullable(),
  error: z.string().max(512).nullable(),
});

/** Sets Thread up. */
export const threadSetupRequestSchema = z.object({
  /** The platform's own border router on a radio, or an external one by its URL. */
  border: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('local'), portId: z.uuid() }),
    z.object({ mode: z.literal('external'), url: threadRestUrlSchema }),
  ]),

  /**
   * A new network - its name prefilled, its channel picked or left to the border router - one to
   * join by its dataset, or the one an external border router already has.
   */
  network: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('create'),
      name: threadNetworkNameSchema,
      channel: threadChannelSchema.nullable().default(null),
    }),
    z.object({ action: z.literal('join'), dataset: threadDatasetSchema }),
    z.object({ action: z.literal('keep') }),
  ]),
  useForMatter: z.boolean().default(true),
});

/** Sets Thread up. */
export type ThreadSetupRequest = z.output<typeof threadSetupRequestSchema>;

/** Changes what the owner may change; a channel change goes out as a pending dataset. */
export const threadSettingsRequestSchema = z.object({
  name: threadNetworkNameSchema.optional(),
  channel: threadChannelSchema.optional(),
  useForMatter: z.boolean().optional(),
});

/** Joins another network. */
export const threadJoinRequestSchema = z.object({ dataset: threadDatasetSchema });

/** Whether there was a border router, and it is gone. */
export const threadRemoveReplySchema = z.object({ isRemoved: z.boolean() });

/** The network key, as OTBR has it: 32 hex digits. */
export const threadNetworkKeyReplySchema = z.object({
  networkKey: z.string().regex(/^[0-9a-f]{32}$/u),
});

/** The active dataset. */
export const threadDatasetReplySchema = z.object({ dataset: threadDatasetSchema });

/** A border router heard on the network. */
export const threadBorderRouterSchema = z.object({
  /** Its mDNS instance name, which tells it apart. */
  id: z.string().min(1).max(256),
  name: z.string().max(256),
  vendor: z.string().max(128).nullable(),
  model: z.string().max(128).nullable(),
  networkName: z.string().max(16).nullable(),
  extPanId: z.string().max(16).nullable(),
  address: z.string().max(64).nullable(),
  isThisServer: z.boolean(),

  /** Whether it is on the house's network: the same extended PAN ID. */
  isSameNetwork: z.boolean(),
});

/** A border router heard. */
export type ThreadBorderRouter = z.output<typeof threadBorderRouterSchema>;

/** Every border router heard: this server's first. */
export const threadBorderRoutersReplySchema = z.object({
  items: z.array(threadBorderRouterSchema),
});

/** A node of the network: a device of the house, or an unknown Thread node. */
export const threadDeviceSchema = z.object({
  /** Its extended address, sixteen hex digits. */
  extAddress: z.string().max(16),

  /** The device of the house it is; null for an unknown node. */
  deviceId: integrationIdSchema.nullable(),
  name: z.string().max(256).nullable(),
  areaId: z.uuid().nullable(),
  role: z.enum(THREAD_DEVICE_ROLES),

  /** An end device's parent, by extended address, and its name when it is the house's. */
  parentExtAddress: z.string().max(16).nullable(),
  parentName: z.string().max(256).nullable(),

  /** The link quality to its parent or best neighbour, 0 to 3; null when not measured. */
  linkQuality: z.int().min(0).max(3).nullable(),
  rssi: z.int().min(-127).max(20).nullable(),
  lastSeenAt: timestampSchema.nullable(),
});

/** A node of the network. */
export type ThreadDevice = z.output<typeof threadDeviceSchema>;

/** Every node: the house's devices first, then the unknown ones. */
export const threadDevicesReplySchema = z.object({ items: z.array(threadDeviceSchema) });
