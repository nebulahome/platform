/**
 * What a bundle's own code is handed, so that it imports nothing from the platform.
 *
 * A bundle that ships a transport is written against the same contract the platform's own
 * transports are - {@link defineTransport} and the types beside it - but it cannot `import`
 * them: an installed bundle has no `node_modules` of the platform's, and a copy of zod of its
 * own would validate under a different instance than the hub checks against. So the hub hands
 * the pieces over at load, as one object, and the module's default export is a function of it.
 *
 * The managed socket is here for the same reason the transport layer exists: without it every
 * vendor speaking WebSocket would grow its own reconnection, and one of them would have the bug
 * the others do not. The hub owns the socket; the bundle owns what goes through it.
 *
 * The UDP socket is here for the protocols that are datagrams - a Govee light answering a
 * multicast scan, a Broadlink blaster - and for the same reason: the hub binds it, joins the group
 * and closes it when the vendor is unloaded, so a bundle cannot leave a port held behind it.
 *
 * A serial port and a Bluetooth proxy's scanner go through the hub's brokers in the same spirit: a
 * port has exactly one holder, which only the Serial broker can tell, and what a proxy hears is the
 * whole house's, which only the Bluetooth broker puts together.
 */
import type { z } from 'zod';

import type { BluetoothAdvertInput, SerialLineInput } from '@nebulahome/contracts';

import type { defineAccount } from './account.js';
import type { Integration } from './integration.js';
import type { defineStreamSource, OpenRtsp, StreamSource } from './stream.js';
import type { defineTransport, Transport } from './transport.js';

/**
 * One level of a bundle's log: fields and a message, or a message alone - pino's way, which is the
 * logger `hub` hands over.
 */
export type BundleLogFn = {
  (fields: object, message?: string): void;
  (message: string): void;
};

/**
 * The hub's logger, as far as a bundle's code may use it: named here rather than as the platform's
 * logger type, so that what a bundle is written against says nothing of how the platform logs.
 */
export type BundleLogger = {
  readonly trace: BundleLogFn;
  readonly debug: BundleLogFn;
  readonly info: BundleLogFn;
  readonly warn: BundleLogFn;
  readonly error: BundleLogFn;
  readonly fatal: BundleLogFn;

  /**
   * A logger whose every line carries these fields too.
   *
   * @param fields - The fields.
   * @returns The logger.
   */
  child: (fields: Record<string, unknown>) => BundleLogger;
};

/** HTTP headers for a WebSocket's opening handshake. */
export type ManagedSocketHeaders = Readonly<Record<string, string>>;

/** What a drop says beyond its reason. */
export type ManagedSocketClose = {
  /** The WebSocket close code: the peer's, or 1006 for a socket that ended without one. */
  readonly code?: number;

  /**
   * The HTTP status of a handshake the server refused - 401, 403 - so that credentials it turned
   * down can be told from a network that failed. Absent for any other drop.
   */
  readonly status?: number;
};

/** What opening a managed WebSocket takes. */
export type ManagedSocketOptions = {
  /** `ws://host/path` or `wss://…`. */
  readonly url: string;

  /**
   * Headers sent on the opening handshake, the first and every reconnect's, for a
   * server that authenticates the socket by them. Never logged. A function is called before each
   * attempt and may answer with a promise - for a token that expires; one that throws fails that
   * attempt as a refused connection would, and the next comes on the usual schedule.
   */
  readonly headers?:
    ManagedSocketHeaders | (() => ManagedSocketHeaders | Promise<ManagedSocketHeaders>);

  /**
   * A ping every `everyMs`, and the socket dropped - then reconnected - when no pong
   * comes within `timeoutMs`. For a peer that may say nothing for hours, whose silence would
   * otherwise hide a dead connection. Off unless said.
   */
  readonly ping?: { readonly everyMs: number; readonly timeoutMs: number };

  /**
   * TLS for a `wss://` server: whether its certificate must chain to an authority
   * this machine trusts (on unless said).
   */
  readonly tls?: { readonly rejectUnauthorized?: boolean };

  readonly logger: BundleLogger;

  /** Called after every connection, the first and each one after a drop. */
  readonly onOpen: () => void;

  /** Called with each text frame. */
  readonly onMessage: (text: string) => void;

  /**
   * Called when the socket dropped or failed to connect; the helper reconnects by itself unless
   * the socket is closed here. The hub also says the close code and, for a handshake
   * the server refused, its HTTP status.
   */
  readonly onClose: (reason: string, details?: ManagedSocketClose) => void;

  /**
   * How to come back after a drop: doubling from `minMs` (1 s) to `maxMs` (30 s), reset by a
   * connection that opens. `false` is one attempt and no more, for a probe or a scan.
   */
  readonly reconnect?: { readonly minMs?: number; readonly maxMs?: number } | false;
};

