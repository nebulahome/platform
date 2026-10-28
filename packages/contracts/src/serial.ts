/**
 * The house's Serial broker, as the hub runs it and the Brokers page shows it.
 *
 * Serial is one of the platform's brokers: the serial ports the server sees - USB adapters,
 * built-in RS-232/RS-485 ports, and ports on the network (ser2net, ESP serial bridges, raw TCP or
 * RFC 2217) - and **who holds each one**. A port has exactly one holder: a device of an
 * integration (a serial UPS, a meter), another broker (Thread's radio), the owner's console, or a
 * managed container (zigbee2mqtt's coordinator), which is shown and never changed from here. The
 * broker is the one place that says who has a port, and it never opens a port twice.
 *
 * A device of an integration reaches its port through `sdk.openSerial(port, line)`; its config
 * carries {@link serialDeviceConfigSchema}. The broker recognises nothing on its own beyond the
 * Thread radios it knows: a port is named by an integration whose `discovery.json` `serial` rules
 * match its USB strings.
 */
import { z } from 'zod';

import { BROKER_STATES } from './brokers.js';
import { integrationIdSchema, integrationKindIdSchema, VENDOR_ID_PATTERN } from './integrations.js';
import { serialLineSchema } from './serial-line.js';
import { timestampSchema } from './timestamp.js';

/** Where the broker stands. */
export const HUB_SERIAL_STATUS_METHOD = 'serial_status';

/** Every port the server sees or the owner added, with who holds it. */
export const HUB_SERIAL_PORTS_METHOD = 'serial_ports';

/** The devices of the house reached through a port. */
export const HUB_SERIAL_DEVICES_METHOD = 'serial_devices';

/** Saves the owner's settings. */
export const HUB_SERIAL_SETTINGS_METHOD = 'serial_settings';

/** Ignores a port, so it is never suggested, or stops ignoring it. */
export const HUB_SERIAL_IGNORE_METHOD = 'serial_ignore';

/** Saves a port on the network, new or changed. */
export const HUB_SERIAL_NETWORK_PORT_SAVE_METHOD = 'serial_network_port_save';

/** Opens a socket to a port on the network once, as Add network port's test does. */
export const HUB_SERIAL_NETWORK_PORT_TEST_METHOD = 'serial_network_port_test';

/** Takes a port from its holder: its device stays in the house and goes offline. */
export const HUB_SERIAL_RELEASE_METHOD = 'serial_release';

/** Forgets a port that is unplugged, or one on the network. */
export const HUB_SERIAL_FORGET_METHOD = 'serial_forget';

/** Opens the owner's console on a free port: the console holds it until closed. */
export const HUB_SERIAL_CONSOLE_OPEN_METHOD = 'serial_console_open';

/** What the console's port said and was sent since a cursor. */
export const HUB_SERIAL_CONSOLE_READ_METHOD = 'serial_console_read';

/** Sends bytes through the console. */
export const HUB_SERIAL_CONSOLE_WRITE_METHOD = 'serial_console_write';

/** Closes the console and lets go of its port. */
export const HUB_SERIAL_CONSOLE_CLOSE_METHOD = 'serial_console_close';

/** What a port is: a USB adapter, a port built into the machine (`ttyS*`), or one on the network. */
export const SERIAL_PORT_KINDS = ['usb', 'builtin', 'network'] as const;

/** What a port is. */
export type SerialPortKind = (typeof SERIAL_PORT_KINDS)[number];

/** How a port on the network is spoken to: plain bytes over TCP, or RFC 2217 (Telnet COM port). */
export const SERIAL_NETWORK_PROTOCOLS = ['raw', 'rfc2217'] as const;

/** How a port on the network is spoken to. */
export type SerialNetworkProtocol = (typeof SERIAL_NETWORK_PROTOCOLS)[number];

/**
 * Who holds a port: a device of an integration, another broker, the owner's console, or a managed
 * container, which holds it through its own spec and is read-only here.
 */
