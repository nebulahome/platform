/**
 * The house's Bluetooth broker, as the hub runs it and the Brokers page shows it.
 *
 * Bluetooth Low Energy is one of the platform's brokers: the server's own adapter, through the
 * host's BlueZ over D-Bus, and **proxies** - devices of an integration that listen for the house
 * and forward what they hear (in v1, Shelly Gen2+ devices running a small script). Proxies only
 * listen; only the local adapter connects to a device.
 *
 * Every advertisement heard is kept per address and per scanner for a while: who hears it best,
 * how loud, how often. A device of the house is reached over the platform transport `bluetooth`,
 * its device key its address. An integration recognises its own devices in what is heard through
 * its `discovery.json` `bluetooth` rules; the platform recognises BTHome sensors itself, through
 * its own `bluetooth` vendor.
 *
 * A device plays a role for the broker through the connection its instance already has: the hub
 * sends the reserved {@link BLUETOOTH_PROXY_OPS} to a device whose profile declares
 * {@link bluetoothProxyProfileSchema}, and the proxy reports {@link bluetoothAdvertSchema}s back
 * through the SDK's scanner.
 */
import { z } from 'zod';

import { brokerJobSchemaOf, BROKER_STATES } from './brokers.js';
import { integrationIdSchema, integrationKindIdSchema, VENDOR_ID_PATTERN } from './integrations.js';
import { MATTER_LINK_STRENGTHS } from './matter.js';
import { timestampSchema } from './timestamp.js';

/** The platform transport every Bluetooth device is reached through; its device key the address. */
export const BLUETOOTH_TRANSPORT = 'bluetooth';

/** The platform's own vendor: the devices it recognises itself, BTHome sensors. */
export const BLUETOOTH_VENDOR = 'bluetooth';

/** The driver of the platform's own vendor that maps a BTHome v2 sensor's readings. */
export const BTHOME_KIND = `${BLUETOOTH_VENDOR}/bthome`;

/** The 16-bit service UUID BTHome v2 advertises its readings under. */
export const BTHOME_SERVICE_UUID = 'fcd2';

/** How long a Nearby lease holds without being renewed: the page renews it while it is open. */
export const BLUETOOTH_NEARBY_LEASE_MS = 30_000;

/** How far back "heard" counts: the devices heard in the last five minutes. */
export const BLUETOOTH_HEARD_WINDOW_MS = 5 * 60_000;

/** Where the broker stands. */
export const HUB_BLUETOOTH_STATUS_METHOD = 'bluetooth_status';

/** Saves the owner's settings. */
export const HUB_BLUETOOTH_SETTINGS_METHOD = 'bluetooth_settings';

/** The Bluetooth devices of the house, with who hears each and how well. */
export const HUB_BLUETOOTH_DEVICES_METHOD = 'bluetooth_devices';

/** Who hears what: the server, its proxies, and each device on the scanner that hears it best. */
export const HUB_BLUETOOTH_MAP_METHOD = 'bluetooth_map';

/** Everything heard, the house's or not, for finding and debugging. */
export const HUB_BLUETOOTH_NEARBY_METHOD = 'bluetooth_nearby';

/** Holds, renews or lets go of a Nearby lease: while one is held, proxies forward everything. */
export const HUB_BLUETOOTH_NEARBY_LEASE_METHOD = 'bluetooth_nearby_lease';

/** The devices an integration recognises that the house does not have, and those ignored. */
export const HUB_BLUETOOTH_FOUND_METHOD = 'bluetooth_found';

/** Ignores an address, or stops ignoring it. */
export const HUB_BLUETOOTH_IGNORE_METHOD = 'bluetooth_ignore';

/** Adds a device heard, as the integration that recognises it. */
export const HUB_BLUETOOTH_ADD_METHOD = 'bluetooth_add';

/** The scanners: the local adapter and every proxy, with their settings and what they hear. */
export const HUB_BLUETOOTH_SCANNERS_METHOD = 'bluetooth_scanners';

