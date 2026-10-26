/**
 * The context a package's `start` is handed - the platform's implementation of
 * `@nebulahome/package-sdk`'s `ServerContext` - over a bus client that speaks as the package.
 *
 * Every way it reaches the platform is a bus subject under its id, as every owner's are: the
 * commands `core` routes to its entities arrive on `svc.<id>.command`, its pages' calls on
 * `svc.<id>.rpc`, a live change of its settings on `svc.<id>.settings`, and a service it provides
 * on `svc.<id>.<name>`. What it reports goes on the state subjects stamped with its id, which is
 * what `core` checks a report's owner against. What it reads of the house it asks `core` for.
 *
 * The object below is typed as the SDK's declaration, so the SDK and the platform cannot drift
 * apart without this failing to build.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription, MessageContext } from '@nebulahome/bus';
import {
  ADAPTER_COMMAND_METHOD,
  adapterCommandSchema,
  BUS_PATTERNS,
  busSubjects,
  CORE_HISTORY_STATES_METHOD,
  CORE_HISTORY_TELEMETRY_METHOD,
  CORE_SERVICE,
  CORE_SYNC_PACKAGE_METHOD,
  DeviceUnavailableError,
  entityStateSchema,
  historyStatesReplySchema,
  historyStatesRequestSchema,
  historyTelemetryReplySchema,
  historyTelemetryRequestSchema,
  isPackageServiceAllowed,
  jsonValueSchema,
  NotFoundError,
  PACKAGE_RPC_METHOD,
  PACKAGE_SETTINGS_METHOD,
  packageObjectPrefix,
  packageRpcRequestSchema,
  packageSettingsChangeSchema,
  parseEntityId,
  stateChangedEventSchema,
  stateGetRequestSchema,
  stateSnapshotReplySchema,
  syncPackageReplySchema,
  telemetryResolutionForSpan,
  ValidationError,
  type AdapterAck,
  type EntityState,
  type StateHistoryPoint as PlatformStatePoint,
  type TelemetryPoint as PlatformTelemetryPoint,
  type PackageRpcCaller,
  type PackageRpcMethod,
  type PackageRpcReply,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';
import {
  SDK_VERSION,
  type CapabilityCommand,
  type CapabilityState,
  type CustomValue,
  type EntityTypeDefinition,
  type JsonObject,
  type JsonValue,
} from '@nebulahome/package-sdk';
import type {
  Awaitable,
  CustomCommand,
  CustomEntities,
  DeviceInput,
  EntityFilter,
  EntitySnapshot,
  HistoryRead,
  RpcAccess,
  RpcCall,
  Schema,
  ServerContext,
  ServiceCall,
  SettingsChange,
  StateChange,
  StateHistoryPoint,
  TelemetryPoint,
} from '@nebulahome/package-sdk/server';

import { convertedState, measuredOf, type Measured } from './measurements.js';
import { check } from './schema.js';

/** How long `core` has to take in a package's devices, unless the package says otherwise. */
const SYNC_TIMEOUT_MS = 15_000;

/** Who called a method when nobody says: the platform itself, or a test of it. */
const PLATFORM_CALLER: PackageRpcCaller = {
  userId: 'platform',
  username: 'platform',
  role: 'platform',
};

/** What making a context needs. */
export type PackageContextOptions = {
  /** A bus client whose source is the package's id. */
  readonly client: BusClient;
  readonly id: string;
  readonly version: string;

  /** The platform's version. */
  readonly platformVersion: string;

  /** What the owner saved, defaults applied, secrets opened. */
  readonly settings: JsonObject;

  readonly dataDir: string;
  readonly cacheDir: string;
  readonly logger: PlatformLogger;
  readonly signal: AbortSignal;
};

/** One RPC method, as the context keeps it. */
type Method = {
  readonly access: RpcAccess;
  readonly input: Schema<unknown> | undefined;
  readonly handler: (input: unknown, call: RpcCall) => Awaitable<JsonValue | undefined>;
};