/** A WebSocket the hub keeps open on a bundle's behalf. */
export type ManagedSocket = {
  /** Whether a frame can be sent right now. */
  readonly isOpen: boolean;

  /**
   * Sends one text frame.
   *
   * @throws {Error} When the socket is not open.
   */
  send: (text: string) => void;

  /** Drops the socket so the helper reconnects - after a request that timed out. */
  reset: (reason: string) => void;

  /** Closes for good. */
  close: () => Promise<void>;
};

/** Opens a managed WebSocket. */
export type OpenWebSocket = (options: ManagedSocketOptions) => ManagedSocket;

/** Where a datagram came from. */
export type UdpPeer = {
  readonly address: string;
  readonly port: number;
};

/** What opening a managed UDP socket takes. */
export type ManagedUdpSocketOptions = {
  /** The port to listen on; absent, whatever port the system picks. */
  readonly port?: number;

  /** Whether another socket may bind the same port, as a multicast listener must allow. */
  readonly reuseAddr?: boolean;

  /** A multicast group to join, and whether to hear what this host itself sends to it. */
  readonly multicast?: { readonly group: string; readonly loopback?: boolean };

  /** Whether the socket may send to a broadcast address. */
  readonly broadcast?: boolean;

  /** Called with each datagram, as bytes: some protocols are text and some are not. */
  readonly onMessage: (message: Buffer, from: UdpPeer) => void;

  /** Called when the socket fails after it opened. The hub has logged it already. */
  readonly onError?: (error: Error) => void;
};

/** A UDP socket the hub holds on a bundle's behalf. */
export type ManagedUdpSocket = {
  /** The port it is bound to, known once it has opened. */
  readonly port: number;

  /**
   * Sends one datagram.
   *
   * @throws {Error} When the socket is closed or the send fails.
   */
  send: (message: Buffer | string, port: number, address: string) => Promise<void>;

  /** Closes for good, leaving the group. */
  close: () => Promise<void>;
};

/** Opens a managed UDP socket. */
export type OpenUdpSocket = (options: ManagedUdpSocketOptions) => ManagedUdpSocket;

/** What opening a managed MQTT session takes. */
export type ManagedMqttOptions = {
  /** `mqtt://host:1883`, or `mqtts://host:8883` behind TLS. */
  readonly url: string;

  /** The client id to connect as; one the client makes up when absent. */
  readonly clientId?: string;

  readonly username?: string;
  readonly password?: string;

  /**
   * TLS for an `mqtts://` broker: a client certificate as a PKCS#12 bundle and its passphrase,
   * for a broker that authenticates the client by certificate, and whether the broker's own
   * certificate must chain to an authority this machine trusts (on unless said).
   */
  readonly tls?: {
    readonly pfx?: Buffer;
    readonly passphrase?: string;
    readonly rejectUnauthorized?: boolean;
  };

  readonly logger: BundleLogger;

  /** Called after every connection, the first and each one after a drop. */
  readonly onConnect?: () => void;

  /** Called with each message on a topic subscribed to. */
  readonly onMessage: (topic: string, payload: Buffer) => void;

  /** Called when the session dropped or failed to come up; the helper reconnects by itself. */
  readonly onClose?: (reason: string) => void;
};

/** An MQTT session the hub keeps up on a bundle's behalf. */
export type ManagedMqtt = {
  /** Whether a message can be published right now. */
  readonly isConnected: boolean;

  /** Subscribes, now and after every reconnect, until unsubscribed. */
  subscribe: (topic: string) => void;

  /** Stops hearing a topic. */
  unsubscribe: (topic: string) => void;

  /**
   * Publishes one message, at most once.
   *
   * @throws {Error} When the session is not up.
   */
  publish: (topic: string, payload: string | Buffer) => Promise<void>;

  /** Closes for good. */
  close: () => Promise<void>;
};

/** Opens a managed MQTT session. */
export type OpenMqtt = (options: ManagedMqttOptions) => ManagedMqtt;

/** A Modbus server, as a session to it is opened: where it is, and how frames travel. */
export type ModbusServerOptions = {
  readonly host: string;

  /** 502 unless said. */
  readonly port?: number;

  /** `tcp` (MBAP) unless said; `rtu` for RTU frames a transparent adapter carries over TCP. */
  readonly framing?: 'tcp' | 'rtu';
};

