/**
 * `@nebulahome/package-sdk/server`: a package's server (PACKAGES_DOCS.md 5).
 *
 * The server's entry module default-exports `defineServer(…)`. The platform's runner starts it in
 * a process of its own and hands `start` a context - the platform's own implementation of
 * {@link ServerContext} - so what a package bundles of this module is its types and a line.
 */
import type { SettingsDefinition } from '../definitions/settings.js';
import { SDK_VERSION } from '../version.js';

import type { Awaitable, ServerContext } from './context.js';

export type {
  Awaitable,
  CapabilityEntityInput,
  CustomCommand,
  CustomEntities,
  CustomEntityInput,
  DeviceInput,
  EntityFilter,
  EntityInput,
  EntitySnapshot,
  HistoryAnswer,
  HistoryRead,
  LiveCall,
  LiveOnMessage,
  LivePublishOptions,
  LogMethod,
  Logger,
  ReportOptions,
  RpcAccess,
  RpcCall,
  RpcCaller,
  RpcMethod,
  ServerContext,
  ServerSettings,
  ServiceCall,
  ServiceCallFunction,
  ServiceProvide,
  SettingsChange,
  StateChange,
  SyncResult,
  TelemetryRead,
  Unsubscribe,
} from './context.js';
export type {
  ChangeCause,
  HistorySeries,
  StateHistoryPoint,
  TelemetryPoint,
  TelemetryResolution,
} from '../history.js';
export type {
  SafeParser,
  Schema,
  SchemaIssue,
  StandardResult,
  StandardSchemaV1,
} from '../schema.js';

/** What stops what `start` opened. */
export type Stop = () => Awaitable<void>;

/** What a server is: what it starts with, and the settings it reads. */
export type ServerDefinition<TSettings extends SettingsDefinition | undefined = undefined> = {
  /** Says to the runner what this is. */
  readonly kind: 'nebula.server';

  /** The SDK version it was built with: the runner refuses a newer major than its own. */
  readonly sdk: string;

  /** The package's settings, for the types of `ctx.settings`. */
  readonly settings?: TSettings;

  /**
   * Starts the package: registers its devices, methods and services, and opens what it runs.
   *
   * @param ctx - What the platform hands it.
   * @returns What stops it, when there is anything to stop.
   */
  readonly start: (ctx: ServerContext<TSettings>) => Awaitable<Stop | undefined>;
};

/**
 * Declares a package's server: the default export of its entry module.
 *
 * @param server - Its settings, if it reads them, and its `start`.
 * @returns The server, stamped with the SDK version it was built with.
 */
export function defineServer<TSettings extends SettingsDefinition | undefined = undefined>(
  server: Omit<ServerDefinition<TSettings>, 'kind' | 'sdk'>,
): ServerDefinition<TSettings> {
  return { ...server, kind: 'nebula.server', sdk: SDK_VERSION };
}