/** One service, as the context keeps it. */
type Service = {
  readonly input: Schema<unknown> | undefined;
  readonly handler: (input: unknown, call: ServiceCall) => Awaitable<JsonValue | undefined>;
};

/** A context, and what the runner does with it besides handing it to `start`. */
export type PackageContextHandle = {
  readonly context: ServerContext;

  /** The methods registered so far, for the announcement. */
  readonly rpcMethods: () => PackageRpcMethod[];

  /** Ends every subscription the context made. */
  readonly close: () => void;
};

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
 * Says whether a command `core` routed is one the SDK types: `core` checked it against the
 * entity's capability, and the SDK's command types are the platform's, field for field.
 *
 * @param value - The command.
 * @returns True for one with an entity, a capability and a command.
 */
function isCapabilityCommand(value: unknown): value is CapabilityCommand {
  return (
    isRecord(value) &&
    typeof value['entityId'] === 'string' &&
    typeof value['capability'] === 'string' &&
    isRecord(value['command'])
  );
}

/**
 * An entity of the house, as the SDK hands it to a package.
 *
 * @param state - The entity, as `core` keeps it.
 * @returns Its snapshot.
 */
function snapshotOf(state: EntityState): EntitySnapshot {
  /**
   * Says whether a state is the SDK's: the platform's, field for field, without the capabilities
   * an entity does not have.
   *
   * @param value - The state.
   * @returns True for a record.
   */
  const isState = (value: unknown): value is CapabilityState => isRecord(value);
  const declared = Object.fromEntries(
    Object.entries(state.state).filter((entry) => entry[1] !== undefined),
  );

  return {
    entityId: state.entityId,
    state: isState(declared) ? declared : {},
    attributes: state.attributes,
    isAvailable: state.isAvailable,
    lastChanged: state.lastChanged.toISOString(),
    lastUpdated: state.lastUpdated.toISOString(),
  };
}

/** How long a read of the past may take before it fails. */
const HISTORY_TIMEOUT_MS = 10_000;

/**
 * A recorded state, as the SDK hands it: the platform's, without the capabilities it lacks.
 *
 * @param state - As history stored it.
 * @returns The state.
 */
function recordedStateOf(state: JsonObject): CapabilityState {
  /**
   * Says whether a recorded state is the SDK's: the platform's, field for field.
   *
   * @param value - The state.
   * @returns True for a record.
   */
  const isState = (value: unknown): value is CapabilityState => isRecord(value);

  return isState(state) ? state : {};
}

/**
 * A change of state, as the SDK hands it to a package.
 *
 * @param point - As `core` answered it.
 * @returns The point.
 */
function statePointOf(point: PlatformStatePoint): StateHistoryPoint {
  return {
    time: point.time.toISOString(),
    state: recordedStateOf(point.state),
    previousState: point.previousState === null ? null : recordedStateOf(point.previousState),
    attributes: point.attributes,
    isAvailable: point.isAvailable,
    source: point.source,
    ...(point.context === undefined
      ? {}
      : {
          cause: {
            type: point.context.type,
            ...(point.context.id === undefined ? {} : { id: point.context.id }),
          },
        }),
  };
}

/**
 * A reading, as the SDK hands it to a package.
 *
 * @param point - As `core` answered it.
 * @returns The point.
 */
function telemetryPointOf(point: PlatformTelemetryPoint): TelemetryPoint {
  return {
    time: point.time.toISOString(),
    value: point.value,
    ...(point.min === undefined ? {} : { min: point.min }),
    ...(point.max === undefined ? {} : { max: point.max }),
    ...(point.count === undefined ? {} : { count: point.count }),
  };
}

/**
 * The request a read of the past makes of `core`, checked here so a package hears what is wrong
 * with it in its own words, not as a bus refusal.
 *
 * @param read - What the package asked for.
 * @param extra - The resolution, for telemetry.
 * @returns The request.
 * @throws {ValidationError} When it names no entity or too many, or its window is backwards.
 */
