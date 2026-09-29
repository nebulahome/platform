/**
 * The context a package's `start` is handed, over a bus client that speaks as the package.
 *
 * Every way it reaches the platform is a bus subject under its id, as every owner's are: the
 * commands `core` routes to its entities arrive on `svc.<id>.command`, its pages' calls on
 * `svc.<id>.rpc`, and a service it provides on `svc.<id>.<name>`. What it reports goes on the
 * state subjects stamped with its id, which is what `core` checks a report's owner against.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebula-home/bus';
import {
  ADAPTER_COMMAND_METHOD,
  adapterCommandSchema,
  busSubjects,
  CORE_SERVICE,
  CORE_SYNC_PACKAGE_METHOD,
  DeviceUnavailableError,
  jsonValueSchema,
  NotFoundError,
  PACKAGE_RPC_METHOD,
  packageObjectPrefix,
  packageRpcRequestSchema,
  parseEntityId,
  syncPackageReplySchema,
  ValidationError,
  type AdapterAck,
  type JsonObject,
  type PackageRpcMethod,
  type PackageRpcReply,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';

import type { InputSchema, PackageCommand, PackageContext } from './index.js';

/** How long `core` has to take in a package's devices. */
const SYNC_TIMEOUT_MS = 15_000;

/** The subject tokens a package answers itself, which a service of its own cannot take. */
const RESERVED_SERVICES = new Set([ADAPTER_COMMAND_METHOD, PACKAGE_RPC_METHOD]);

/** What making a context needs. */
export type PackageContextOptions = {
  /** A bus client whose source is the package's id. */
  readonly client: BusClient;
  readonly id: string;
  readonly version: string;
  readonly settings: JsonObject;
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly logger: PlatformLogger;
  readonly signal: AbortSignal;
};

/** One RPC method, as the context keeps it. */
type Method = {
  readonly access: PackageRpcMethod['access'];
  readonly input: InputSchema<unknown> | undefined;
  readonly handler: (input: unknown) => unknown;
};

/** A context, and what the runner does with it besides handing it to `start`. */
export type PackageContextHandle = {
  readonly context: PackageContext;

  /** The methods registered so far, for the announcement. */
  readonly rpcMethods: () => PackageRpcMethod[];

  /** Ends every subscription the context made. */
  readonly close: () => void;
};

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
  const subscriptions: BusSubscription[] = [];

  let onCommand: ((command: PackageCommand) => Promise<void> | void) | undefined;

  subscriptions.push(
    client.serve(
      busSubjects.service(id, ADAPTER_COMMAND_METHOD),
      adapterCommandSchema,

      /**
       * Hands a command to the package's handler.
       *
       * @param request - The command.
       * @returns When it was taken.
       * @throws {DeviceUnavailableError} When the package has no handler yet.
       */
      async (request): Promise<AdapterAck> => {
        if (onCommand === undefined) {
          throw new DeviceUnavailableError(`The ${id} package takes no commands yet`, {
            details: { entityId: request.entityId },
          });
        }

        await onCommand({
          entityId: request.entityId,
          capability: request.capability,
          command: request.command,
        });

        return { acceptedAt: new Date() };
      },
    ),
    client.serve(
      busSubjects.service(id, PACKAGE_RPC_METHOD),
      packageRpcRequestSchema,

      /**
       * Calls one of the package's methods.
       *
       * @param request - Which method, with what.
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
          const parsed = method.input.safeParse(request.input);

          if (!parsed.success) {
            throw new ValidationError(`${request.method} does not take that input`, {
              details: { method: request.method },
            });
          }

          input = parsed.data;
        }

        const output = await method.handler(input);

        return { output: jsonValueSchema.parse(output ?? null) };
      },
      { concurrency: 8 },
    ),
  );

  const context: PackageContext = {
    id,
    version: options.version,
    settings: options.settings,
    dataDir: options.dataDir,
    cacheDir: options.cacheDir,
    logger,
    signal: options.signal,

    /**
     * One of the package's entity ids.
     *
     * @param domain - The domain.
     * @param objectId - What follows the prefix.
     * @returns The id.
     */
    entityId: (domain, objectId) => parseEntityId(`${domain}.${prefix}${objectId}`),

    devices: {
      /**
       * Hands `core` every device the package has.
       *
       * @param devices - The devices.
       * @returns What `core` did.
       */
      sync: async (devices) =>
        client.request(
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
              entities: device.entities.map(({ domain, objectId, ...entity }) => ({
                ...entity,
                entityId: context.entityId(domain, objectId),
              })),
            })),
          },
          syncPackageReplySchema,
          { timeoutMs: SYNC_TIMEOUT_MS },
        ),

      /**
       * Reports a state.
       *
       * @param entityId - The entity.
       * @param state - Its state.
       * @param report - Its attributes and whether it is reachable.
       */
      report: (entityId, state, report = {}) => {
        client.publish(busSubjects.stateReport(entityId), {
          entityId,
          state,
          ...(report.attributes === undefined ? {} : { attributes: report.attributes }),
          ...(report.isAvailable === undefined ? {} : { isAvailable: report.isAvailable }),
          observedAt: new Date().toISOString(),
        });
      },

      /**
       * Takes the command handler.
       *
       * @param handler - The handler.
       */
      onCommand: (handler) => {
        onCommand = handler;
      },
    },

    rpc: {
      /**
       * Registers a method.
       *
       * @param name - Its name.
       * @param method - Who may call it, and what it takes.
       * @param handler - What it does.
       * @throws {Error} When the name is not a method's, or is taken.
       */
      method: (name, method, handler) => {
        if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(name)) {
          throw new Error(`${name} is not a method name: camelCase, a letter first`);
        }

        if (methods.has(name)) {
          throw new Error(`The method ${name} is registered already`);
        }

        methods.set(name, {
          access: method.access,
          input: method.input,
          handler: handler as (input: unknown) => unknown,
        });
      },
    },

    services: {
      /**
       * Offers a service.
       *
       * @param name - Its name.
       * @param handler - What it answers.
       * @throws {Error} When the name is one the package answers itself.
       */
      provide: (name, handler) => {
        if (RESERVED_SERVICES.has(name)) {
          throw new Error(`${name} is the package's own subject, and not a service's`);
        }

        subscriptions.push(
          client.serve(busSubjects.service(id, name), z.unknown(), async (request) =>
            handler(request),
          ),
        );
      },

      /**
       * Calls a service.
       *
       * @param service - The service.
       * @param method - The method.
       * @param input - What it is handed.
       * @param call - How long it may take.
       * @returns What it answered.
       */
      call: async (service, method, input, call = {}) =>
        client.request(busSubjects.service(service, method), input, z.unknown(), {
          ...(call.timeoutMs === undefined ? {} : { timeoutMs: call.timeoutMs }),
        }),
    },
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