/** The devices whose integration can make them proxies, and why the others cannot. */
export const HUB_BLUETOOTH_PROXY_CANDIDATES_METHOD = 'bluetooth_proxy_candidates';

/** Starts making a device a proxy: the script installed, started, its first report. */
export const HUB_BLUETOOTH_PROXY_ADD_METHOD = 'bluetooth_proxy_add';

/** Reads a proxy job until it ends. */
export const HUB_BLUETOOTH_PROXY_JOB_METHOD = 'bluetooth_proxy_job';

/** Changes how a proxy scans. */
export const HUB_BLUETOOTH_PROXY_MODE_METHOD = 'bluetooth_proxy_mode';

/** Installs the script the integration ships now over an outdated one, as a job. */
export const HUB_BLUETOOTH_PROXY_UPDATE_METHOD = 'bluetooth_proxy_update';

/** Stops a device being a proxy: its script is removed. */
export const HUB_BLUETOOTH_PROXY_REMOVE_METHOD = 'bluetooth_proxy_remove';

/** How a scanner listens: passive only hears, active also asks devices for more. */
export const BLUETOOTH_SCAN_MODES = ['passive', 'active'] as const;

/** How a scanner listens. */
export type BluetoothScanMode = (typeof BLUETOOTH_SCAN_MODES)[number];

/** How an address is: the maker's (`public`), or one the device made up (`random`). */
export const BLUETOOTH_ADDRESS_TYPES = ['public', 'random'] as const;

/** What a scanner is: the server's own adapter, or a device of an integration that listens. */
export const BLUETOOTH_SCANNER_KINDS = ['adapter', 'proxy'] as const;

/** How a device of the house is reached: heard, or connected to (the local adapter only). */
export const BLUETOOTH_LINKS = ['listening', 'connected'] as const;

/**
 * Why the local adapter cannot be used: Docker Desktop, no `/run/dbus` in the container, BlueZ
 * not running on the host, no adapter, the adapter powered off, or the owner turned it off.
 */
export const BLUETOOTH_ADAPTER_PROBLEMS = [
  'desktop',
  'no-dbus',
  'no-bluez',
  'no-adapter',
  'powered-off',
  'disabled',
] as const;

/** Why the local adapter cannot be used. */
export type BluetoothAdapterProblem = (typeof BLUETOOTH_ADAPTER_PROBLEMS)[number];

/** Why a device cannot be a proxy: Gen1, battery powered, firmware too old, no Bluetooth. */
export const BLUETOOTH_PROXY_INELIGIBLE_REASONS = [
  'gen1',
  'battery',
  'firmware',
  'no-bluetooth',
] as const;

/** What a proxy forwards: the house's devices and what a rule recognises, or everything. */
export const BLUETOOTH_FORWARDING = ['house', 'everything'] as const;

/** A Bluetooth address, `AA:BB:CC:DD:EE:FF`: read in either case, kept upper. */
export const bluetoothAddressSchema = z
  .string()
  .regex(/^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/u, 'A Bluetooth address, AA:BB:CC:DD:EE:FF')
  .transform((address) => address.toUpperCase());

/** A service UUID: 16-bit (`fcd2`), 32-bit, or 128-bit; read in either case, kept lower. */
export const bluetoothUuidSchema = z
  .string()
  .regex(
    /^(?:[0-9A-Fa-f]{4}|[0-9A-Fa-f]{8}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})$/u,
    'A Bluetooth UUID',
  )
  .transform((uuid) => uuid.toLowerCase());

/** Bytes an advertisement carries: hex, two digits a byte, kept lower; 255 bytes at most. */
export const bluetoothHexSchema = z
  .string()
  .max(510)
  .regex(/^(?:[0-9A-Fa-f]{2})*$/u, 'Hex, two digits a byte')
  .transform((hex) => hex.toLowerCase());