function historyRequestOf(read: HistoryRead, extra: Readonly<Record<string, unknown>> = {}) {
  return {
    entityIds: [...read.entityIds],
    from: new Date(read.from).toISOString(),
    to: new Date(read.to).toISOString(),
    ...(read.limit === undefined ? {} : { limit: read.limit }),
    ...extra,
  };
}

/**
 * Checks a request against its schema, naming the first problem.
 *
 * @param schema - The request's schema.
 * @param request - The request.
 * @throws {ValidationError} When it does not hold.
 */
function checkHistoryRequest(schema: z.ZodType, request: unknown): void {
  const result = schema.safeParse(request);

  if (!result.success) {
    throw new ValidationError(
      `A read of the past is refused: ${result.error.issues[0]?.message ?? 'it is malformed'}`,
    );
  }
}

/**
 * Says whether an entity is one a filter names.
 *
 * @param filter - The filter.
 * @param entityId - The entity.
 * @returns True when it is.
 */
function matches(filter: EntityFilter, entityId: string): boolean {
  // shortcut: the address's domain, not what the owner shows it as (entity-types.ts); read the
  // shown domain here once a package's server needs a relay shown as a light among its lights.
  return (
    (filter.domain === undefined || entityId.startsWith(`${filter.domain}.`)) &&
    (filter.entityIds === undefined || filter.entityIds.includes(entityId))
  );
}

/**
 * Makes a package's context.
 *
 * @param options - The bus client, the package, its settings and folders, the logger, the signal.
 * @returns The context, its methods, and how to close it.
 */
