import { A as CapabilityName, C as TransportRequest, D as BluetoothAdvert, E as EntityId, O as BluetoothAdvertInput, S as Discovered, T as SerialLine, _ as UdpPeer, a as LoadedListenSource, b as Integration, c as SightingIdentity, d as BundleSdk, f as ManagedSocketClose, g as PlatformServices, h as ManagedUdpSocketOptions, i as LoadedDiscovery, j as CapabilityState, k as JsonObject, m as ManagedSocketOptions, n as LoadedAccount, o as LoadedVendor, p as ManagedSocketHeaders, r as LoadedBundle, s as Association, t as BundleFailure, u as BluetoothScannerOptions, v as Claim, w as TransportSubscription, x as ReportedState, y as DeviceDescriptor } from "./chunks/node-index.js";
//#region src/testing/fake-sdk.d.ts
/** The levels a bundle may log at. */
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
/** One line a bundle logged. */
type LogRecord = {
  readonly level: LogLevel;
  /** Its fields, a child logger's among them. */
  readonly fields: Readonly<Record<string, unknown>>;
  readonly message: string | undefined;
};
/** A datagram a bundle sent. */
type SentDatagram = {
  readonly message: Buffer;
  readonly port: number;
  readonly address: string;
};
/** A UDP socket a bundle opened through the fake SDK. */
type FakeUdpSocket = {
  /** What it was opened with: the port, the group, `onMessage`. */
  readonly options: ManagedUdpSocketOptions;
  readonly port: number;
  /** What the bundle sent through it, in order. */
  readonly sent: readonly SentDatagram[];
  /** Whether the bundle, or the release, closed it. */
  readonly isClosed: boolean;
  /**
   * Hands the bundle a datagram, as if it arrived.
   *
   * @param message - What arrived.
   * @param from - Who sent it; `192.0.2.1:4000` when not said.
   */
  deliver: (message: Buffer | string, from?: UdpPeer) => void;
};
/** A WebSocket a bundle opened through the fake SDK. */
type FakeWebSocket = {
  /** What it was opened with: the URL, the headers, the ping, the callbacks. */
  readonly options: ManagedSocketOptions;
  readonly url: string;
  /** The headers of the last opening: a function's answer, once `open` has called it. */
  readonly headers: ManagedSocketHeaders | undefined;
  /** What the bundle sent through it, in order, across every connection. */
  readonly sent: readonly string[];
  /** The reasons the bundle reset it for, in order. */
  readonly resets: readonly string[];
  /** Whether a frame can be sent now. */
  readonly isOpen: boolean;
  /** Whether the bundle, or the release, closed it for good. */
  readonly isClosed: boolean;
  /**
   * Opens it - or opens it again after a drop or a reset, as the hub's reconnection would: reads
   * the headers, a function's answer awaited, then calls `onOpen`.
   *
   * @throws {Error} When it is open already, or closed for good.
   */
  open: () => Promise<void>;
  /**
   * Hands the bundle a text frame, as if it arrived.
   *
   * @throws {Error} When it is not open.
   */
  deliver: (text: string) => void;
  /**
   * Ends the connection - or refuses an attempt to make one - as the network or the server
   * would, and tells the bundle: `drop('connection not accepted (HTTP 401 Unauthorized)',
   * { code: 1006, status: 401 })` is a handshake the server turned down.
   *
   * @throws {Error} When it is closed for good.
   */
  drop: (reason: string, details?: ManagedSocketClose) => void;
};
/** A serial port a bundle opened through the fake SDK. */
type FakeSerialPort = {
  readonly portId: string;
  /** The line it was opened at, the defaults filled in: `9600 8N1` unless said. */
  readonly line: SerialLine;
  /** What the bundle wrote, a buffer a write, in order. */
  readonly written: readonly Buffer[];
  /** Whether the bundle closed it, the test unplugged it, or the release let go of it. */
  readonly isClosed: boolean;
  /**
   * Hands the bundle bytes, as if the port read them: one chunk, as a port reads one.
   *
   * @throws {Error} When the port is closed.
   */
  feed: (bytes: Uint8Array | string) => void;
  /**
   * Takes the port away, as unplugging it or the owner taking it back would, and tells the
   * bundle why; its writes then fail with `SerialClosed`.
   *
   * @param reason - Why; `Unplugged` when not said.
   */
  unplug: (reason?: string) => void;
};
/** A Bluetooth proxy's scanner a bundle opened through the fake SDK. */
type FakeBluetoothScanner = {
  /** Which proxy reports: its connection's key and its device key. */
  readonly options: BluetoothScannerOptions;
  /** Every report, as the bundle made it, an empty one too: that is the proxy saying it is alive. */
  readonly reports: readonly (readonly BluetoothAdvertInput[])[];
  /**
   * The advertisements the house keeps of those, read as the broker reads them: 1024 a report at
   * most, one that does not hold dropped, addresses upper case and hex lower case.
   *
   * shortcut: a 128-bit UUID on the Bluetooth base stays as reported, where the hub shortens it to
   * 16 bits; shorten it here too if a vendor's test ever reads one.
   */
  readonly adverts: readonly BluetoothAdvert[];
  /** Whether the bundle closed it, or opened another for the same proxy. */
  readonly isClosed: boolean;
};
/** What a test builds a fake SDK with. */
type FakeSdkOptions = {
  /** What the platform runs that the bundle may use: no broker when not said. */
  readonly platform?: PlatformServices;
  /** Pieces of the SDK the test supplies itself: `openMqtt`, `openRtsp`, `codecs`… */
  readonly overrides?: Partial<Omit<BundleSdk, 'version' | 'z'>>;
};
/** A fake SDK, and what the bundle did with it. */
type FakeSdk = {
  readonly sdk: BundleSdk;
  /** What the bundle logged, in order. */
  readonly logs: readonly LogRecord[];
  /** The UDP sockets the bundle opened, in order. */
  readonly udpSockets: readonly FakeUdpSocket[];
  /** The WebSockets the bundle opened, in order; none is open until the test opens it. */
  readonly webSockets: readonly FakeWebSocket[];
  /** The serial ports the bundle opened, in order. */
  readonly serialPorts: readonly FakeSerialPort[];
  /** The Bluetooth scanners the bundle opened, in order. */
  readonly bluetoothScanners: readonly FakeBluetoothScanner[];
  /**
   * Closes every socket the bundle left open, as the hub does when it lets go of a vendor.
   *
   * @returns Once they are closed.
   */
  release: () => Promise<void>;
};
/**
 * Builds a fake SDK.
 *
 * @param options - The platform's services, and the pieces the test supplies.
 * @returns The SDK, and what the bundle does with it.
 */