/** One read: a run of coils, inputs or registers of one unit. */
export type ModbusReadOptions = {
  readonly unitId: number;
  readonly function: 1 | 2 | 3 | 4;
  readonly address: number;

  /** How many bits or registers, 1 to 125. */
  readonly count: number;

  /** How long to wait for the answer; 3 s unless said. */
  readonly timeoutMs?: number;
};

/** One write: a coil, a register, coils or registers of one unit. */
export type ModbusWriteOptions = {
  readonly unitId: number;
  readonly function: 5 | 6 | 15 | 16;
  readonly address: number;

  /** The word for 05 (0xFF00 on, 0 off) and 06; the bits for 15; the registers for 16. */
  readonly values: readonly number[];
  readonly timeoutMs?: number;
};

/**
 * A session to a Modbus server through the hub's one connection to it: requests of every
 * session to the same server wait their turn, so a gateway that answers one client at a time is
 * never asked twice at once.
 *
 * A failed request rejects with an error whose `name` says why: `ModbusException` - the server
 * refused, its `code` the exception - `ModbusNoConnection` or `ModbusSilence`.
 */
export type ModbusSession = {
  /**
   * Reads bits or registers.
   *
   * @returns One number per bit (0 or 1) or register (a 16-bit word).
   */
  read: (options: ModbusReadOptions, signal?: AbortSignal) => Promise<number[]>;

  /** Writes a coil, a register, coils or registers. */
  write: (options: ModbusWriteOptions, signal?: AbortSignal) => Promise<void>;

  /** Lets go of the server; the connection closes once nothing else holds it. */
  close: () => Promise<void>;
};

/** Opens a session to a Modbus server. */
export type OpenModbus = (server: ModbusServerOptions) => ModbusSession;

/**
 * A serial port held through the Serial broker, which gives every port exactly one holder: bytes
 * as they come, and bytes to send.
 *
 * Once the port is gone - unplugged, closed by the owner from the Brokers page - `onClose` is
 * called and nothing more arrives; a write then rejects with an error whose `name` is
 * `SerialClosed`.
 */
export type SerialSession = {
  /**
   * Sends bytes, resolving once the port took them.
   *
   * @throws {Error} `SerialClosed` once the session is closed.
   */
  write: (bytes: Uint8Array) => Promise<void>;

  /**
   * Hears every chunk the port reads, in order, as it arrives: a chunk is not a message, so a
   * protocol framed by lines or lengths puts the chunks together itself.
   *
   * @returns Stops hearing.
   */
  onData: (listener: (bytes: Uint8Array) => void) => () => void;

  /**
   * Hears the port go: unplugged, taken back by the owner, or closed here. Called once.
   *
   * @returns Stops hearing.
   */
  onClose: (listener: (reason: string) => void) => () => void;

  /** Lets go of the port, so another holder may open it. */
  close: () => Promise<void>;
};

/**
 * Opens a serial port the device holds - the `portId` and `line` its config's `serial` block
 * carries, as the owner picked them when adding it - through the Serial broker.
 *
 * Rejects with an error whose `name` says why: `SerialPortHeld` - another device, a broker, the
 * console or a container holds it - or `SerialPortMissing` - no such port, or it is not plugged in.
 */
export type OpenSerial = (portId: string, line: SerialLineInput) => Promise<SerialSession>;

/** Which proxy is reporting: the device it is, as its connection names it. */
export type BluetoothScannerOptions = {
  /** The connection the proxy is reached over: its transport's connection key. */
  readonly key: string;

  /** The proxy itself, as that connection names its devices. */
  readonly deviceKey: string;
};

/**
 * A Bluetooth proxy's channel to the Bluetooth broker: what it hears goes in here, and the house
 * sees it as heard by that proxy.
 */
export type BluetoothScanner = {
  /**
   * Reports advertisements heard - addresses, how loud, what each carries. The broker checks each
   * and drops one that does not hold; reporting the same one again is how a proxy says it still
   * hears it.
   */
  report: (adverts: readonly BluetoothAdvertInput[]) => void;

  /** Stops reporting: the proxy is no longer one, or its connection went. */
  close: () => void;
};

/** The house's Bluetooth, as a vendor whose devices can be proxies reaches it. */
export type BundleBluetooth = {
  /**
   * Opens a proxy's scanner, for a device whose profile declares `bluetoothProxy`. One per proxy:
   * opening it again replaces the first.
   */
  readonly scanner: (options: BluetoothScannerOptions) => BluetoothScanner;
};

