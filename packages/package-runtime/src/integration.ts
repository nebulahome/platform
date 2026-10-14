/**
 * The integration layer: what a device means, and nothing about how to reach it.
 *
 * **Every method here is pure.** Given the same inputs they return the same result, they perform
 * no I/O, and they hold no state between calls. That is not a style preference - it is the
 * property that lets a declarative bundle implement this same contract by reading a profile. A
 * mapper allowed to open a socket could never be stood in for by a JSON file, and the whole
 * declarative tier would be permanently "to do".
 *
 * The case that looks like it breaks purity does not. When a command needs the current state -
 * a relative dim, a toggle - it is read from {@link MappingContext}, because `hub` already knows
 * the last state: it is what published it. And an integration that genuinely must ask the device
 * something before answering is telling you its transport is too thin, so the question belongs
 * one layer down.
 */
import type { z } from 'zod';

import type {
  CapabilityName,
  CapabilityState,
  DeclaredCapabilities,
  EntityDomain,
  EntityId,
  EntityStateClass,
  JsonObject,
  StateReport,
} from '@nebulahome/contracts';

import type {
  Discovered,
  TransportInbound,
  TransportRequest,
  TransportSubscription,
} from './transport.js';

/** A device an integration has recognised as its own. */
export type Claim = {
  /** How the transport addresses it. */
  readonly deviceKey: string;

  /** How the integration identifies it, stable across restarts. */
  readonly externalId: string;

  /**
   * What the integration recognised it from, kept for {@link Integration.describe}.
   *
   * Raw. For zigbee2mqtt this is the `exposes` tree, for ESPHome the entity list, for Matter the
   * endpoint and cluster tree. All three are self-describing, which is exactly why `describe`
   * can be a pure function of this and why those integrations cover thousands of devices each.
   */
  readonly descriptor: unknown;
};

/** One entity a device exposes, before `hub` has given it an identifier. */
export type EntityDescriptor = {
  readonly domain: EntityDomain;

  /** Distinguishes it from the device's other entities. Omitted when it is the only one. */
  readonly objectId?: string;

  readonly name: string;

  /** The catalogue icon it starts with, when the bundle names one. */
  readonly icon?: string;
  readonly capabilities: DeclaredCapabilities;
  readonly unitOfMeasurement?: string;
  readonly deviceClass?: string;
  readonly stateClass?: EntityStateClass;
  readonly displayPrecision?: number;
};

/** What a claimed device turns out to be. */
export type DeviceDescriptor = {
  readonly externalId: string;
  readonly name: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly swVersion?: string;
  readonly hwVersion?: string;

  /**
   * The device this one is reached through, named the way this integration names devices.
   *
   * A BLE thermometer reached through an ESPHome proxy names the proxy here. It is what lets the
   * interface answer "why did six things go offline at once" with the one that actually did.
   */
  readonly viaExternalId?: string;

  readonly entities: readonly EntityDescriptor[];
};

/** What a mapper may look at besides its own arguments. */
export type MappingContext = {
  /** The instance's own settings, already validated against the integration's schema. */
  readonly options: JsonObject;

  /** The device being mapped. */
  readonly claim: Claim;

  /** The entity identifiers `hub` gave this device, keyed by descriptor `objectId`. */
  readonly entities: ReadonlyMap<string, EntityId>;

  /**
   * The last state `hub` published for an entity.
   *
   * Present so that a command needing the current value can be built without asking the device.
   * Undefined before the entity has ever reported.
   *
   * @param entityId - The entity to look up.
   * @returns Its last known state, or undefined.
   */
  lastState: (entityId: EntityId) => CapabilityState | undefined;
};

/** A command, resolved to the device and entity it is for. */
export type CommandTarget = {
  readonly entityId: EntityId;
  readonly capability: CapabilityName;

  /** Already validated by `core` against the capability's command schema. */
  readonly command: JsonObject;
};

/**
 * The picture an image entity's report carries beside its state - an SVG, a PNG - which
 * the hub keeps and never publishes: the state says which picture it is (`revision`), and the
 * bytes are asked for by whoever shows it.
 */