/** A signal strength, in dBm. */
const rssiSchema = z.int().min(-127).max(20);

/**
 * One advertisement a scanner heard: what a proxy reports through `sdk.bluetooth.scanner`, and
 * what the local adapter's D-Bus signals are turned into.
 */
export const bluetoothAdvertSchema = z.object({
  address: bluetoothAddressSchema,
  addressType: z.enum(BLUETOOTH_ADDRESS_TYPES),
  rssi: rssiSchema,
  name: z.string().max(248).optional(),

  /** By company id, in decimal (`76` is Apple): the bytes after it. */
  manufacturerData: z
    .record(z.string().regex(/^\d{1,5}$/u, 'A company id'), bluetoothHexSchema)
    .optional(),

  /** By service UUID: the bytes. */
  serviceData: z.record(bluetoothUuidSchema, bluetoothHexSchema).optional(),
  serviceUuids: z.array(bluetoothUuidSchema).max(64).optional(),
  at: timestampSchema,
});

/** One advertisement heard, as written. */
export type BluetoothAdvertInput = z.input<typeof bluetoothAdvertSchema>;

/** One advertisement heard. */
export type BluetoothAdvert = z.output<typeof bluetoothAdvertSchema>;

/** What a scanner reports at once. */
export const bluetoothAdvertBatchSchema = z.array(bluetoothAdvertSchema).max(1024);

/**
 * What a device that can be a proxy declares in its profile: the scan modes it can run.
 */
export const bluetoothProxyProfileSchema = z.strictObject({
  modes: z
    .array(z.enum(BLUETOOTH_SCAN_MODES))
    .min(1)
    .max(BLUETOOTH_SCAN_MODES.length)
    .refine((modes) => new Set(modes).size === modes.length, 'Each mode once'),
});

/** What a device that can be a proxy declares. */
export type BluetoothProxyProfile = z.output<typeof bluetoothProxyProfileSchema>;

/**
 * The ops the hub sends a proxy over its instance's connection, as `{ deviceKey, op, args }`.
 * Reserved: no integration uses these names for anything else.
 */
export const BLUETOOTH_PROXY_OPS = {
  /** Whether it can be a proxy and whether it is: answers {@link bluetoothProxyStateSchema}. */
  state: 'bluetooth-proxy.state',

  /** Installs the script, or the one shipped now over an older one, and starts it scanning. */
  install: 'bluetooth-proxy.install',

  /** Stops the script and removes it. */
  remove: 'bluetooth-proxy.remove',

  /** Which addresses it forwards: the house's, or everything while Nearby is open. */
  filter: 'bluetooth-proxy.filter',
} as const;

/** Arguments of `bluetooth-proxy.state` and `bluetooth-proxy.remove`. */
export const bluetoothProxyEmptyArgsSchema = z.object({});

/** Arguments of `bluetooth-proxy.install`. */
export const bluetoothProxyInstallArgsSchema = z.object({ mode: z.enum(BLUETOOTH_SCAN_MODES) });

/** Arguments of `bluetooth-proxy.filter`. */
export const bluetoothProxyFilterArgsSchema = z.object({
  addresses: z.union([z.literal('all'), z.array(bluetoothAddressSchema).max(4096)]),
});

/** What `bluetooth-proxy.state` answers: a device that can be a proxy, and whether it is one. */
export const bluetoothProxyStateSchema = z.discriminatedUnion('eligible', [
  z.object({
    eligible: z.literal(true),
    installed: z.boolean(),

    /** The script's version on the device; absent when none is installed. */
    version: z.string().max(64).optional(),

    /** The script's version the integration ships now. */
    shipped: z.string().max(64),
    running: z.boolean(),
  }),
  z.object({
    eligible: z.literal(false),
    reason: z.enum(BLUETOOTH_PROXY_INELIGIBLE_REASONS),

    /** For `firmware`: whether an update the device offers would make it eligible. */
    update: z.boolean().optional(),
  }),
]);