/**
 * The house's MQTT broker, as the hub reaches it: the one the hub runs, with the hub's own
 * username - or the broker `NEBULA_MQTT_URL` names. Read again each time it is needed: a session
 * opened while the broker is still coming up retries until it listens.
 */
export type PlatformMqtt = {
  readonly url: string;
  readonly username?: string;
  readonly password?: string;
};

/** What the platform offers a bundle beyond the pieces to build a transport from. */
export type PlatformServices = {
  /**
   * The house's broker, for a vendor whose devices report through it - zigbee2mqtt - and which
   * runs its own program beside the platform. Null only while the hub cannot run one.
   */
  readonly mqtt: PlatformMqtt | null;
};

/** One colour of a palette: red, green, blue and, optionally, how opaque, each 0 to 255. */
export type PaletteColour =
  readonly [number, number, number] | readonly [number, number, number, number];

/** A picture of a few colours: a robot's map, one palette index per cell. */
export type PalettedPicture = {
  readonly width: number;
  readonly height: number;

  /** At most 256 colours. */
  readonly palette: readonly PaletteColour[];

  /** One index into the palette per pixel, row after row from the top left. */
  readonly pixels: Uint8Array;
};

/** What a bundle drawing a picture needs, and could not bring as a dependency. */
export type BundleCodecs = {
  /**
   * Unpacks an LZMA stream in the alone format (`.lzma`): a 13-byte header - the properties and
   * the size, eight bytes of ones when unknown - then the stream. ECOVACS packs its maps so.
   *
   * @throws {Error} When the stream is corrupt.
   */
  readonly lzma: (bytes: Uint8Array) => Buffer;
};

/** Pictures a bundle draws, for an image entity. */
export type BundleImages = {
  /**
   * Encodes a paletted picture as a PNG, a colour with an alpha below 255 transparent.
   *
   * @throws {Error} When the size, the palette and the pixels do not fit together.
   */
  readonly png: (picture: PalettedPicture) => Buffer;
};

/** What the hub hands a bundle's transport factory. */
export type BundleSdk = {
  /** The runtime version, the same string `manifest.sdk` was matched against. */
  readonly version: string;

  /** The runtime's zod, so a bundle's schemas validate under the one instance the hub uses. */
  readonly z: typeof z;

  /** The hub's logger, for what happens outside a connection: a probe, a scan. */
  readonly logger: BundleLogger;

  readonly defineTransport: typeof defineTransport;
  readonly openWebSocket: OpenWebSocket;
  readonly openUdpSocket: OpenUdpSocket;

  /** An MQTT session, for a vendor whose devices report through a broker of its own. */
  readonly openMqtt: OpenMqtt;

  /** A session to a Modbus server, through the hub's one connection to it. */
  readonly openModbus: OpenModbus;

  /** A serial port a device of the vendor holds, through the Serial broker. */
  readonly openSerial: OpenSerial;

  /** The house's Bluetooth, for a vendor whose devices are proxies. */
  readonly bluetooth: BundleBluetooth;

  /** How a camera's stream source is written, as defineTransport is for a transport. */
  readonly defineStreamSource: typeof defineStreamSource;

  /** An RTSP session over TCP, yielding a camera's H.264 as it comes. */
  readonly openRtsp: OpenRtsp;

  /** What the platform itself runs that a bundle may use - its MQTT broker. */
  readonly platform: PlatformServices;

  /** How an account's sign-in module is written, as defineTransport is for a transport. */
  readonly defineAccount: typeof defineAccount;

  /** Unpacking what a vendor's cloud packs. */
  readonly codecs: BundleCodecs;

  /** Drawing pictures, for an image entity. */
  readonly images: BundleImages;
};

/**
 * The ops the hub sends a device that plays a role for a broker, over its instance's connection:
 * reserved, so an integration uses these names for nothing else.
 */
export { BLUETOOTH_GATT_OPS, BLUETOOTH_PROXY_OPS, INFRARED_OPS } from '@nebulahome/contracts';

/** What a transport module default-exports. */
export type TransportFactory = (sdk: BundleSdk) => Transport;

/** What a stream module default-exports. */
export type StreamFactory = (sdk: BundleSdk) => StreamSource;

/**
 * What a code driver may default-export instead of an integration - a function of
 * the SDK, so the driver can build its schemas with the runtime's zod rather than bring its own.
 */
export type IntegrationFactory = (sdk: BundleSdk) => Integration;