export type ImageBlob = {
  readonly contentType: 'image/svg+xml' | 'image/png' | 'image/jpeg';

  /** The picture: an SVG's text, or bytes. */
  readonly data: string | Buffer;

  /** How often at most a new picture of the entity is announced; 2 s unless said. */
  readonly minIntervalMs?: number;
};

/** A report as an integration makes it: the state, and the picture of an image entity. */
export type ReportedState = StateReport & { readonly blob?: ImageBlob };

/** What a kind of device means, in terms of the canonical model. */
export type Integration<TOptions = JsonObject> = {
  /** The bundle kind: `zigbee2mqtt`, `shelly-gen2`. An instance of it gets its own id. */
  readonly id: string;

  /** Which transport carries it. */
  readonly transport: string;

  /** Validates the settings an owner supplied for an instance. */
  readonly optionsSchema: z.ZodType<TOptions>;

  /**
   * What to tell the transport to look for during a scan.
   *
   * The transport's own vocabulary - an mDNS service name, an MQTT topic filter - and opaque
   * here. An empty object means "whatever you would find anyway", which is what a code
   * integration on a transport that enumerates broadly uses.
   */
  readonly discovery: JsonObject;

  /**
   * Decides whether a discovered device is this integration's to own.
   *
   * @param discovered - What the scan found.
   * @param options - The instance's settings.
   * @returns The claim, or null when the device belongs to someone else.
   */
  claim: (discovered: Discovered, options: TOptions) => Claim | null;

  /**
   * States what the transport must carry for these devices.
   *
   * Data rather than an action: `hub` collects the answers from every instance sharing a
   * connection, deduplicates them, and applies the set once.
   *
   * @param claims - The devices this instance owns.
   * @param options - The instance's settings.
   * @returns Everything the transport should subscribe to or poll.
   */
  subscriptions: (claims: readonly Claim[], options: TOptions) => TransportSubscription[];

  /**
   * Says what a claimed device is and what it exposes.
   *
   * @param claim - The device.
   * @param options - The instance's settings.
   * @returns Its identity and its entities.
   */
  describe: (claim: Claim, options: TOptions) => DeviceDescriptor;

  /**
   * Turns something the device sent into canonical state.
   *
   * @param message - What arrived.
   * @param context - The claim, the settings and the last known state.
   * @returns One report per entity the message says something about, which may be none.
   */
  toState: (message: TransportInbound, context: MappingContext) => ReportedState[];

  /**
   * Turns a canonical command into something the transport can perform.
   *
   * @param target - The entity, the capability and the command.
   * @param context - The claim, the settings and the last known state.
   * @returns The request. Performing it is the transport's job.
   */
  toCommand: (target: CommandTarget, context: MappingContext) => TransportRequest;

  /**
   * Reads what a message says about the device itself, beyond its entities: the firmware it runs
   * now, which changes when it is updated and is otherwise only known from when it was found.
   *
   * Optional: an integration whose messages say nothing of the kind leaves it out.
   *
   * @param message - What arrived.
   * @param context - The claim, the settings and the last known state.
   * @returns What the message says, field by field; undefined, or a field left out, when it says
   * nothing about it.
   */
  deviceInfo?: (message: TransportInbound, context: MappingContext) => DeviceInfo | undefined;

  /**
   * Says how a camera entity's picture is read, when it is one.
   *
   * Optional: an integration with no camera leaves it out.
   *
   * @param entityId - The entity.
   * @param context - The claim, the settings and the last known state.
   * @returns The stream source and what it is told to read, or undefined for an entity with none.
   */
  streamOf?: (entityId: EntityId, context: MappingContext) => StreamRequest | undefined;
};

/** How one camera's picture is read: which source, told what. */
export type StreamRequest = {
  readonly source: string;
  readonly args: JsonObject;
};

/** What a message says about the device itself. */
export type DeviceInfo = {
  readonly swVersion?: string;
  readonly hwVersion?: string;
};
