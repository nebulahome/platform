/**
 * `@nebulahome/package-sdk/testing`: a context with no platform behind it, so a package's
 * `start` runs in a unit test and every effect is recorded (PACKAGES_DOCS.md 9).
 *
 * It behaves as the platform does where a test can tell: settings with their defaults, live
 * changes and restarts, entity ids, a second command handler refused, method and service inputs
 * checked by their schemas, reserved service names refused.
 */
import type { CapabilityCommand, CustomValue, ReportedCapabilityState } from '../capabilities.js';
import type {
  ArgsOf,
  CommandsOf,
  EntityTypeDefinition,
  ValuesOf,
} from '../definitions/entity-type.js';
import type { SettingsDefinition } from '../definitions/settings.js';
import type { EntityDomain, EntityId } from '../entities.js';
import type { StateHistoryPoint, TelemetryPoint, TelemetryResolution } from '../history.js';
import type { JsonObject, JsonValue } from '../json.js';
import type { Schema } from '../schema.js';
import type {
  Awaitable,
  CustomCommand,
  CustomEntities,
  DeviceInput,
  EntityFilter,
  EntitySnapshot,
  HistoryAnswer,
  HistoryRead,
  Logger,
  ReportOptions,
  RpcAccess,
  RpcCall,
  RpcCaller,
  ServerContext,
  ServerSettings,
  ServiceCall,
  SettingsChange,
  StateChange,
  SyncResult,
  Unsubscribe,
} from '../server/context.js';
import { SDK_VERSION } from '../version.js';

import { check } from './schema.js';

/** What a test context starts with. */
export type TestContextOptions<TSettings extends SettingsDefinition | undefined> = {
  /** The package's id: `test-package` when not said. */
  readonly id?: string;

  /** The release: `0.0.0` when not said. */
  readonly version?: string;

  /** The package's settings declaration, whose defaults apply. */
  readonly definition?: TSettings;

  /** What the owner saved. */
  readonly settings?: JsonObject;

  /** Entities of the house `ctx.entities` reads. */
  readonly entities?: readonly EntitySnapshot[];

  /** The past `ctx.history` reads, by entity: points in any order. */
  readonly history?: Readonly<Record<string, RecordedHistory>>;

  readonly dataDir?: string;
  readonly cacheDir?: string;
};

/** One entity's past, as a test gives it. */
export type RecordedHistory = {
  readonly states?: readonly StateHistoryPoint[];
  readonly telemetry?: readonly TelemetryPoint[];
};

/** One report the package made. */
export type RecordedReport = {
  readonly entityId: EntityId;
  readonly state: ReportedCapabilityState;
  readonly options?: ReportOptions;
};

/** One line the package logged. */
export type RecordedLog = {
  readonly level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly fields: Readonly<Record<string, unknown>>;
  readonly message: string | undefined;
};