/** Whether a device can be a proxy, and whether it is. */
export type BluetoothProxyState = z.output<typeof bluetoothProxyStateSchema>;

/**
 * The ops the platform transport `bluetooth` carries to a device it connects to, GATT on the local
 * adapter only.
 */
export const BLUETOOTH_GATT_OPS = {
  read: 'gatt.read',
  write: 'gatt.write',
  notify: 'gatt.notify',
} as const;

/** One characteristic of a device. */
const gattTargetShape = { service: bluetoothUuidSchema, characteristic: bluetoothUuidSchema };

/** Arguments of `gatt.read`; it answers {@link bluetoothGattValueSchema}. */
export const bluetoothGattReadArgsSchema = z.object(gattTargetShape);

/** Arguments of `gatt.write`. */
export const bluetoothGattWriteArgsSchema = z.object({
  ...gattTargetShape,
  data: bluetoothHexSchema,
  withResponse: z.boolean().default(true),
});

/** Arguments of `gatt.notify`: notifications on or off; each arrives as a delivery. */
export const bluetoothGattNotifyArgsSchema = z.object({ ...gattTargetShape, isOn: z.boolean() });

/** A characteristic's value. */
export const bluetoothGattValueSchema = z.object({ data: bluetoothHexSchema });

/** The owner's settings. */
export const bluetoothSettingsSchema = z.object({
  /** Whether the server's own adapter is used; off, Matter's New device is off too. */
  localEnabled: z.boolean().default(true),

  /** Which adapter, `hci0`; null for the first BlueZ has. */
  adapterId: z
    .string()
    .regex(/^hci\d{1,3}$/u)
    .nullable()
    .default(null),
  localScanMode: z.enum(BLUETOOTH_SCAN_MODES).default('active'),

  /** How a new proxy scans. */
  proxyScanMode: z.enum(BLUETOOTH_SCAN_MODES).default('passive'),

  /** Addresses not heard for this long are dropped. */
  forgetAfterDays: z.int().min(1).max(365).default(7),

  /** Whether Nearby lists private addresses: phones and watches that change theirs. */
  showPrivate: z.boolean().default(false),
});

/** The owner's settings. */
export type BluetoothSettings = z.output<typeof bluetoothSettingsSchema>;

/** An adapter BlueZ has. */
export const bluetoothAdapterSchema = z.object({
  /** `hci0`. */
  id: z.string().max(16),

  /** What BlueZ calls it, or the chip: `Intel AX211`; null when it says nothing. */
  name: z.string().max(128).nullable(),
  address: z.string().max(17).nullable(),
  isPowered: z.boolean(),
});

/** How many connections an adapter holds, of how many it can. */
const connectionsSchema = z.object({ used: z.int().min(0), max: z.int().min(0) });

/** Where the broker stands, as the Brokers page and the health cards show it. */
export const bluetoothStatusSchema = z.object({
  state: z.enum(BROKER_STATES),
  error: z.string().max(2048).nullable(),

  /** The adapter in use; null when there is none to use, and `adapterProblem` says why. */
  adapter: bluetoothAdapterSchema
    .extend({
      scanMode: z.enum(BLUETOOTH_SCAN_MODES),

      /** Whether the host's BlueZ can scan passively; otherwise Passive is offered disabled. */
      canPassive: z.boolean(),
      connections: connectionsSchema,
    })
    .nullable(),

  /** Every adapter BlueZ has, for the Settings choice. */
  adapters: z.array(bluetoothAdapterSchema).max(16),
  adapterProblem: z.enum(BLUETOOTH_ADAPTER_PROBLEMS).nullable(),
  proxies: z.object({ total: z.int().min(0), reporting: z.int().min(0) }),

  /** What was heard in the last five minutes, and how much. */
  heard: z.object({ devices: z.int().min(0), advertsPerMinute: z.int().min(0) }),

  /** Whether Matter is pairing a device over the local adapter now. */
  isMatterPairing: z.boolean(),

  /** Whether a Nearby lease is held, and proxies forward everything they hear. */
  isForwardingAll: z.boolean(),
  settings: bluetoothSettingsSchema,
});