export const SERIAL_HOLDER_KINDS = ['device', 'broker', 'console', 'container'] as const;

/** Who holds a port. */
export type SerialHolderKind = (typeof SERIAL_HOLDER_KINDS)[number];

/** The brokers that take a port: Thread, for its radio. */
export const SERIAL_BROKER_HOLDERS = ['thread'] as const;

/** A broker that takes a port. */
export type SerialBrokerHolder = (typeof SERIAL_BROKER_HOLDERS)[number];

/**
 * Whether the container reaches serial ports at all: it does, it sees none (the compose file
 * passes none in), or it runs on Docker Desktop, which cannot pass USB through.
 */
export const SERIAL_ACCESS_STATES = ['ok', 'none', 'desktop'] as const;

/** The baud rates the port settings offer, the driver's default preselected. */
export const SERIAL_BAUD_RATES = [
  1200, 2400, 4800, 9600, 19_200, 38_400, 57_600, 115_200, 230_400, 460_800, 921_600,
] as const;

/** What the console adds after each line it sends. */
export const SERIAL_LINE_ENDINGS = ['none', 'lf', 'crlf'] as const;

/** What a device of a `serial` driver keeps in its config: its port, and how it is spoken. */
export const serialDeviceConfigSchema = z.strictObject({
  portId: z.uuid(),
  line: serialLineSchema,
});

/** What a device of a `serial` driver keeps in its config. */
export type SerialDeviceConfig = z.output<typeof serialDeviceConfigSchema>;

/** A host: an IPv4 address or a name. */
const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$/u, 'An address or a host name');

/** A port on the network: where, and how it is spoken to. */
export const serialNetworkAddressSchema = z.object({
  host: hostSchema,
  port: z.int().min(1).max(65_535),
  protocol: z.enum(SERIAL_NETWORK_PROTOCOLS).default('raw'),
});

/** A port on the network. */
export type SerialNetworkAddress = z.output<typeof serialNetworkAddressSchema>;

/** What a USB adapter says it is, from sysfs; null for what it does not say. */
export const serialUsbSchema = z.object({
  /** Four lower-case hex digits: `10c4`, `ea60`. */
  vendorId: z.string().regex(/^[0-9a-f]{4}$/u),
  productId: z.string().regex(/^[0-9a-f]{4}$/u),
  serialNumber: z.string().max(256).nullable(),
  manufacturer: z.string().max(256).nullable(),
  product: z.string().max(256).nullable(),
});

/** What a USB adapter says it is. */
export type SerialUsb = z.output<typeof serialUsbSchema>;

/** Who holds a port, as its tag shows it. */
export const serialHolderSchema = z.object({
  kind: z.enum(SERIAL_HOLDER_KINDS),

  /** The device, for a device's; null otherwise. */
  deviceId: integrationIdSchema.nullable(),

  /** The integration whose logo the tag carries, for a device's or a container's. */
  vendorId: z.string().regex(VENDOR_ID_PATTERN).nullable(),

  /** The broker, for a broker's; null otherwise. */
  broker: z.enum(SERIAL_BROKER_HOLDERS).nullable(),

  /** The container, for one passed to a managed container; null otherwise. */
  container: z.string().max(128).nullable(),

  /** What the tag says: the device's name, "Thread broker", the container's name, "Console". */
  name: z.string().max(256),
});

/** Who holds a port. */
export type SerialHolder = z.output<typeof serialHolderSchema>;

/**
 * Who would take a port: an integration whose `serial` rules match it, or a broker that recognises
 * it - Thread, for a radio it knows (SkyConnect, ZBT-1, the nRF52840 dongle).
 */
export const serialClaimSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('integration'),
    vendorId: z.string().regex(VENDOR_ID_PATTERN),
    vendorName: z.string().max(128),

    /** The driver it would be added as; null when the rule names none. */
    driverKind: integrationKindIdSchema.nullable(),
    model: z.string().max(128).nullable(),
  }),
  z.object({
    kind: z.literal('broker'),
    broker: z.enum(SERIAL_BROKER_HOLDERS),

    /** What the broker recognises it as: `Home Assistant SkyConnect`. */
    model: z.string().max(128).nullable(),
  }),
]);