/** A context with no platform behind it, and what the package did with it. */
export type TestContext<TSettings extends SettingsDefinition | undefined> = {
  /** The context to hand `start`. */
  readonly ctx: ServerContext<TSettings>;

  /** The last list `devices.sync` was given. */
  readonly synced: () => readonly DeviceInput[] | undefined;

  readonly reports: {
    /** Every report, in order. */
    readonly all: readonly RecordedReport[];

    /**
     * The newest state reported for one entity.
     *
     * @param entityId - The entity.
     * @returns Its state, or undefined when it was never reported.
     */
    readonly last: (entityId: EntityId) => ReportedCapabilityState | undefined;
  };

  /** Every line logged. */
  readonly logs: readonly RecordedLog[];

  /**
   * Routes a command as the platform would: to the entity type's handler for a custom one, to
   * `devices.onCommand` otherwise.
   *
   * @param command - The command.
   * @returns Once handled; rejects with the handler's failure.
   */
  readonly sendCommand: (command: CapabilityCommand) => Promise<void>;

  /**
   * Calls one of the package's methods, through its input schema.
   *
   * @param method - The method.
   * @param input - What it is handed.
   * @param caller - Who calls; a test user when not said.
   * @returns What it answered.
   */
  readonly callRpc: (
    method: string,
    input?: JsonValue,
    caller?: RpcCaller,
  ) => Promise<JsonValue | undefined>;

  /**
   * Calls one of the services the package provides.
   *
   * @param name - The service.
   * @param input - What it is handed.
   * @param caller - The calling package's id; `test` when not said.
   * @returns What it answered.
   */
  readonly callService: (
    name: string,
    input?: unknown,
    caller?: string,
  ) => Promise<JsonValue | undefined>;

  /**
   * Changes settings as the owner would: when every field changed is live, the process hears
   * it; otherwise the platform would restart it, which the test does if it wants to.
   *
   * @param patch - What changes.
   * @returns Whether the platform would restart the package.
   */
  readonly changeSettings: (patch: JsonObject) => Promise<{ readonly isRestart: boolean }>;

  /**
   * Puts an entity of the house where `ctx.entities` reads it.
   *
   * @param snapshot - The entity.
   */
  readonly setEntity: (snapshot: EntitySnapshot) => void;

  /**
   * Changes an entity of the house, as `ctx.entities.subscribe` hears it.
   *
   * @param change - The change.
   * @returns Once every handler ran.
   */
  readonly emitStateChange: (change: StateChange) => Promise<void>;

  /**
   * Gives an entity a past, where `ctx.history` reads it.
   *
   * @param entityId - The entity.
   * @param history - Its changes and readings, in any order.
   */
  readonly setHistory: (entityId: EntityId, history: RecordedHistory) => void;

  /**
   * Answers a service the package calls.
   *
   * @param target - The package or service called.
   * @param name - The service.
   * @param handler - What it answers.
   */
  readonly answerService: (
    target: string,
    name: string,
    handler: (input: JsonValue | undefined) => Awaitable<unknown>,
  ) => void;

  /** Asks the package to stop: aborts `ctx.signal`. */
  readonly stop: () => void;
};

/** The most entities and points one read of the past takes, as the platform has it. */
const HISTORY_MAX_ENTITIES = 64;
const HISTORY_MAX_POINTS = 10_000;

/** An hour and a day, in milliseconds. */
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The resolution the platform reads a window at when a read leaves it to it.
 *
 * @param spanMs - How long the window is.
 * @returns Raw up to an hour, minutes up to 30 hours, hours up to 80 days, days beyond.
 */
function resolutionFor(spanMs: number): TelemetryResolution {
  if (spanMs <= HOUR_MS) {
    return 'raw';
  }

  if (spanMs <= 30 * HOUR_MS) {
    return '1m';
  }

  return spanMs <= 80 * DAY_MS ? '1h' : '1d';
}

/**
 * Reads a window of points as the platform does: checked, oldest first, the newest kept.
 *
 * @param read - Which entities, which window, how many points each.
 * @param pointsOf - An entity's points, in any order.
 * @returns Each entity's points in the window, and which lost their oldest.
 * @throws {Error} When the read names no entity or too many, or its window is backwards.
 */
