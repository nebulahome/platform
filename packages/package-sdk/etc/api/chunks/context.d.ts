import { G as CapabilityState, V as CapabilityCommand, X as EntityStateClass, Y as DeclaredCapabilities, a as SettingsOf, ct as EntityDomain, d as EntityTypeDefinition, et as ReportedCapabilityState, f as ValuesOf, i as SettingsDefinition, lt as EntityId, r as JsonValue, s as ArgsOf, t as JsonObject, u as CommandsOf } from "./json.js";
import { a as TelemetryResolution, i as TelemetryPoint, n as HistorySeries, r as StateHistoryPoint } from "./history.js";
//#region src/schema.d.ts
/**
 * What checks a value that crosses into a package - a method's input, a service's answer: any
 * [Standard Schema](https://standardschema.dev) - zod 4, valibot, arktype - or an object with
 * zod's `safeParse`. The SDK carries no validation library of its own.
 *
 * The Standard Schema interface is written out here, as its authors ask libraries to do, rather
 * than taken as a dependency.
 */
/** One problem a Standard Schema found. */
type SchemaIssue = {
  readonly message: string;
  readonly path?: readonly (PropertyKey | {
    readonly key: PropertyKey;
  })[] | undefined;
};
/** What a Standard Schema's `validate` gives back. */
type StandardResult<TOutput> = {
  readonly value: TOutput;
  readonly issues?: undefined;
} | {
  readonly issues: readonly SchemaIssue[];
};
/** The Standard Schema interface, version 1. */
type StandardSchemaV1<TInput = unknown, TOutput = TInput> = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<TOutput> | Promise<StandardResult<TOutput>>;
    readonly types?: {
      readonly input: TInput;
      readonly output: TOutput;
    } | undefined;
  };
};
/** An object that checks a value the way zod's `safeParse` does. */
type SafeParser<TOutput> = {
  readonly safeParse: (value: unknown) => {
    readonly success: true;
    readonly data: TOutput;
  } | {
    readonly success: false;
    readonly error: unknown;
  };
};
/** What the SDK takes to check a value: a Standard Schema, or a `safeParse`. */
type Schema<TOutput> = StandardSchemaV1<unknown, TOutput> | SafeParser<TOutput>;
//#endregion
//#region src/server/context.d.ts
/** A value, or a promise of one. */
type Awaitable<TValue> = TValue | Promise<TValue>;
/** Stops what a registration started: a handler, a subscription. */
type Unsubscribe = () => void;
/** One log method: `(fields, message?)` or `(message)`. */
type LogMethod = {
  (fields: object, message?: string): void;
  (message: string): void;
};
/** The package's logger: its lines are the package's log on its page. */
type Logger = {
  readonly trace: LogMethod;
  readonly debug: LogMethod;
  readonly info: LogMethod;
  readonly warn: LogMethod;
  readonly error: LogMethod;
  readonly fatal: LogMethod;
  /**
   * A logger whose every line carries these fields too.
   *
   * @param fields - What each line adds.
   * @returns The logger.
   */
  readonly child: (fields: Record<string, unknown>) => Logger;
};
/** One entity of a platform capability, as `devices.sync` takes it. */
type CapabilityEntityInput = {
  /** What follows the package's prefix in its id: `temperature` → `sensor.weather_temperature`. */
  readonly objectId: string;
  readonly name: string;
  readonly domain: EntityDomain;
  readonly capabilities: DeclaredCapabilities;
  readonly icon?: string;
  /**
   * The unit the device gives its numbers in. For a sensor of a class the platform knows, the
   * platform registers the class's own unit and converts every number reported - kW to W, °F to
   * °C - so report what the device says, as it says it.
   */
  readonly unitOfMeasurement?: string;
  /**
   * What the number measures: `temperature`, `power`, `energy`. A unit the class cannot be
   * converted from drops the class, and the number is kept as it comes.
   */
  readonly deviceClass?: string;
  /** How its numbers add up; the class's own when not said. */
  readonly stateClass?: EntityStateClass;
  readonly displayPrecision?: number;
};
/** One entity of one of the package's own entity types, as `devices.sync` takes it. */
type CustomEntityInput = {
  readonly objectId: string;
  readonly name: string;
  /** The entity type: its domain is `custom`, its capability the type's. */
  readonly type: EntityTypeDefinition;
  readonly icon?: string;
};
/** One entity, as `devices.sync` takes it. */
type EntityInput = CapabilityEntityInput | CustomEntityInput;
/** One device, as `devices.sync` takes it. */
type DeviceInput = {
  /** Its own id at the package: stable, what finds it again after a restart. */
  readonly externalId: string;
  /** What it starts as called; the owner's name, once given, outlives it. */
  readonly name: string;
  readonly icon?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly swVersion?: string;
  readonly entities: readonly EntityInput[];
};
/** What the platform did with the package's devices. */
type SyncResult = {
  readonly devices: readonly {
    readonly deviceId: string;
    readonly externalId: string;
    readonly entityIds: readonly EntityId[];
  }[];
  /** Entities written by no one, and why: log them. */
  readonly refused: readonly {
    readonly entityId: string;
    readonly reason: string;
  }[];
  /** Devices gone from the list but kept, because an alias reads one of their entities. */
  readonly kept: readonly string[];
};
/** What a report may say besides the state. */
type ReportOptions = {
  /** What no capability covers, as JSON. */
  readonly attributes?: JsonObject;
  /** False while the thing the entity stands for cannot be reached. */
  readonly isAvailable?: boolean;
};
/** One entity of the house, as it stands. */
type EntitySnapshot = {
  readonly entityId: EntityId;
  readonly state: CapabilityState;
  readonly attributes: JsonObject;
  readonly isAvailable: boolean;
  /** When its state last differed, ISO 8601. */
  readonly lastChanged: string;
  /** When it was last reported, ISO 8601. */
  readonly lastUpdated: string;
};
/** A change of an entity's state. */
type StateChange = {
  readonly entityId: EntityId;
  readonly current: EntitySnapshot;
  /** What it was; absent on the first report after the platform started. */
  readonly previous?: EntitySnapshot;
};
/** Which entities: of a domain, or by id. Neither is every entity. */
type EntityFilter = {
  readonly domain?: EntityDomain;
  readonly entityIds?: readonly EntityId[];
};
/** Which entities' past `ctx.history` reads, over which window. Since 1.2. */
type HistoryRead = {
  /** At most 64. */
  readonly entityIds: readonly EntityId[];
  /** Inclusive: a `Date` or ISO 8601. */
  readonly from: Date | string;
  /** Exclusive. */
  readonly to: Date | string;
  /** The most points of one entity, at most 10 000 (the default): the newest are kept. */
  readonly limit?: number;
};
/** Which entities' readings `ctx.history.telemetry` reads: `auto` picks by the window's length. */
type TelemetryRead = HistoryRead & {
  readonly resolution?: TelemetryResolution | 'auto';
};
/** What a read of the past found. */
type HistoryAnswer<TPoint> = {
  /** Each entity's points, oldest first. */
  readonly series: HistorySeries<TPoint>;
  /** The entities whose window held more than the limit: their oldest points are gone. */
  readonly truncated: readonly EntityId[];
};
/** Who may call a method: whoever may read packages, or whoever may configure them. */
type RpcAccess = 'read' | 'configure';
/** Who called a method of the package's interface. */
type RpcCaller = {
  readonly userId: string;
  readonly username: string;
  readonly role: string;
};
/** What a method's handler is told besides its input. */
type RpcCall = {
  readonly caller: RpcCaller;
};
/** What a service's handler is told besides its input. */
type ServiceCall = {
  /** The package or service that called, by its id. */
  readonly caller: string;
};
/** A change of the package's settings that reached the running process. */
type SettingsChange<TValues> = {
  /** Every setting, as it stands now. */
  readonly values: TValues;
  /** The keys that changed. */
  readonly changed: readonly (keyof TValues & string)[];
};
/** The values of the settings a server declared, or plain JSON when it declared none. */
type ServerSettings<TSettings> = [TSettings] extends [SettingsDefinition] ? SettingsOf<TSettings> : JsonObject;
/** A command of one of the package's entity types, as its handler is given it. */
type CustomCommand<TArgs> = {
  readonly entityId: EntityId;
  readonly objectId: string;
  readonly args: TArgs;
};
/** The entities of one of the package's entity types, typed by its declaration. */
type CustomEntities<TType extends EntityTypeDefinition> = {
  /**
   * The id of one of the package's entities of this type.
   *
   * @param objectId - What follows the package's prefix.
   * @returns `custom.<prefix>_<objectId>`.
   */
  readonly entityId: (objectId: string) => EntityId;
  /**
   * Reports some or all of an entity's values; an optional field may be null.
   *
   * @param entityId - The entity.
   * @param values - The values that changed, or all of them.
   * @param options - Its attributes and availability.
   */
  readonly report: (entityId: EntityId, values: Partial<ValuesOf<TType>>, options?: ReportOptions) => void;
  /**
   * Handles one of the type's commands; a throw is the command's failure.
   *
   * @param command - The command's id.
   * @param handler - What it does with the entity and the arguments.
   * @returns What stops the handler.
   * @throws {Error} When the command has a handler already.
   */
  readonly onCommand: <TCommand extends CommandsOf<TType>>(command: TCommand, handler: (command: CustomCommand<ArgsOf<TType, TCommand>>) => Awaitable<void>) => Unsubscribe;
};
/** Registering a method of the package's interface. */
type RpcMethod = {
  (name: string, options: {
    readonly access: RpcAccess;
  }, handler: (input: JsonValue | undefined, call: RpcCall) => Awaitable<JsonValue | undefined>): void;
  <TInput>(name: string, options: {
    readonly access: RpcAccess;
    readonly input: Schema<TInput>;
  }, handler: (input: TInput, call: RpcCall) => Awaitable<JsonValue | undefined>): void;
};
/** How a live message is sent. Since 1.5. */
type LivePublishOptions = {
  /**
   * Kept by the platform, and handed at once to an interface that follows the topic later, until
   * the next retained message on it replaces it: for the state a page draws. Off by default.
   */
  readonly isRetained?: boolean;
};
/** What a live message's handler is told besides the message: who sent it. Since 1.5. */
type LiveCall = {
  readonly caller: RpcCaller;
};
/** Hearing one topic of the package's interfaces' live messages. Since 1.5. */
type LiveOnMessage = {
  (topic: string, handler: (data: JsonValue, call: LiveCall) => Awaitable<void>): Unsubscribe;
  <TInput>(topic: string, options: {
    readonly input: Schema<TInput>;
  }, handler: (data: TInput, call: LiveCall) => Awaitable<void>): Unsubscribe;
};
/** Offering a service. */
type ServiceProvide = {
  (name: string, handler: (input: unknown, call: ServiceCall) => Awaitable<JsonValue | undefined>): void;
  <TInput>(name: string, options: {
    readonly input: Schema<TInput>;
  }, handler: (input: TInput, call: ServiceCall) => Awaitable<JsonValue | undefined>): void;
};
/** Calling a service. */
type ServiceCallFunction = {
  (target: string, name: string, input?: JsonValue, options?: {
    readonly timeoutMs?: number;
  }): Promise<unknown>;
  <TOutput>(target: string, name: string, input: JsonValue, options: {
    readonly timeoutMs?: number;
    readonly output: Schema<TOutput>;
  }): Promise<TOutput>;
};
/** What the platform hands `start`. */
type ServerContext<TSettings = undefined> = {
  /** The package's id. */
  readonly id: string;
  /** The release running. */
  readonly version: string;
  readonly platform: {
    readonly version: string;
  };
  /** The SDK version the platform implements. */
  readonly sdk: {
    readonly version: string;
  };
  /** What the owner saved, defaults applied, secrets open. Current after a live change. */
  readonly settings: ServerSettings<TSettings>;
  /**
   * Hears a change of live settings, which reaches the process instead of restarting it.
   *
   * @param handler - What to do with the settings as they now stand.
   * @returns What stops it hearing.
   */
  readonly onSettingsChange: (handler: (change: SettingsChange<ServerSettings<TSettings>>) => Awaitable<void>) => Unsubscribe;
  /** `packages/<id>/data/`: what it keeps, in every backup. */
  readonly dataDir: string;
  /** `cache/packages/<id>/`: what it can make again, in no backup. */
  readonly cacheDir: string;
  /** Aborted when the package is asked to stop. */
  readonly signal: AbortSignal;
  readonly logger: Logger;
  /**
   * One of its entities' ids.
   *
   * @param domain - The entity's domain.
   * @param objectId - What follows the package's prefix.
   * @returns `<domain>.<prefix>_<objectId>`.
   */
  readonly entityId: (domain: EntityDomain, objectId: string) => EntityId;
  /**
   * The object id of one of its own entities.
   *
   * @param entityId - The entity.
   * @returns What follows the package's prefix, or undefined for anyone else's entity.
   */
  readonly objectIdOf: (entityId: string) => string | undefined;
  readonly devices: {
    /**
     * Registers every device and entity the package has, whole: what is left out is removed.
     *
     * @param devices - Every device, with its entities.
     * @param options - How long the platform has to answer.
     * @param options.timeoutMs - In milliseconds; 15 seconds when not said.
     * @returns What it wrote, and what it refused.
     */
    readonly sync: (devices: readonly DeviceInput[], options?: {
      readonly timeoutMs?: number;
    }) => Promise<SyncResult>;
    /**
     * Reports an entity's state, through the pipeline every report goes through.
     *
     * @param entityId - The entity.
     * @param state - One entry per capability.
     * @param options - Its attributes and availability.
     */
    readonly report: (entityId: EntityId, state: ReportedCapabilityState, options?: ReportOptions) => void;
    /**
     * Handles the commands routed to its entities; a throw is the command's failure.
     *
     * @param handler - What it does with one.
     * @returns What stops the handler.
     * @throws {Error} When there is a handler already.
     */
    readonly onCommand: (handler: (command: CapabilityCommand) => Awaitable<void>) => Unsubscribe;
  };
  /**
   * The entities of one of its entity types, typed.
   *
   * @param type - The entity type.
   * @returns Its entities' ids, reports and commands.
   */
  readonly custom: <TType extends EntityTypeDefinition>(type: TType) => CustomEntities<TType>;
  /** The rest of the house, read only. */
  readonly entities: {
    /**
     * One entity, as it stands.
     *
     * @param entityId - The entity.
     * @returns It, or undefined when there is none.
     */
    readonly get: (entityId: EntityId) => Promise<EntitySnapshot | undefined>;
    /**
     * Every entity, or those of a domain or by id.
     *
     * @param filter - Which.
     * @returns Them.
     */
    readonly list: (filter?: EntityFilter) => Promise<readonly EntitySnapshot[]>;
    /**
     * Hears every change of the entities a filter names.
     *
     * @param filter - Which.
     * @param handler - What to do with a change.
     * @returns What stops it hearing.
     */
    readonly subscribe: (filter: EntityFilter, handler: (change: StateChange) => Awaitable<void>) => Unsubscribe;
  };
  /**
   * The past of the house's entities, read only, with the house's authority as `entities` has.
   * Since 1.2.
   */
  readonly history: {
    /**
     * The recorded changes of some entities over a window.
     *
     * @param read - Which entities, which window, how many points each at most.
     * @returns Each entity's changes, oldest first.
     */
    readonly states: (read: HistoryRead) => Promise<HistoryAnswer<StateHistoryPoint>>;
    /**
     * The numeric readings of some entities over a window, raw or in buckets.
     *
     * @param read - Which entities, which window, which resolution.
     * @returns Each entity's readings, oldest first, and the resolution read.
     */
    readonly telemetry: (read: TelemetryRead) => Promise<HistoryAnswer<TelemetryPoint> & {
      readonly resolution: TelemetryResolution;
    }>;
  };
  readonly rpc: {
    /** Registers a method its interface calls; a name registered twice throws. */
    readonly method: RpcMethod;
  };
  /**
   * The live channel to its open interfaces, over the interface's own socket: no polling, no
   * HTTP rate limit. Whoever may read packages hears it and may send to it. Since 1.5.
   */
  readonly live: {
    /**
     * Sends a message to every open interface following the topic. A topic is a letter, then
     * letters, digits and `.`, `_`, `:`, `-` (128 at most); a message is at most 1 MB as JSON.
     * One that is not is logged, not sent.
     */
    readonly publish: (topic: string, data: JsonValue, options?: LivePublishOptions) => void;
    /**
     * Hears what its interfaces send on a topic (`usePackageSend`); a topic heard twice throws.
     * A message its schema refuses is logged and dropped: nobody waits for an answer.
     */
    readonly onMessage: LiveOnMessage;
  };
  readonly services: {
    /** Answers a service other packages call; a name provided twice, or reserved, throws. */
    readonly provide: ServiceProvide;
    /** Calls another package's or the platform's service. */
    readonly call: ServiceCallFunction;
  };
};
//#endregion
export { TelemetryRead as A, ServerSettings as C, SettingsChange as D, ServiceProvide as E, StandardResult as F, StandardSchemaV1 as I, SafeParser as M, Schema as N, StateChange as O, SchemaIssue as P, ServerContext as S, ServiceCallFunction as T, ReportOptions as _, CustomEntityInput as a, RpcCaller as b, EntityInput as c, HistoryRead as d, LiveCall as f, Logger as g, LogMethod as h, CustomEntities as i, Unsubscribe as j, SyncResult as k, EntitySnapshot as l, LivePublishOptions as m, CapabilityEntityInput as n, DeviceInput as o, LiveOnMessage as p, CustomCommand as r, EntityFilter as s, Awaitable as t, HistoryAnswer as u, RpcAccess as v, ServiceCall as w, RpcMethod as x, RpcCall as y };