/** Who would take a port. */
export type SerialClaim = z.output<typeof serialClaimSchema>;

/** One port the server sees, or one the owner added on the network. */
export const serialPortSchema = z.object({
  id: z.uuid(),
  kind: z.enum(SERIAL_PORT_KINDS),

  /** From the USB strings, the owner's for a network port, or the path when there are none. */
  name: z.string().max(256),

  /** The path that stays: `/dev/serial/by-id/usb-…-if00-port0`, a `/dev` path, `tcp://host:port`. */
  path: z.string().max(512),

  /** The kernel's name for it now: `/dev/ttyUSB0`; null for a network port, or one unplugged. */
  devicePath: z.string().max(256).nullable(),
  usb: serialUsbSchema.nullable(),
  network: serialNetworkAddressSchema.nullable(),

  /** Who holds it; null while it is free. Kept while it is unplugged, so it comes back. */
  holder: serialHolderSchema.nullable(),

  /** How its holder speaks it; null while it is free. */
  line: serialLineSchema.nullable(),

  /** Plugged in, or reachable on the network. */
  isConnected: z.boolean(),
  isIgnored: z.boolean(),

  /** Who would take it, those whose rules match first; what Suggested and Use with… offer. */
  claims: z.array(serialClaimSchema).max(32),
  lastSeenAt: timestampSchema.nullable(),
});

/** One port. */
export type SerialPort = z.output<typeof serialPortSchema>;

/** Every port: the plugged-in ones first, then by name. */
export const serialPortsReplySchema = z.object({ items: z.array(serialPortSchema) });

/** The owner's settings. */
export const serialSettingsSchema = z.object({
  /** Whether built-in `ttyS*` ports are listed: most are not wired to anything. */
  showBuiltin: z.boolean().default(false),
});

/** The owner's settings. */
export type SerialSettings = z.output<typeof serialSettingsSchema>;

/** Two or more devices whose config names the same port, only one of which holds it. */
export const serialConflictSchema = z.object({
  portId: z.uuid(),

  /** The port's short name: `ttyUSB0`. */
  name: z.string().max(256),
  wantedBy: z
    .array(z.object({ deviceId: integrationIdSchema, name: z.string().max(256) }))
    .min(2)
    .max(32),
});

/** Where the broker stands, as the Brokers page and the health cards show it. */
export const serialStatusSchema = z.object({
  state: z.enum(BROKER_STATES),
  error: z.string().max(2048).nullable(),
  access: z.enum(SERIAL_ACCESS_STATES),
  ports: z.object({ seen: z.int().min(0), inUse: z.int().min(0) }),

  /** Whether plugging and unplugging is followed, and when a port last came or went. */
  hotplug: z.object({ isWatching: z.boolean(), lastChangeAt: timestampSchema.nullable() }),
  conflicts: z.array(serialConflictSchema).max(64),
  settings: serialSettingsSchema,

  /** The devices reached through a port, and how many of them run: the Brokers card's count. */
  devices: z.object({ total: z.int().min(0), online: z.int().min(0) }),
});

/** Where the broker stands. */
export type SerialStatus = z.output<typeof serialStatusSchema>;

/** A device of the house reached through a port. */
export const serialDeviceSchema = z.object({
  deviceId: integrationIdSchema,
  name: z.string().max(256),
  vendorId: z.string().regex(VENDOR_ID_PATTERN),
  areaId: z.uuid().nullable(),
  portId: z.uuid(),

  /** The port's name, as its row shows it. */
  portName: z.string().max(256),
  line: serialLineSchema,
  isOnline: z.boolean(),
});

/** A device reached through a port. */
export type SerialDevice = z.output<typeof serialDeviceSchema>;

