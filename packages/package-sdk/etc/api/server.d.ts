import { i as SettingsDefinition } from "./chunks/json.js";
import { A as StandardSchemaV1, C as StateChange, D as Schema, E as SafeParser, O as SchemaIssue, S as SettingsChange, T as Unsubscribe, _ as ServerContext, a as CustomEntityInput, b as ServiceCallFunction, c as EntityInput, d as Logger, f as ReportOptions, g as RpcMethod, h as RpcCaller, i as CustomEntities, k as StandardResult, l as EntitySnapshot, m as RpcCall, n as CapabilityEntityInput, o as DeviceInput, p as RpcAccess, r as CustomCommand, s as EntityFilter, t as Awaitable, u as LogMethod, v as ServerSettings, w as SyncResult, x as ServiceProvide, y as ServiceCall } from "./chunks/context.js";
//#region src/server/index.d.ts
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
export declare function defineServer<TSettings extends SettingsDefinition | undefined = undefined>(server: Omit<ServerDefinition<TSettings>, 'kind' | 'sdk'>): ServerDefinition<TSettings>;
//#endregion
export type { Awaitable, CapabilityEntityInput, CustomCommand, CustomEntities, CustomEntityInput, DeviceInput, EntityFilter, EntityInput, EntitySnapshot, LogMethod, Logger, ReportOptions, RpcAccess, RpcCall, RpcCaller, RpcMethod, SafeParser, Schema, SchemaIssue, ServerContext, ServerSettings, ServiceCall, ServiceCallFunction, ServiceProvide, SettingsChange, StandardResult, StandardSchemaV1, StateChange, SyncResult, Unsubscribe };