function readWindow<TPoint extends { readonly time: string }>(
  read: HistoryRead,
  pointsOf: (entityId: EntityId) => readonly TPoint[],
): HistoryAnswer<TPoint> {
  const from = new Date(read.from).getTime();
  const to = new Date(read.to).getTime();
  const limit = read.limit ?? HISTORY_MAX_POINTS;

  if (read.entityIds.length === 0 || read.entityIds.length > HISTORY_MAX_ENTITIES) {
    throw new Error(`A read of the past names 1 to ${String(HISTORY_MAX_ENTITIES)} entities`);
  }

  if (!(from < to)) {
    throw new Error('The window starts at or after it ends');
  }

  const series: Record<EntityId, readonly TPoint[]> = {};
  const truncated: EntityId[] = [];

  for (const entityId of read.entityIds) {
    const inWindow = pointsOf(entityId)
      .filter((point) => {
        const time = new Date(point.time).getTime();

        return time >= from && time < to;
      })
      .toSorted((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    series[entityId] = inWindow.slice(Math.max(0, inWindow.length - limit));

    if (inWindow.length > limit) {
      truncated.push(entityId);
    }
  }

  return { series, truncated };
}

/** Service names the platform keeps for itself. */
const RESERVED_SERVICES = new Set(['command', 'rpc', 'settings', 'health', 'events', 'info']);

/** Who calls a method when a test does not say. */
const TEST_CALLER: RpcCaller = { userId: 'test-user', username: 'test', role: 'owner' };

/**
 * Says whether a value is a record.
 *
 * @param value - The value.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Says whether a value is one a custom entity's field holds.
 *
 * @param value - The value.
 * @returns True for a string, a number, a boolean or null.
 */
function isCustomValue(value: unknown): value is CustomValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * The fields of a settings declaration, by key.
 *
 * @param definition - The declaration.
 * @returns Each field, as a record.
 */
function fieldsOf(definition: unknown): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  const fields = isRecord(definition) && isRecord(definition['fields']) ? definition['fields'] : {};

  return new Map(
    Object.entries(fields).flatMap(([key, field]): [string, Readonly<Record<string, unknown>>][] =>
      isRecord(field) ? [[key, field]] : [],
    ),
  );
}

/**
 * Builds a context with no platform behind it.
 *
 * @param options - Its id, settings and the house it reads.
 * @returns The context, and what the package does with it.
 */
export function createTestContext<TSettings extends SettingsDefinition | undefined = undefined>(
  options: TestContextOptions<TSettings> = {},
): TestContext<TSettings> {
  const id = options.id ?? 'test-package';
  const prefix = `${id.replaceAll('-', '_')}_`;
  const fields = fieldsOf(options.definition);
  const defaults = Object.fromEntries(
    [...fields].flatMap(([key, field]): [string, unknown][] =>
      field['default'] === undefined ? [] : [[key, field['default']]],
    ),
  );
  let values: Readonly<Record<string, unknown>> = { ...defaults, ...options.settings };
  const abort = new AbortController();
  const reports: RecordedReport[] = [];
  const logs: RecordedLog[] = [];
  const entities = new Map((options.entities ?? []).map((each) => [each.entityId, each]));
  const histories = new Map<string, RecordedHistory>(Object.entries(options.history ?? {}));
  const methods = new Map<
    string,
    {
      readonly input: Schema<unknown> | undefined;
      readonly handler: (input: unknown, call: RpcCall) => Awaitable<JsonValue | undefined>;
    }
  >();
  const services = new Map<
    string,
    {
      readonly input: Schema<unknown> | undefined;
      readonly handler: (input: unknown, call: ServiceCall) => Awaitable<JsonValue | undefined>;
    }
  >();
  const answers = new Map<string, (input: JsonValue | undefined) => Awaitable<unknown>>();
  const customHandlers = new Map<
    string,
    (command: CustomCommand<Readonly<Record<string, CustomValue>>>) => Awaitable<void>
  >();
  const settingsHandlers = new Set<
    (change: SettingsChange<ServerSettings<TSettings>>) => Awaitable<void>
  >();
  const subscriptions = new Set<{
    readonly filter: EntityFilter;
    readonly handler: (change: StateChange) => Awaitable<void>;
  }>();
  let commandHandler: ((command: CapabilityCommand) => Awaitable<void>) | undefined;
  let synced: readonly DeviceInput[] | undefined;

  /**
   * Says whether the settings, as recorded, are the server's: whatever its declaration types
   * them as, the test vouches for them.
   *
   * @param value - The settings.
   * @returns True for a record.
   */
  const isSettings = (value: unknown): value is ServerSettings<TSettings> => isRecord(value);

  /**
   * The settings, as the server reads them.
   *
   * @returns Them.
   * @throws {Error} Never: they are always a record.
   */
  const settingsNow = (): ServerSettings<TSettings> => {
    if (!isSettings(values)) {
      throw new Error('The settings are not a record');
    }

    return values;
  };

  /**
   * A logger that records each line, with the fields of its parents.
   *
   * @param bound - The fields every line carries.
   * @returns The logger.
   */
  const loggerWith = (bound: Readonly<Record<string, unknown>>): Logger => {
    /**
     * One log method.
     *
     * @param level - Its level.
     * @returns The method.
     */
    const method =
      (level: RecordedLog['level']) =>
      (first: object | string, message?: string): void => {
        logs.push(
          typeof first === 'string'
            ? { level, fields: bound, message: first }
            : { level, fields: { ...bound, ...first }, message },
        );
      };

    return {
      trace: method('trace'),
      debug: method('debug'),
      info: method('info'),
      warn: method('warn'),
      error: method('error'),
      fatal: method('fatal'),
      /**
       * A logger whose lines carry more fields.
       *
       * @param more - The fields it adds.
       * @returns The logger.
       */
      child: (more) => loggerWith({ ...bound, ...more }),
    };
  };

  /**
   * The object id of one of the package's entities.
   *
   * @param entityId - The entity.
   * @returns What follows the prefix, or undefined for anyone else's.
   */
  const objectIdOf = (entityId: string): string | undefined => {
    const objectId = entityId.split('.')[1];

    return objectId?.startsWith(prefix) === true ? objectId.slice(prefix.length) : undefined;
  };

  /**
   * Says whether an entity is one a filter names.
   *
   * @param filter - The filter.
   * @param entityId - The entity.
   * @returns True when it is.
   */
  const matches = (filter: EntityFilter, entityId: EntityId): boolean =>
    (filter.domain === undefined || entityId.startsWith(`${filter.domain}.`)) &&
    (filter.entityIds === undefined || filter.entityIds.includes(entityId));

  /**
   * Registers a method of the package's interface.
   *
   * @param name - The method.
   * @param method - Who may call it, and what it takes.
   * @param method.access - Who may call it.
   * @param method.input - What checks its input, if anything.
   * @param handler - What it does.
   * @throws {Error} When the name is taken.
   */
  function rpcMethod<TInput = JsonValue | undefined>(
    name: string,
    method: { readonly access: RpcAccess; readonly input?: Schema<TInput> },
    handler: (input: TInput, call: RpcCall) => Awaitable<JsonValue | undefined>,
  ): void {
    /**
     * Says whether an input is the method's: its schema checked it, or it is the JSON the
     * interface sent to a method that takes any.
     *
     * @param input - The input.
     * @returns True.
     */
    const isInput = (input: unknown): input is TInput => input === input;

    if (methods.has(name)) {
      throw new Error(`The method ${name} is registered already`);
    }

    methods.set(name, {
      input: method.input,

      /**
       * Hands the method its input, once checked.
       *
       * @param input - The input.
       * @param call - Who calls.
       * @returns What the method answers.
       * @throws {Error} Never: every input is the method's.
       */
      handler: (input, call) => {
        if (!isInput(input)) {
          throw new Error(`${name} was handed what it does not take`);
        }

        return handler(input, call);
      },
    });
  }

  /**
   * Offers a service.
   *
   * @param name - The service.
   * @param serviceOrHandler - What it takes, or what it answers.
   * @param handler - What it answers, after its schema.
   * @throws {Error} When the name is reserved or taken, or there is no handler.
   */
  function provide<TInput = unknown>(
    name: string,
    serviceOrHandler:
      | { readonly input: Schema<TInput> }
      | ((input: TInput, call: ServiceCall) => Awaitable<JsonValue | undefined>),
    handler?: (input: TInput, call: ServiceCall) => Awaitable<JsonValue | undefined>,
  ): void {
    /**
     * Says whether an input is the service's: its schema checked it, or it takes any.
     *
     * @param input - The input.
     * @returns True.
     */
    const isInput = (input: unknown): input is TInput => input === input;
    const answer = typeof serviceOrHandler === 'function' ? serviceOrHandler : handler;

    if (RESERVED_SERVICES.has(name) || name.startsWith('_')) {
      throw new Error(`${name} is a name the platform keeps for itself`);
    }

    if (services.has(name)) {
      throw new Error(`The service ${name} is provided already`);
    }

    if (answer === undefined) {
      throw new Error(`The service ${name} has no handler`);
    }

    services.set(name, {
      input: typeof serviceOrHandler === 'function' ? undefined : serviceOrHandler.input,

      /**
       * Hands the service its input, once checked.
       *
       * @param input - The input.
       * @param call - Who calls.
       * @returns What the service answers.
       * @throws {Error} Never: every input is the service's.
       */
      handler: (input, call) => {
        if (!isInput(input)) {
          throw new Error(`${name} was handed what it does not take`);
        }

        return answer(input, call);
      },
    });
  }

  /**
   * Calls a service.
   *
   * @param target - The package or service.
   * @param name - The service.
   * @param input - What it is handed.
   * @param call - How long it may take.
   * @param call.timeoutMs - In milliseconds.
   * @returns What it answered.
   */
  function callService(
    target: string,
    name: string,
    input?: JsonValue,
    call?: { readonly timeoutMs?: number },
  ): Promise<unknown>;
  /**
   * Calls a service, checking its answer.
   *
   * @param target - The package or service.
   * @param name - The service.
   * @param input - What it is handed.
   * @param call - How long it may take, and what it answers.
   * @param call.timeoutMs - In milliseconds.
   * @param call.output - What checks the answer.
   * @returns What it answered.
   */
  function callService<TOutput>(
    target: string,
    name: string,
    input: JsonValue,
    call: { readonly timeoutMs?: number; readonly output: Schema<TOutput> },
  ): Promise<TOutput>;
  /**
   * Calls a service.
   *
   * @param target - The package or service.
   * @param name - The service.
   * @param input - What it is handed.
   * @param call - What it answers.
   * @param call.timeoutMs - In milliseconds.
   * @param call.output - What checks the answer.
   * @returns What it answered.
   * @throws {Error} When nothing answers it, or the answer is not what was asked.
   */
  async function callService(
    target: string,
    name: string,
    input?: JsonValue,
    call?: { readonly timeoutMs?: number; readonly output?: Schema<unknown> },
  ): Promise<unknown> {
    const answer = answers.get(`${target}.${name}`);

    if (answer === undefined) {
      throw new Error(`Nothing answers ${target}.${name}: answer it with answerService`);
    }

    const value = await answer(input);

    if (call?.output === undefined) {
      return value;
    }

    const checked = await check(call.output, value);

    if (!checked.isValid) {
      throw new Error(`${target}.${name} answered what was not asked: ${checked.message}`);
    }

    return checked.value;
  }

  const ctx: ServerContext<TSettings> = {
    id,
    version: options.version ?? '0.0.0',
    platform: { version: '0.0.0-test' },
    sdk: { version: SDK_VERSION },
    /**
     * The settings as they stand.
     *
     * @returns Them.
     */
    get settings() {
      return settingsNow();
    },
    /**
     * Hears live changes of the settings.
     *
     * @param handler - What hears them.
     * @returns What stops it hearing.
     */
    onSettingsChange: (handler) => {
      settingsHandlers.add(handler);

      return () => {
        settingsHandlers.delete(handler);
      };
    },
    dataDir: options.dataDir ?? `/tmp/${id}/data`,
    cacheDir: options.cacheDir ?? `/tmp/${id}/cache`,
    signal: abort.signal,
    logger: loggerWith({}),
    /**
     * One of the package's entities' ids.
     *
     * @param domain - Its domain.
     * @param objectId - What follows the prefix.
     * @returns The id.
     */
    entityId: (domain: EntityDomain, objectId: string) => `${domain}.${prefix}${objectId}`,
    objectIdOf,
    devices: {
      /**
       * Records the devices, and answers as the platform would.
       *
       * @param devices - Every device.
       * @returns What was written.
       */
      sync: async (devices): Promise<SyncResult> => {
        synced = devices;

        return Promise.resolve({
          devices: devices.map((device) => ({
            deviceId: `device-${device.externalId}`,
            externalId: device.externalId,
            entityIds: device.entities.map(
              (entity) =>
                `${'type' in entity ? 'custom' : entity.domain}.${prefix}${entity.objectId}`,
            ),
          })),
          refused: [],
          kept: [],
        });
      },
      /**
       * Records a report.
       *
       * @param entityId - The entity.
       * @param state - Its state.
       * @param reportOptions - Its attributes and availability.
       */
      report: (entityId, state, reportOptions) => {
        reports.push({
          entityId,
          state,
          ...(reportOptions === undefined ? {} : { options: reportOptions }),
        });
      },
      /**
       * Takes the handler of commands.
       *
       * @param handler - The handler.
       * @returns What removes it.
       * @throws {Error} When there is one already.
       */
      onCommand: (handler) => {
        if (commandHandler !== undefined) {
          throw new Error('devices.onCommand has a handler already');
        }

        commandHandler = handler;

        return () => {
          commandHandler = undefined;
        };
      },
    },
    /**
     * The entities of one of the package's entity types.
     *
     * @param type - The entity type.
     * @returns Their ids, reports and commands.
     */
    custom: <TType extends EntityTypeDefinition>(type: TType): CustomEntities<TType> => ({
      /**
       * The id of one of its entities of this type.
       *
       * @param objectId - What follows the prefix.
       * @returns The id.
       */
      entityId: (objectId) => `custom.${prefix}${objectId}`,
      /**
       * Records a report of an entity's values.
       *
       * @param entityId - The entity.
       * @param entityValues - Its values.
       * @param reportOptions - Its attributes and availability.
       */
      report: (entityId, entityValues: Partial<ValuesOf<TType>>, reportOptions) => {
        reports.push({
          entityId,
          state: {
            custom: {
              values: Object.fromEntries(
                Object.entries(entityValues).filter((entry): entry is [string, CustomValue] =>
                  isCustomValue(entry[1]),
                ),
              ),
            },
          },
          ...(reportOptions === undefined ? {} : { options: reportOptions }),
        });
      },
      /**
       * Takes the handler of one of the type's commands.
       *
       * @param command - The command's id.
       * @param handler - The handler.
       * @returns What removes it.
       * @throws {Error} When the command has one already.
       */
      onCommand: <TCommand extends CommandsOf<TType>>(
        command: TCommand,
        handler: (call: CustomCommand<ArgsOf<TType, TCommand>>) => Awaitable<void>,
      ): Unsubscribe => {
        const key = `${type.id}:${command}`;

        /**
         * Says whether a command's arguments are its own: the platform checked them against
         * the entity type before routing it.
         *
         * @param args - The arguments.
         * @returns True for a record.
         */
        const isArgs = (args: unknown): args is ArgsOf<TType, TCommand> => isRecord(args);

        if (customHandlers.has(key)) {
          throw new Error(`${type.id} has a handler for ${command} already`);
        }

        customHandlers.set(key, (call) => {
          if (!isArgs(call.args)) {
            throw new Error(`${command} was sent without arguments`);
          }

          return handler({ entityId: call.entityId, objectId: call.objectId, args: call.args });
        });

        return () => {
          customHandlers.delete(key);
        };
      },
    }),
    entities: {
      /**
       * One entity of the house.
       *
       * @param entityId - The entity.
       * @returns It, or undefined.
       */
      get: async (entityId) => Promise.resolve(entities.get(entityId)),
      /**
       * The entities a filter names.
       *
       * @param filter - Which.
       * @returns Them.
       */
      list: async (filter = {}) =>
        Promise.resolve([...entities.values()].filter((each) => matches(filter, each.entityId))),
      /**
       * Hears changes of the entities a filter names.
       *
       * @param filter - Which.
       * @param handler - What hears them.
       * @returns What stops it hearing.
       */
      subscribe: (filter, handler) => {
        const subscription = { filter, handler };

        subscriptions.add(subscription);

        return () => {
          subscriptions.delete(subscription);
        };
      },
    },
    history: {
      /**
       * The changes of some entities in a window.
       *
       * @param read - Which, when, how many.
       * @returns Them, oldest first.
       */
      states: async (read) =>
        Promise.resolve(readWindow(read, (entityId) => histories.get(entityId)?.states ?? [])),
      /**
       * The readings of some entities in a window, as given: a test gives the buckets it wants.
       *
       * @param read - Which, when, how many, at which resolution.
       * @returns Them, oldest first, and the resolution.
       */
      telemetry: async (read) => {
        const span = new Date(read.to).getTime() - new Date(read.from).getTime();
        const resolution =
          read.resolution === undefined || read.resolution === 'auto'
            ? resolutionFor(span)
            : read.resolution;

        return Promise.resolve({
          ...readWindow(read, (entityId) => histories.get(entityId)?.telemetry ?? []),
          resolution,
        });
      },
    },
    rpc: { method: rpcMethod },
    services: { provide, call: callService },
  };

  return {
    ctx,
    /**
     * The last list of devices.
     *
     * @returns It.
     */
    synced: () => synced,
    reports: {
      all: reports,
      /**
       * The newest state of one entity.
       *
       * @param entityId - The entity.
       * @returns Its state.
       */
      last: (entityId) => reports.findLast((each) => each.entityId === entityId)?.state,
    },
    logs,
    /**
     * Routes a command.
     *
     * @param command - The command.
     * @throws {Error} When nothing handles it.
     */
    sendCommand: async (command) => {
      if (command.capability === 'custom') {
        const objectId = objectIdOf(command.entityId) ?? '';
        const entity = synced
          ?.flatMap((device) => device.entities)
          .find((each) => 'type' in each && each.objectId === objectId);
        const typeId = entity !== undefined && 'type' in entity ? entity.type.id : undefined;
        const handler = customHandlers.get(`${typeId ?? ''}:${command.command.command}`);

        if (handler !== undefined) {
          await handler({ entityId: command.entityId, objectId, args: command.command.args });

          return;
        }
      }

      if (commandHandler === undefined) {
        throw new Error(`Nothing handles commands to ${command.entityId}`);
      }

      await commandHandler(command);
    },
    /**
     * Calls a method.
     *
     * @param method - The method.
     * @param input - What it is handed.
     * @param caller - Who calls.
     * @returns What it answered.
     * @throws {Error} When there is no such method, or it refuses the input.
     */
    callRpc: async (method, input, caller = TEST_CALLER) => {
      const registered = methods.get(method);

      if (registered === undefined) {
        throw new Error(`There is no method ${method}`);
      }

      if (registered.input === undefined) {
        return registered.handler(input, { caller });
      }

      const checked = await check(registered.input, input);

      if (!checked.isValid) {
        throw new Error(`${method} refused its input: ${checked.message}`);
      }

      return registered.handler(checked.value, { caller });
    },
    /**
     * Calls a service the package provides.
     *
     * @param name - The service.
     * @param input - What it is handed.
     * @param caller - Who calls.
     * @returns What it answered.
     * @throws {Error} When there is no such service, or it refuses the input.
     */
    callService: async (name, input, caller = 'test') => {
      const service = services.get(name);

      if (service === undefined) {
        throw new Error(`The package provides no service ${name}`);
      }

      if (service.input === undefined) {
        return service.handler(input, { caller });
      }

      const checked = await check(service.input, input);

      if (!checked.isValid) {
        throw new Error(`${name} refused its input: ${checked.message}`);
      }

      return service.handler(checked.value, { caller });
    },
    /**
     * Changes settings.
     *
     * @param patch - What changes.
     * @returns Whether the platform would restart the package.
     */
    changeSettings: async (patch) => {
      const changed = Object.keys(patch).filter((key) => patch[key] !== values[key]);

      values = { ...values, ...patch };

      if (changed.some((key) => fields.get(key)?.['isLive'] !== true)) {
        return { isRestart: true };
      }

      /**
       * Says whether the keys changed are the settings': they are the patch's own.
       *
       * @param keys - The keys.
       * @returns True.
       */
      const areKeys = (
        keys: readonly string[],
      ): keys is readonly (keyof ServerSettings<TSettings> & string)[] => Array.isArray(keys);

      if (areKeys(changed)) {
        for (const handler of settingsHandlers) {
          // eslint-disable-next-line no-await-in-loop -- handlers run in the order they came
          await handler({ values: settingsNow(), changed });
        }
      }

      return { isRestart: false };
    },
    /**
     * Puts an entity of the house.
     *
     * @param snapshot - The entity.
     */
    setEntity: (snapshot) => {
      entities.set(snapshot.entityId, snapshot);
    },
    /**
     * Gives an entity a past.
     *
     * @param entityId - The entity.
     * @param history - Its changes and readings.
     */
    setHistory: (entityId, history) => {
      histories.set(entityId, history);
    },
    /**
     * Changes an entity of the house.
     *
     * @param change - The change.
     */
    emitStateChange: async (change) => {
      entities.set(change.entityId, change.current);

      for (const subscription of subscriptions) {
        if (matches(subscription.filter, change.entityId)) {
          // eslint-disable-next-line no-await-in-loop -- handlers run in the order they came
          await subscription.handler(change);
        }
      }
    },
    /**
     * Answers a service the package calls.
     *
     * @param target - The package or service.
     * @param name - The service.
     * @param handler - What it answers.
     */
    answerService: (target, name, handler) => {
      answers.set(`${target}.${name}`, handler);
    },
    /**
     * Asks the package to stop.
     */
    stop: () => {
      abort.abort();
    },
  };
}