export declare function createFakeSdk(options?: FakeSdkOptions): FakeSdk;
//#endregion
//#region src/testing/harness.d.ts
/** What the harness is set up with. */
type DriverHarnessOptions = {
  /** The instance's options, as the owner set them; checked against the driver's schema. */
  readonly options?: JsonObject;
  /** The device's id, which its entities' identifiers are made from: `device` when not said. */
  readonly deviceId?: string;
  /** The connection a message arrives on, as the transport would key it. */
  readonly connectionKey?: string;
};
/** A device added through the harness. */
type HarnessDevice = {
  readonly claim: Claim;
  /** What the driver said the device is. */
  readonly device: DeviceDescriptor;
  /** Each entity's identifier, by its descriptor's `objectId` - `''` for a device's only one. */
  readonly entities: ReadonlyMap<string, EntityId>;
  /** The identifiers, in the descriptor's order. */
  readonly entityIds: readonly EntityId[];
};
/** A driver, driven. */
type DriverHarness = {
  readonly integration: Integration;
  /** The instance's options, checked. */
  readonly options: JsonObject;
  /**
   * Asks the driver whether a device is its own.
   *
   * @param discovered - What a scan or a probe found.
   * @returns The claim, or null.
   */
  claim: (discovered: Discovered) => Claim | null;
  /**
   * Claims a device and describes it: what adding it does.
   *
   * @param discovered - What a scan or a probe found.
   * @returns The device, its entities named.
   * @throws {Error} When the driver does not claim it.
   */
  add: (discovered: Discovered) => HarnessDevice;
  /**
   * What the transport must carry for the devices added.
   *
   * @returns The subscriptions.
   */
  subscriptions: () => TransportSubscription[];
  /**
   * Hands the driver a message from a device added, as the transport would.
   *
   * @param payload - What arrived.
   * @param deviceKey - Which device; the one added last when not said.
   * @returns The reports, each entity's last state kept.
   */
  receive: (payload: unknown, deviceKey?: string) => ReportedState[];
  /**
   * Turns a command into the request the transport would perform.
   *
   * @param entityId - The entity.
   * @param capability - The capability.
   * @param command - The command, as `core` validated it.
   * @returns The request.
   */
  command: (entityId: string, capability: CapabilityName, command?: JsonObject) => TransportRequest;
  /**
   * The last state an entity reported.
   *
   * @param entityId - The entity.
   * @returns Its state, or undefined before it reported.
   */
  lastState: (entityId: string) => CapabilityState | undefined;
};
/**
 * Sets a driver up to be driven.
 *
 * @param driver - A driver of an integration loaded with `loadIntegration`, or an integration.
 * @param settings - The instance's options, the device's id, the connection.
 * @returns The harness.
 */