/** Where the broker stands. */
export type BluetoothStatus = z.output<typeof bluetoothStatusSchema>;

/** One scanner hearing an address. */
export const bluetoothHearingSchema = z.object({
  /** The scanner: `adapter:hci0`, or the proxy's device id. */
  scannerId: z.string().min(1).max(64),
  scannerName: z.string().max(256),
  rssi: rssiSchema,
  at: timestampSchema,
});

/** One scanner hearing an address. */
export type BluetoothHearing = z.output<typeof bluetoothHearingSchema>;

/** An integration that recognises what an address advertises, and what it would add it as. */
export const bluetoothClaimSchema = z.object({
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
  vendorName: z.string().max(128),
  kind: integrationKindIdSchema.nullable(),
  model: z.string().max(128).nullable(),
});

/** An integration that recognises an address. */
export type BluetoothClaim = z.output<typeof bluetoothClaimSchema>;

/** A Bluetooth device of the house. */
export const bluetoothDeviceSchema = z.object({
  deviceId: integrationIdSchema,
  name: z.string().max(256),
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
  areaId: z.uuid().nullable(),
  address: bluetoothAddressSchema,

  /** The best signal now; null when nobody heard it lately. */
  rssi: rssiSchema.nullable(),

  /** Every scanner hearing it, the best first. */
  heardBy: z.array(bluetoothHearingSchema).max(64),
  lastHeardAt: timestampSchema.nullable(),
  link: z.enum(BLUETOOTH_LINKS),
  addedAt: timestampSchema.nullable(),
});

/** A Bluetooth device of the house. */
export type BluetoothDevice = z.output<typeof bluetoothDeviceSchema>;

/** Every Bluetooth device of the house. */
export const bluetoothDevicesReplySchema = z.object({ items: z.array(bluetoothDeviceSchema) });

/** What a point of the map is: this server, its adapter, a proxy, or a device. */
export const BLUETOOTH_MAP_KINDS = ['server', 'adapter', 'proxy', 'device'] as const;

/** One point of the map. */
export const bluetoothMapNodeSchema = z.object({
  /** `server`, `adapter:hci0`, the proxy's device id, or the device's address. */
  id: z.string().min(1).max(64),
  kind: z.enum(BLUETOOTH_MAP_KINDS),
  name: z.string().max(256),
  deviceId: integrationIdSchema.nullable(),
  address: z.string().max(17).nullable(),
  isOnline: z.boolean().nullable(),
});

/** One link of the map: a proxy to the server, or a device to the scanner that hears it best. */
export const bluetoothMapLinkSchema = z.object({
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  network: z.enum(['wifi', 'ble']),
  strength: z.enum(MATTER_LINK_STRENGTHS),
  rssi: z.int().nullable(),
});

/** Who hears what. */
export const bluetoothMapSchema = z.object({
  collectedAt: timestampSchema.nullable(),
  nodes: z.array(bluetoothMapNodeSchema).max(2048),
  links: z.array(bluetoothMapLinkSchema).max(8192),
});

/** Who hears what. */
export type BluetoothMap = z.output<typeof bluetoothMapSchema>;