/** Every device reached through a port. */
export const serialDevicesReplySchema = z.object({ items: z.array(serialDeviceSchema) });

/** Names a port. */
export const serialPortIdRequestSchema = z.object({ portId: z.uuid() });

/** Ignores a port, or stops ignoring it. */
export const serialIgnoreRequestSchema = z.object({ portId: z.uuid(), isIgnored: z.boolean() });

/** Saves a port on the network: a new one has no id. */
export const serialNetworkPortSaveRequestSchema = serialNetworkAddressSchema.extend({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(128),
});

/** A port on the network to save. */
export type SerialNetworkPortSaveRequest = z.output<typeof serialNetworkPortSaveRequestSchema>;

/** Whether a port on the network answered the socket, how fast, or why not. */
export const serialNetworkPortTestReplySchema = z.object({
  isConnected: z.boolean(),
  ms: z.int().min(0).nullable(),
  error: z.string().max(512).nullable(),
});

/** Whether there was such a port, and it is gone. */
export const serialForgetReplySchema = z.object({ isRemoved: z.boolean() });

/** Opens the console on a free port, spoken as the owner set it. */
export const serialConsoleOpenRequestSchema = z.object({
  portId: z.uuid(),
  line: serialLineSchema,
});

/** The console the owner opened. */
export const serialConsoleSchema = z.object({
  consoleId: z.string().min(1).max(64),
  portId: z.uuid(),
  line: serialLineSchema,
  openedAt: timestampSchema,
});

/** The console the owner opened. */
export type SerialConsole = z.output<typeof serialConsoleSchema>;

/** Bytes as the console carries them: lower-case hex, two digits a byte. */
const hexBytesSchema = z
  .string()
  .max(16_384)
  .regex(/^(?:[0-9a-fA-F]{2})*$/u, 'Hex, two digits a byte')
  .transform((hex) => hex.toLowerCase());

/** Reads what the console's port said and was sent after a cursor; from the oldest kept without. */
export const serialConsoleReadRequestSchema = z.object({
  consoleId: z.string().min(1).max(64),
  after: z.int().min(0).optional(),
});

/** One chunk the console's port said, or was sent. */
export const serialConsoleChunkSchema = z.object({
  /** Counts up from the console's opening: the cursor a next read hands back. */
  seq: z.int().min(0),
  at: timestampSchema,
  direction: z.enum(['in', 'out']),
  data: hexBytesSchema,
});

/** One chunk the console's port said, or was sent. */
export type SerialConsoleChunk = z.output<typeof serialConsoleChunkSchema>;

/**
 * What the console's port said and was sent after the cursor, oldest first.
 *
 * shortcut: polled by the page, move to the websocket topic if latency matters.
 */
export const serialConsoleReadReplySchema = z.object({
  chunks: z.array(serialConsoleChunkSchema).max(4096),

  /** The last chunk's `seq`, handed back as `after`; the one asked with when nothing came. */
  cursor: z.int().min(0),

  /** Whether chunks after the cursor were dropped from the ring before they were read. */
  isTruncated: z.boolean(),

  /** False once the port went away or the console was closed. */
  isOpen: z.boolean(),

  /** Why the port went away, in a sentence; null while it is open. */
  error: z.string().max(512).nullable(),
});

/** Sends bytes through the console, and the line ending after them. */
export const serialConsoleWriteRequestSchema = z.object({
  consoleId: z.string().min(1).max(64),
  data: hexBytesSchema,
  lineEnding: z.enum(SERIAL_LINE_ENDINGS).default('none'),
});

/** How many bytes went out, the line ending included. */
export const serialConsoleWriteReplySchema = z.object({ bytes: z.int().min(0) });

/** Closes the console. */
export const serialConsoleCloseRequestSchema = z.object({
  consoleId: z.string().min(1).max(64),
});

/** Whether there was such a console, and it is closed. */
export const serialConsoleCloseReplySchema = z.object({ isClosed: z.boolean() });