export declare function driverHarness(driver: LoadedBundle | Integration, settings?: DriverHarnessOptions): DriverHarness;
//#endregion
//#region src/testing/identify.d.ts
/** What discovery made of what it heard. */
type Identification = {
  /** Whether the announcement is the vendor's: every `match` condition holds. */
  readonly matches: boolean;
  /** Who the device says it is, by the paths of `identity`. */
  readonly identity: SightingIdentity;
  /** The driver and the model it names; null when no driver takes the device. */
  readonly association: Association | null;
};
/**
 * Says what discovery makes of a device heard.
 *
 * @param vendor - The vendor, loaded with `loadIntegration`.
 * @param heard - What was heard: the announcement `match` reads, and the probe's answer that
 * `identity` and the drivers' claims read - the announcement itself for a vendor without a probe.
 * @param heard.announcement - The announcement: an mDNS record, what a listener reported.
 * @param heard.probed - The probe's answer, for a vendor that probes; the announcement when not
 * said.
 * @param heard.deviceKey - How the device is reached, for the drivers' claims: `192.0.2.10` when
 * not said.
 * @returns What discovery makes of it.
 * @throws {Error} When the vendor has no discovery that loaded.
 */
export declare function identify(vendor: LoadedVendor, heard: {
  readonly announcement: unknown;
  readonly probed?: unknown;
  readonly deviceKey?: string;
}): Identification;
/** What discovery makes of one of the house's Matter devices. */
type MatterIdentification = {
  /** Whether the vendor's `matter` rules take it: every condition holds. */
  readonly matches: boolean;
  /** The Matter driver and the model it names; null when no driver takes the device. */
  readonly association: Association | null;
};
/**
 * Says what discovery makes of one of the house's Matter devices, by the vendor's `matter` rules.
 * A device that another vendor's rules take too is the platform's own instead, which one vendor's
 * test cannot see.
 *
 * @param vendor - The vendor, loaded with `loadIntegration`.
 * @param identity - Who the device says it is: `vendorId`, `productId`, `vendorName`,
 * `isBridged` and the rest of the fields FILES.md lists; a field left out is one it does not say.
 * @returns What discovery makes of it.
 * @throws {Error} When the vendor has no discovery that loaded.
 */
export declare function identifyMatter(vendor: LoadedVendor, identity: Readonly<Record<string, unknown>>): MatterIdentification;
/** What discovery makes of one of the devices the house's MQTT broker hears. */
type MqttIdentification = {
  /** Whether the vendor's `mqtt` rules take it: every condition holds. */
  readonly matches: boolean;
  /** The MQTT driver and the model it names; null when no driver takes the device. */
  readonly association: Association | null;
};
/**
 * Says what discovery makes of one of the devices the house's MQTT broker hears - one that
 * announced itself, or one the owner mapped - by the vendor's `mqtt` rules. A device that another
 * vendor's rules take too is the platform's own instead, which one vendor's test cannot see.
 *
 * @param vendor - The vendor, loaded with `loadIntegration`.
 * @param identity - Who the device says it is: `manufacturer`, `model`, `originName`,
 * `identifiers` and the rest of the fields FILES.md lists; a field left out is one it does not say.
 * @returns What discovery makes of it.
 * @throws {Error} When the vendor has no discovery that loaded.
 */
export declare function identifyMqtt(vendor: LoadedVendor, identity: Readonly<Record<string, unknown>>): MqttIdentification;
/** What discovery makes of one of the Modbus servers the house's network search found. */
type ModbusIdentification = {
  /** Whether the vendor's `modbus` rules take it: every condition holds. */
  readonly matches: boolean;
  /** The Modbus driver and the model it names; null when no driver takes the server. */
  readonly association: Association | null;
};
/**
 * Says what discovery makes of one of the Modbus servers the network search found, by the
 * vendor's `modbus` rules. The test says what the server answered to each value the block reads:
 * the platform reads them through the house's Modbus client and matches the rules on
 * `values.<name>`, `host`, `port` and `unitId`.
 *
 * @param vendor - The vendor, loaded with `loadIntegration`.
 * @param identity - The server: `{ host, port, unitId, values: { serial: 'H34A10I1234567' } }`.
 * @returns What discovery makes of it.
 * @throws {Error} When the vendor has no discovery that loaded.
 */