export function createPackageContext(options: PackageContextOptions): PackageContextHandle {
  const { client, id, logger } = options;
  const prefix = packageObjectPrefix(id);
  const methods = new Map<string, Method>();
  const services = new Map<string, Service>();
  const subscriptions: BusSubscription[] = [];
  const customTypes = new Map<string, string>();

  // The device's unit of each sensor whose numbers are converted to its class's, by entity id.
  const conversions = new Map<string, Measured['conversion']>();
  const customHandlers = new Map<
    string,
    (command: CustomCommand<Readonly<Record<string, CustomValue>>>) => Awaitable<void>
  >();
  const settingsHandlers = new Set<(change: SettingsChange<JsonObject>) => Awaitable<void>>();
  let settings: JsonObject = options.settings;
  let onCommand: ((command: CapabilityCommand) => Awaitable<void>) | undefined;

  /**
   * The object id of one of the package's entities.
   *
   * @param entityId - The entity.
   * @returns What follows the prefix, or undefined for anyone else's entity.
   */
  const objectIdOf = (entityId: string): string | undefined => {
    const objectId = entityId.split('.')[1];

    return objectId?.startsWith(prefix) === true ? objectId.slice(prefix.length) : undefined;
  };

  subscriptions.push(
    client.serve(
      busSubjects.service(id, ADAPTER_COMMAND_METHOD),
      adapterCommandSchema,

      /**
       * Hands a command to the entity type's handler for a custom entity, to the package's
       * handler otherwise.
       *
       * @param request - The command.
       * @returns When it was taken.
       * @throws {DeviceUnavailableError} When nothing of the package handles it.
       */
      async (request): Promise<AdapterAck> => {
        const objectId = objectIdOf(request.entityId) ?? '';
        const commandId =
          isRecord(request.command) && typeof request.command['command'] === 'string'
            ? request.command['command']
            : '';
        const custom =
          request.capability === 'custom'
            ? customHandlers.get(`${customTypes.get(objectId) ?? ''}:${commandId}`)
            : undefined;

        if (custom !== undefined && isRecord(request.command)) {
          const args = isRecord(request.command['args']) ? request.command['args'] : {};

          await custom({
            entityId: request.entityId,
            objectId,
            args: Object.fromEntries(
              Object.entries(args).filter((entry): entry is [string, CustomValue] =>
                isCustomValue(entry[1]),
              ),
            ),
          });

          return { acceptedAt: new Date() };
        }

        const command = {
          entityId: request.entityId,
          capability: request.capability,
          command: request.command,
        };

        if (onCommand === undefined || !isCapabilityCommand(command)) {
          throw new DeviceUnavailableError(`The ${id} package takes no such command`, {
            details: { entityId: request.entityId },
          });
        }

        await onCommand(command);

        return { acceptedAt: new Date() };
      },
    ),
    client.serve(
      busSubjects.service(id, PACKAGE_RPC_METHOD),
      packageRpcRequestSchema,

      /**
       * Calls one of the package's methods.
       *
       * @param request - Which method, with what, from whom.
       * @returns What it answered.
       * @throws {NotFoundError} When there is no such method.
       * @throws {ValidationError} When the input is not what the method takes.
       */
      async (request): Promise<PackageRpcReply> => {
        const method = methods.get(request.method);

        if (method === undefined) {
          throw new NotFoundError(`The ${id} package has no method ${request.method}`, {
            details: { method: request.method },
          });
        }

        let input: unknown = request.input;

        if (method.input !== undefined) {
          const checked = await check(method.input, request.input);

          if (!checked.isValid) {
            throw new ValidationError(`${request.method} does not take that input`, {
              details: { method: request.method, problem: checked.message },
            });
          }

          input = checked.value;
        }

        const output = await method.handler(input, { caller: request.caller ?? PLATFORM_CALLER });

        return { output: jsonValueSchema.parse(output ?? null) };
      },
      { concurrency: 8 },
    ),
    client.serve(
      busSubjects.service(id, PACKAGE_SETTINGS_METHOD),
      packageSettingsChangeSchema,

      /**
       * Takes a live change of the settings, and tells whoever listens.
       *
       * @param change - The settings as they now stand, and what changed.
       * @returns Once every listener heard it.
       */
      async (change): Promise<Record<string, never>> => {
        settings = change.values;

        for (const handler of settingsHandlers) {
          try {
            // eslint-disable-next-line no-await-in-loop -- listeners hear it in the order they came
            await handler({ values: settings, changed: change.changed });
          } catch (error: unknown) {
            logger.error({ err: error }, 'A listener of the settings failed');
          }
        }

        return {};
      },
    ),
  );

  /**
   * Registers a method of the package's interface.
   *
   * @param name - The method.
   * @param method - Who may call it, and what it takes.
   * @param method.access - Who may call it.
   * @param method.input - What checks its input, if anything.
   * @param handler - What it does.
   * @throws {Error} When the name is not a method's, or is taken.
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
    const isInput = (input: unknown): input is TInput => input !== Symbol.iterator;

    if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(name)) {
      throw new Error(`${name} is not a method name: camelCase, a letter first`);
    }

    if (methods.has(name)) {
      throw new Error(`The method ${name} is registered already`);
    }

    methods.set(name, {
      access: method.access,
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
    const isInput = (input: unknown): input is TInput => input !== Symbol.iterator;
    const answer = typeof serviceOrHandler === 'function' ? serviceOrHandler : handler;

    if (!isPackageServiceAllowed(name)) {
      throw new Error(`${name} is a name the platform keeps for itself`);
    }

    if (services.has(name)) {
      throw new Error(`The service ${name} is provided already`);
    }

    if (answer === undefined) {
      throw new Error(`The service ${name} has no handler`);
    }

    const schema = typeof serviceOrHandler === 'function' ? undefined : serviceOrHandler.input;

    services.set(name, {
      input: schema,

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
    subscriptions.push(
      client.serve(
        busSubjects.service(id, name),
        z.unknown(),

        /**
         * Answers the service, its input checked.
         *
         * @param request - The input.
         * @param context - Who sent it.
         * @returns What the service answered.
         * @throws {ValidationError} When the input is not what the service takes.
         */
        async (request, context: MessageContext): Promise<JsonValue | null> => {
          const service = services.get(name);
          let input: unknown = request;

          if (service?.input !== undefined) {
            const checked = await check(service.input, request);

            if (!checked.isValid) {
              throw new ValidationError(`${name} does not take that input`, {
                details: { service: name, problem: checked.message },
              });
            }

            input = checked.value;
          }

          return (await service?.handler(input, { caller: context.header.source })) ?? null;
        },
      ),
    );
  }

  /**
   * Calls a service.
   *
   * @param target - The package or service.
   * @param name - The service.
   * @param input - What it is handed.
   * @param call - How long it may take, and what checks the answer.
   * @param call.timeoutMs - In milliseconds.
   * @param call.output - What checks the answer, if anything.
   * @returns What it answered.
   * @throws {ValidationError} When the answer is not what was asked.
   */
  async function callService<TOutput = unknown>(
    target: string,
    name: string,
    input?: JsonValue,
    call: { readonly timeoutMs?: number; readonly output?: Schema<TOutput> } = {},
  ): Promise<TOutput> {
    /**
     * Says whether an answer is what was asked: its schema checked it, or nothing was asked.
     *
     * @param answer - The answer.
     * @returns True.
     */
    const isOutput = (answer: unknown): answer is TOutput => answer !== Symbol.iterator;
    const answer: unknown = await client.request(
      busSubjects.service(target, name),
      input ?? null,
      z.unknown(),
      call.timeoutMs === undefined ? {} : { timeoutMs: call.timeoutMs },
    );

    if (call.output === undefined) {
      if (!isOutput(answer)) {
        throw new ValidationError(`${target}.${name} answered nothing`);
      }

      return answer;
    }

    const checked = await check(call.output, answer);

    if (!checked.isValid) {
      throw new ValidationError(`${target}.${name} answered what was not asked`, {
        details: { problem: checked.message },
      });
    }

    return checked.value;
  }

  const context: ServerContext = {
    id,
    version: options.version,
    platform: { version: options.platformVersion },
    sdk: { version: SDK_VERSION },

    /**
     * What the owner saved, as it stands now.
     *
     * @returns The settings.
     */
    get settings() {
      return settings;
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

    dataDir: options.dataDir,
    cacheDir: options.cacheDir,
    signal: options.signal,
    logger,

    /**
     * One of the package's entity ids.
     *
     * @param domain - The domain.
     * @param objectId - What follows the prefix.
     * @returns The id.
     */
    entityId: (domain, objectId) => parseEntityId(`${domain}.${prefix}${objectId}`),

    objectIdOf,

    devices: {
      /**
       * Hands `core` every device the package has.
       *
       * @param devices - The devices.
       * @param sync - How long `core` has.
       * @returns What `core` did.
       */
      sync: async (devices: readonly DeviceInput[], sync = {}) => {
        const synced = new Map<string, Measured['conversion']>();
        const reply = await client.request(
          busSubjects.service(CORE_SERVICE, CORE_SYNC_PACKAGE_METHOD),
          {
            packageId: id,
            devices: devices.map((device) => ({
              externalId: device.externalId,
              name: device.name,
              ...(device.icon === undefined ? {} : { icon: device.icon }),
              ...(device.manufacturer === undefined ? {} : { manufacturer: device.manufacturer }),
              ...(device.model === undefined ? {} : { model: device.model }),
              ...(device.swVersion === undefined ? {} : { swVersion: device.swVersion }),
              entities: device.entities.map((entity) => {
                if ('type' in entity) {
                  return {
                    entityId: context.entityId('custom', entity.objectId),
                    name: entity.name,
                    ...(entity.icon === undefined ? {} : { icon: entity.icon }),
                    capabilities: { custom: { packageId: id, type: entity.type.id } },
                  };
                }

                const { domain, objectId, ...rest } = entity;
                const entityId = context.entityId(domain, objectId);
                const measured = measuredOf(rest);

                synced.set(entityId, measured.conversion);

                return { ...measured.entity, entityId };
              }),
            })),
          },
          syncPackageReplySchema,
          { timeoutMs: sync.timeoutMs ?? SYNC_TIMEOUT_MS },
        );

        customTypes.clear();
        conversions.clear();

        for (const [entityId, conversion] of synced) {
          if (conversion !== undefined) {
            conversions.set(entityId, conversion);
          }
        }

        for (const entity of devices.flatMap((device) => device.entities)) {
          if ('type' in entity) {
            customTypes.set(entity.objectId, entity.type.id);
          }
        }

        return reply;
      },

      /**
       * Reports a state.
       *
       * @param entityId - The entity.
       * @param state - Its state.
       * @param report - Its attributes and whether it is reachable.
       */
      report: (entityId, state, report = {}) => {
        const converted = convertedState(state, conversions.get(entityId));

        if (converted === undefined) {
          logger.debug(
            { entityId, state },
            'A number its class’s unit cannot hold is not reported',
          );

          return;
        }

        client.publish(busSubjects.stateReport(parseEntityId(entityId)), {
          entityId,
          state: converted,
          ...(report.attributes === undefined ? {} : { attributes: report.attributes }),
          ...(report.isAvailable === undefined ? {} : { isAvailable: report.isAvailable }),
          observedAt: new Date().toISOString(),
        });
      },

      /**
       * Takes the command handler.
       *
       * @param handler - The handler.
       * @returns What removes it.
       * @throws {Error} When there is one already.
       */
      onCommand: (handler) => {
        if (onCommand !== undefined) {
          throw new Error('devices.onCommand has a handler already');
        }

        onCommand = handler;

        return () => {
          onCommand = undefined;
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
      entityId: (objectId) => context.entityId('custom', objectId),

      /**
       * Reports an entity's values.
       *
       * @param entityId - The entity.
       * @param values - Its values.
       * @param report - Its attributes and availability.
       */
      report: (entityId, values, report) => {
        context.devices.report(
          entityId,
          {
            custom: {
              values: Object.fromEntries(
                Object.entries(values).filter((entry): entry is [string, CustomValue] =>
                  isCustomValue(entry[1]),
                ),
              ),
            },
          },
          report,
        );
      },

      /**
       * Takes the handler of one of the type's commands.
       *
       * @param command - The command's id.
       * @param handler - The handler.
       * @returns What removes it.
       * @throws {Error} When the command has one already.
       */
      onCommand: (command, handler) => {
        const key = `${type.id}:${command}`;

        /**
         * Says whether arguments are the command's: `core` checked them against the type.
         *
         * @param args - The arguments.
         * @returns True for a record.
         */
        const isArgs = (args: unknown): args is Parameters<typeof handler>[0]['args'] =>
          isRecord(args);

        if (customHandlers.has(key)) {
          throw new Error(`${type.id} has a handler for ${command} already`);
        }

        customHandlers.set(key, async (call) => {
          if (!isArgs(call.args)) {
            throw new Error(`${command} was sent without arguments`);
          }

          await handler({ entityId: call.entityId, objectId: call.objectId, args: call.args });
        });

        return () => {
          customHandlers.delete(key);
        };
      },
    }),

    entities: {
      /**
       * One entity, as `core` holds it.
       *
       * @param entityId - The entity.
       * @returns It, or undefined when nothing ever reported it.
       */
      get: async (entityId) => {
        try {
          return snapshotOf(
            await client.request(
              busSubjects.stateGet(parseEntityId(entityId)),
              {},
              entityStateSchema,
            ),
          );
        } catch (error: unknown) {
          if (error instanceof NotFoundError) {
            return undefined;
          }

          throw error;
        }
      },

      /**
       * The entities a filter names.
       *
       * @param filter - Which.
       * @returns Them.
       */
      list: async (filter = {}) => {
        const snapshot = await client.request(
          busSubjects.stateSnapshot(),
          stateGetRequestSchema.parse({}),
          stateSnapshotReplySchema,
        );

        return snapshot.entities
          .filter((state) => matches(filter, state.entityId))
          .map((state) => snapshotOf(state));
      },

      /**
       * Hears the changes of the entities a filter names.
       *
       * @param filter - Which.
       * @param handler - What hears a change.
       * @returns What stops it hearing.
       */
      subscribe: (filter, handler) => {
        /**
         * Hands on a change the filter names.
         *
         * @param event - The change, as `core` fans it out.
         */
        const hear = async (event: z.output<typeof stateChangedEventSchema>): Promise<void> => {
          if (!matches(filter, event.entityId)) {
            return;
          }

          const change: StateChange = {
            entityId: event.entityId,
            current: snapshotOf(event.current),
            ...(event.previous === undefined ? {} : { previous: snapshotOf(event.previous) }),
          };

          await handler(change);
        };
        const subjects =
          filter.entityIds === undefined
            ? [BUS_PATTERNS.allStateChanges]
            : filter.entityIds.map((entityId) => busSubjects.stateChanged(parseEntityId(entityId)));
        const placed = subjects.map((subject) =>
          client.subscribe(subject, stateChangedEventSchema, hear),
        );

        subscriptions.push(...placed);

        return () => {
          for (const subscription of placed) {
            subscription.unsubscribe();
          }
        };
      },
    },

    history: {
      /**
       * The changes of some entities in a window, read through `core`.
       *
       * @param read - Which entities, which window, how many points each.
       * @returns Each entity's changes, oldest first.
       */
      states: async (read) => {
        const request = historyRequestOf(read);

        checkHistoryRequest(historyStatesRequestSchema, request);

        const reply = await client.request(
          busSubjects.service(CORE_SERVICE, CORE_HISTORY_STATES_METHOD),
          request,
          historyStatesReplySchema,
          { timeoutMs: HISTORY_TIMEOUT_MS },
        );

        return {
          series: Object.fromEntries(
            Object.entries(reply.series).map(([entityId, points]) => [
              entityId,
              points.map((point) => statePointOf(point)),
            ]),
          ),
          truncated: reply.truncated,
        };
      },

      /**
       * The readings of some entities in a window, read through `core`.
       *
       * @param read - Which entities, which window, which resolution.
       * @returns Each entity's readings, oldest first, and the resolution read.
       */
      telemetry: async (read) => {
        const span = new Date(read.to).getTime() - new Date(read.from).getTime();
        const resolution =
          read.resolution === undefined || read.resolution === 'auto'
            ? telemetryResolutionForSpan(span)
            : read.resolution;
        const request = historyRequestOf(read, { resolution });

        checkHistoryRequest(historyTelemetryRequestSchema, request);

        const reply = await client.request(
          busSubjects.service(CORE_SERVICE, CORE_HISTORY_TELEMETRY_METHOD),
          request,
          historyTelemetryReplySchema,
          { timeoutMs: HISTORY_TIMEOUT_MS },
        );

        return {
          series: Object.fromEntries(
            Object.entries(reply.series).map(([entityId, points]) => [
              entityId,
              points.map((point) => telemetryPointOf(point)),
            ]),
          ),
          truncated: reply.truncated,
          resolution: reply.resolution,
        };
      },
    },

    rpc: { method: rpcMethod },
    services: { provide, call: callService },
  };

  return {
    context,

    /**
     * The methods registered so far.
     *
     * @returns Each one's name and who may call it.
     */
    rpcMethods: () => [...methods].map(([name, method]) => ({ name, access: method.access })),

    /** Ends every subscription the context made. */
    close: () => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
    },
  };
}
