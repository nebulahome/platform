import { C as CapabilityName, S as JsonObject, _ as ReportedState, a as LoadedListenSource, b as TransportSubscription, c as SightingIdentity, d as ManagedUdpSocketOptions, f as PlatformServices, g as Integration, h as DeviceDescriptor, i as LoadedDiscovery, m as Claim, n as LoadedAccount, o as LoadedVendor, p as UdpPeer, r as LoadedBundle, s as Association, t as BundleFailure, u as BundleSdk, v as Discovered, w as CapabilityState, x as EntityId, y as TransportRequest } from "./chunks/node-index.js";
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
/** What a test builds a fake SDK with. */
type FakeSdkOptions = {
  /** What the platform runs that the bundle may use: no broker when not said. */
  readonly platform?: PlatformServices;
  /** Pieces of the SDK the test supplies itself: `openMqtt`, `openWebSocket`, `codecs`… */
  readonly overrides?: Partial<Omit<BundleSdk, 'version' | 'z'>>;
};
/** A fake SDK, and what the bundle did with it. */
type FakeSdk = {
  readonly sdk: BundleSdk;
  /** What the bundle logged, in order. */
  readonly logs: readonly LogRecord[];
  /** The UDP sockets the bundle opened, in order. */
  readonly udpSockets: readonly FakeUdpSocket[];
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
export type { Association, BundleFailure, DriverHarness, DriverHarnessOptions, FakeSdk, FakeSdkOptions, FakeUdpSocket, HarnessDevice, Identification, LoadIntegrationOptions, LoadedAccount, LoadedBundle, LoadedDiscovery, LoadedIntegration, LoadedListenSource, LoadedVendor, LogLevel, LogRecord, SentDatagram, SightingIdentity };