/** One address heard, the house's or not. */
export const bluetoothNearbySchema = z.object({
  address: bluetoothAddressSchema,
  addressType: z.enum(BLUETOOTH_ADDRESS_TYPES),

  /** A random resolvable or non-resolvable address: one a phone or a watch changes. */
  isPrivate: z.boolean(),
  name: z.string().max(248).nullable(),

  /** The maker, from the company id of its manufacturer data: `Xiaomi`, `Apple`. */
  maker: z.string().max(128).nullable(),
  companyId: z.int().min(0).max(65_535).nullable(),
  serviceUuids: z.array(bluetoothUuidSchema).max(64),

  /** The best signal, and every scanner hearing it, the best first. */
  rssi: rssiSchema,
  heardBy: z.array(bluetoothHearingSchema).max(64),
  lastHeardAt: timestampSchema,
  claims: z.array(bluetoothClaimSchema).max(16),

  /** The device of the house it is; null for one the house does not have. */
  deviceId: integrationIdSchema.nullable(),
  isIgnored: z.boolean(),

  /** The raw advertisement, for integration authors. */
  manufacturerData: z.record(z.string(), bluetoothHexSchema),
  serviceData: z.record(z.string(), bluetoothHexSchema),
});

/** One address heard. */
export type BluetoothNearby = z.output<typeof bluetoothNearbySchema>;

/** Everything heard, the loudest first; private addresses only when the settings say so. */
export const bluetoothNearbyReplySchema = z.object({
  items: z.array(bluetoothNearbySchema).max(4096),
});

/** Holds or renews a lease, or lets go of it, by an id the page made up. */
export const bluetoothNearbyLeaseRequestSchema = z.object({
  leaseId: z.uuid(),
  isHeld: z.boolean(),
});

/** Whether proxies forward everything now, and until when this lease holds. */
export const bluetoothNearbyLeaseReplySchema = z.object({
  isForwardingAll: z.boolean(),
  expiresAt: timestampSchema.nullable(),
});

/** A device an integration recognises that the house does not have. */
export const bluetoothFoundSchema = z.object({
  address: bluetoothAddressSchema,
  name: z.string().max(248).nullable(),
  rssi: rssiSchema,

  /** The scanner that hears it best. */
  scannerName: z.string().max(256),
  claims: z.array(bluetoothClaimSchema).min(1).max(16),
  foundAt: timestampSchema,
});

/** A device recognised and not added. */
export type BluetoothFound = z.output<typeof bluetoothFoundSchema>;

/** An address the owner ignores: never offered again. */
export const bluetoothIgnoredSchema = z.object({
  address: bluetoothAddressSchema,
  name: z.string().max(248).nullable(),
  at: timestampSchema,
});

/** The devices recognised, and those ignored. */
export const bluetoothFoundReplySchema = z.object({
  items: z.array(bluetoothFoundSchema),
  ignored: z.array(bluetoothIgnoredSchema),
});

/** Ignores an address, or stops ignoring it. */
export const bluetoothIgnoreRequestSchema = z.object({
  address: bluetoothAddressSchema,
  isIgnored: z.boolean(),
});

/** How many addresses are ignored now. */
export const bluetoothIgnoreReplySchema = z.object({ count: z.int().min(0) });

/** Adds a device heard, as one of the drivers that recognise it; the only one when left out. */
export const bluetoothAddRequestSchema = z.object({
  address: bluetoothAddressSchema,
  kind: integrationKindIdSchema.optional(),
});

/** The device added. */
export const bluetoothAddReplySchema = z.object({ deviceId: integrationIdSchema });