export declare function identifyModbus(vendor: LoadedVendor, identity: Readonly<Record<string, unknown>>): ModbusIdentification;
/** What discovery makes of one of the serial ports the server sees. */
type SerialIdentification = {
  /** Whether the vendor's `serial` rules take it: every condition holds. */
  readonly matches: boolean;
  /** The `serial` driver and the model it names; null when no driver takes the port. */
  readonly association: Association | null;
};
/**
 * Says what discovery makes of one of the serial ports the server sees, by the vendor's `serial`
 * rules: whether the Serial broker suggests it for the vendor - "Use with …?" - and as which of its
 * drivers of kind `serial`. A port is never added on its own: the owner says which device it is.
 *
 * @param vendor - The vendor, loaded with `loadIntegration`.
 * @param usb - What the port's USB adapter says it is: `{ vendorId: '10c4', productId: 'ea60',
 * manufacturer, product, serialNumber }`, the ids four lower-case hex digits; a field left out is
 * one it does not say.
 * @returns What discovery makes of it.
 * @throws {Error} When the vendor has no discovery that loaded.
 */
export declare function identifySerial(vendor: LoadedVendor, usb: Readonly<Record<string, unknown>>): SerialIdentification;
/** What discovery makes of one of the devices the house's Bluetooth hears. */
type BluetoothIdentification = {
  /** Whether the vendor's `bluetooth` rules take it: every condition holds. */
  readonly matches: boolean;
  /** The driver on the `bluetooth` transport and the model it names; null when none takes it. */
  readonly association: Association | null;
};
/**
 * Says what discovery makes of one advertisement the house's Bluetooth heard - from the server's
 * adapter or a proxy - by the vendor's `bluetooth` rules: whether the device is listed as found for
 * the vendor, and as which of its drivers on the `bluetooth` transport. The owner adds it.
 *
 * @param vendor - The vendor, loaded with `loadIntegration`.
 * @param advert - The advertisement, as the house keeps it: `address` upper case, `name`,
 * `manufacturerData` by decimal company id, `serviceData` and `serviceUuids` lower case, a 16-bit
 * UUID short (`fcd2`), every value hex in lower case; a field left out is one it does not carry.
 * @returns What discovery makes of it.
 * @throws {Error} When the vendor has no discovery that loaded.
 */
export declare function identifyBluetooth(vendor: LoadedVendor, advert: Readonly<Record<string, unknown>>): BluetoothIdentification;
//#endregion
//#region src/testing/load.d.ts
/** What loading takes. */
type LoadIntegrationOptions = {
  /** The repository's folder; the working directory when not said. */
  readonly root?: string;
  /** Which tree: the sources in `src/` (the default), or the build in `dist/`. */
  readonly from?: 'source' | 'build';
  /** The fake SDK the code is handed, or what to build one with; a new one when not said. */
  readonly sdk?: FakeSdk | FakeSdkOptions;
};
/** An integration, loaded. */
type LoadedIntegration = {
  /** The vendor, as `hub` holds it: its drivers, its transports, its discovery. */
  readonly vendor: LoadedVendor;
  /** The drivers, and the `discovery.json`, that did not load: `hub` loads the rest without them. */
  readonly failures: readonly BundleFailure[];
  /** The SDK its code was handed, and what the code did with it. */
  readonly fake: FakeSdk;
  /**
   * One driver.
   *
   * @param driverId - Its folder's name.
   * @returns The driver.
   * @throws {Error} When it is not one that loaded.
   */
  driver: (driverId: string) => LoadedBundle;
  /**
   * Lets go of what the integration's code opened, as `hub` does when it lets go of a vendor.
   *
   * @returns Once it is let go of.
   */
  release: () => Promise<void>;
};
/**
 * Loads an integration as `hub` would.
 *
 * @param options - The repository, which tree, and the fake SDK.
 * @returns The vendor and its drivers, loaded.
 * @throws {IntegrationError} When the vendor does not load at all, with why.
 */
export declare function loadIntegration(options?: LoadIntegrationOptions): Promise<LoadedIntegration>;
//#endregion
//#region src/project.d.ts
/** Every problem found, each a sentence: what the command prints, one per line. */
export declare class IntegrationError extends Error {
  readonly problems: readonly string[];
  /**
   * Makes the error.
   *
   * @param problems - Each problem, in a sentence.
   */
  constructor(problems: readonly string[]);
}
//#endregion
export type { Association, BluetoothIdentification, BundleFailure, DriverHarness, DriverHarnessOptions, FakeBluetoothScanner, FakeSdk, FakeSdkOptions, FakeSerialPort, FakeUdpSocket, FakeWebSocket, HarnessDevice, Identification, LoadIntegrationOptions, LoadedAccount, LoadedBundle, LoadedDiscovery, LoadedIntegration, LoadedListenSource, LoadedVendor, LogLevel, LogRecord, MatterIdentification, ModbusIdentification, MqttIdentification, SentDatagram, SerialIdentification, SightingIdentity };