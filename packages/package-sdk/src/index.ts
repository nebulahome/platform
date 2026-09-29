/**
 * The package SDK: how a package's server is written (PACKAGES.md 4).
 *
 * A `node` package's `server/index.js` default-exports {@link definePackage}. The packet-manager
 * runs it with the platform's runner (`@nebula-home/package-sdk/run`), which connects it to the
 * bus under the package's id and hands `start` a {@link PackageContext}: its settings, its folders,
 * a logger, and the ways it reaches the rest of the platform - its devices and their entities
 * through `core`, the RPC methods its pages call, the services it offers and those it calls.
 *
 * `definePackage` itself is the identity function, as `defineTransport` is for a bundle: what a
 * package bundles of this module is its types and a line of code, and the context is the
 * platform's own, of the version the package's `sdk` range accepts.
 */
import type {
  CapabilityName,
  CapabilityState,
  DeclaredCapabilities,
  EntityDomain,
  EntityId,
  EntityStateClass,
  JsonObject,
  JsonValue,
  PackageRpcAccess,
  SyncPackageReply,
} from '@nebula-home/contracts';
import type { PlatformLogger } from '@nebula-home/logging';

/** One entity of a package's device. */
export type PackageEntity = {
  readonly domain: EntityDomain;

  /**
   * What follows the package's own prefix in its id: `last_recording` becomes
   * `custom.nvr_last_recording` for the package `nvr`.
   */
  readonly objectId: string;

  readonly name: string;
  readonly capabilities: DeclaredCapabilities;
  readonly icon?: string;
  readonly unitOfMeasurement?: string;
  readonly deviceClass?: string;
  readonly stateClass?: EntityStateClass;
  readonly displayPrecision?: number;
};

/** One device a package has. */
export type PackageDevice = {
  /** Its own id at the package: stable, what finds it again after a restart. */
  readonly externalId: string;

  /** What it starts as called; the owner's name, once given, outlives it. */
  readonly name: string;

  readonly icon?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly swVersion?: string;
  readonly entities: readonly PackageEntity[];
};

/** A command `core` routed to one of the package's entities. */
export type PackageCommand = {
  readonly entityId: EntityId;
  readonly capability: CapabilityName;

  /** Already checked by `core` against the capability, and a `custom` one against its type. */
  readonly command: JsonObject;
};

/** What checks a method's input: a zod schema, or anything with the same `safeParse`. */
export type InputSchema<T> = {
  readonly safeParse: (
    value: unknown,
  ) =>
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: unknown };
};

/** What a package's `start` is handed. */
export type PackageContext = {
  readonly id: string;
  readonly version: string;

  /** What the owner saved on its Configure, secrets opened. A change starts the package again. */
  readonly settings: JsonObject;

  /** `packages/<id>/data/`: what it keeps, in every backup. */
  readonly dataDir: string;

  /** `cache/packages/<id>/`: what it can make again, in no backup. */
  readonly cacheDir: string;

  readonly logger: PlatformLogger;

  /** Aborted when the package is asked to stop. */
  readonly signal: AbortSignal;

  /**
   * One of its entities' ids.
   *
   * @param domain - The entity's domain.
   * @param objectId - What follows the package's prefix.
   * @returns `<domain>.<package>_<objectId>`.
   */
  readonly entityId: (domain: EntityDomain, objectId: string) => EntityId;

  readonly devices: {
    /**
     * Every device and entity the package has, whole: what is not in it is removed.
     *
     * @returns What `core` wrote, and what it refused.
     */
    readonly sync: (devices: readonly PackageDevice[]) => Promise<SyncPackageReply>;

    /** Reports an entity's state, through the pipeline an integration's reports go through. */
    readonly report: (
      entityId: EntityId,
      state: CapabilityState,
      options?: { readonly attributes?: JsonObject; readonly isAvailable?: boolean },
    ) => void;

    /** Handles the commands `core` routes to its entities; a throw is the command's failure. */
    readonly onCommand: (handler: (command: PackageCommand) => Promise<void> | void) => void;
  };

  readonly rpc: {
    /**
     * A method its pages and cards call, over `POST /api/v1/packages/:id/rpc/:name`: `read` for
     * anyone who may read the package, `configure` for who may configure it.
     */
    readonly method: <T>(
      name: string,
      options: { readonly access: PackageRpcAccess; readonly input?: InputSchema<T> },
      handler: (input: T) => Promise<JsonValue> | JsonValue,
    ) => void;
  };

  readonly services: {
    /** A service another package or the platform calls: `svc.<id>.<name>`. */
    readonly provide: (
      name: string,
      handler: (request: unknown) => Promise<JsonValue> | JsonValue,
    ) => void;

    /** Calls one: `svc.<service>.<method>`. */
    readonly call: (
      service: string,
      method: string,
      input: JsonValue,
      options?: { readonly timeoutMs?: number },
    ) => Promise<unknown>;
  };
};

/** What `start` may give back: how to stop what it started. */
export type PackageStop = () => Promise<void> | void;

/** What a package's server is. */
export type PackageDefinition = {
  /**
   * Starts the package: registers its devices, methods and services, and opens what it runs.
   *
   * @returns How to stop it, when there is anything to stop.
   */
  readonly start: (
    context: PackageContext,
  ) => Promise<PackageStop | undefined> | PackageStop | undefined;
};

/**
 * Declares a package's server. The identity function: what it adds is the type.
 *
 * @param definition - The package.
 * @returns The same package.
 */
export function definePackage(definition: PackageDefinition): PackageDefinition {
  return definition;
}

export { createPackageContext, type PackageContextOptions } from './context.js';