/** A scanner: the local adapter, or a proxy. */
export const bluetoothScannerSchema = z.object({
  /** `adapter:hci0`, or the proxy's device id. */
  id: z.string().min(1).max(64),
  kind: z.enum(BLUETOOTH_SCANNER_KINDS),
  name: z.string().max(256),

  /** The proxy's device and integration; null for the adapter. */
  deviceId: integrationIdSchema.nullable(),
  vendorId: z.string().regex(VENDOR_ID_PATTERN).nullable(),
  areaId: z.uuid().nullable(),

  /** The adapter's MAC address and chip; null for a proxy. */
  address: z.string().max(17).nullable(),
  chip: z.string().max(128).nullable(),
  isOnline: z.boolean(),
  isEnabled: z.boolean(),
  scanMode: z.enum(BLUETOOTH_SCAN_MODES),
  canPassive: z.boolean(),
  advertsPerMinute: z.int().min(0),

  /** The adapter's connections; null for a proxy, which cannot connect. */
  connections: connectionsSchema.nullable(),

  /** What a proxy forwards; null for the adapter. */
  forwarding: z.enum(BLUETOOTH_FORWARDING).nullable(),
  lastReportAt: timestampSchema.nullable(),

  /** A proxy's script: the version on it, the one shipped, and whether it is behind. */
  script: z
    .object({
      version: z.string().max(64).nullable(),
      shipped: z.string().max(64).nullable(),
      isOutdated: z.boolean(),
    })
    .nullable(),

  /** The addresses it hears best of every scanner: where a new proxy would help. */
  hearsBest: z
    .array(
      z.object({
        address: bluetoothAddressSchema,
        name: z.string().max(256).nullable(),
        deviceId: integrationIdSchema.nullable(),
        rssi: rssiSchema,
      }),
    )
    .max(4096),
});

/** A scanner. */
export type BluetoothScanner = z.output<typeof bluetoothScannerSchema>;

/** Every scanner: the adapter first, then the proxies by name. */
export const bluetoothScannersReplySchema = z.object({ items: z.array(bluetoothScannerSchema) });

/** Narrows the candidates to one device, as its own page asks. */
export const bluetoothProxyCandidatesRequestSchema = z.object({
  deviceId: integrationIdSchema.optional(),
});

/** A device whose integration can make it a proxy, and whether it can be one. */
export const bluetoothProxyCandidateSchema = z.object({
  deviceId: integrationIdSchema,
  name: z.string().max(256),
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
  areaId: z.uuid().nullable(),
  isOnline: z.boolean(),

  /** Its Wi-Fi signal, in dBm; null when it does not say. */
  wifiRssi: z.int().min(-127).max(20).nullable(),

  /** Whether it can be one, and is; null while it does not answer. */
  proxy: bluetoothProxyStateSchema.nullable(),

  /** The scan modes its profile declares. */
  modes: z.array(z.enum(BLUETOOTH_SCAN_MODES)).max(BLUETOOTH_SCAN_MODES.length),
});

/** A device that can be a proxy, or cannot and why. */
export type BluetoothProxyCandidate = z.output<typeof bluetoothProxyCandidateSchema>;

/** The candidates: those that can first. */
export const bluetoothProxyCandidatesReplySchema = z.object({
  items: z.array(bluetoothProxyCandidateSchema),
});

/** Makes a device a proxy that scans so. */
export const bluetoothProxyAddRequestSchema = z.object({
  deviceId: integrationIdSchema,
  mode: z.enum(BLUETOOTH_SCAN_MODES),
});

/** Changes how a proxy scans. */
export const bluetoothProxyModeRequestSchema = bluetoothProxyAddRequestSchema;

/** Names a proxy. */
export const bluetoothProxyDeviceRequestSchema = z.object({ deviceId: integrationIdSchema });

/** The steps of making a device a proxy, in order. */
export const BLUETOOTH_PROXY_STEPS = ['installing', 'started', 'first-report'] as const;

/** Making a device a proxy, or updating its script. */
export const bluetoothProxyJobSchema = brokerJobSchemaOf(BLUETOOTH_PROXY_STEPS).extend({
  deviceId: integrationIdSchema,
  mode: z.enum(BLUETOOTH_SCAN_MODES),
});

/** Making a device a proxy. */
export type BluetoothProxyJob = z.output<typeof bluetoothProxyJobSchema>;

/** Reads a proxy job. */
export const bluetoothProxyJobRequestSchema = z.object({ jobId: z.string().min(1).max(64) });

/** Whether the device was a proxy, and no longer is. */
export const bluetoothProxyRemoveReplySchema = z.object({ isRemoved: z.boolean() });
