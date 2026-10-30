import { i as SettingsDefinition } from "./chunks/json.js";
import { a as TelemetryResolution, i as TelemetryPoint, n as HistorySeries, r as StateHistoryPoint, t as ChangeCause } from "./chunks/history.js";
import { A as TelemetryRead, C as ServerSettings, D as SettingsChange, E as ServiceProvide, F as StandardResult, I as StandardSchemaV1, M as SafeParser, N as Schema, O as StateChange, P as SchemaIssue, S as ServerContext, T as ServiceCallFunction, _ as ReportOptions, a as CustomEntityInput, b as RpcCaller, c as EntityInput, d as HistoryRead, f as LiveCall, g as Logger, h as LogMethod, i as CustomEntities, j as Unsubscribe, k as SyncResult, l as EntitySnapshot, m as LivePublishOptions, n as CapabilityEntityInput, o as DeviceInput, p as LiveOnMessage, r as CustomCommand, s as EntityFilter, t as Awaitable, u as HistoryAnswer, v as RpcAccess, w as ServiceCall, x as RpcMethod, y as RpcCall } from "./chunks/context.js";
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
export type { Awaitable, CapabilityEntityInput, ChangeCause, CustomCommand, CustomEntities, CustomEntityInput, DeviceInput, EntityFilter, EntityInput, EntitySnapshot, HistoryAnswer, HistoryRead, HistorySeries, LiveCall, LiveOnMessage, LivePublishOptions, LogMethod, Logger, ReportOptions, RpcAccess, RpcCall, RpcCaller, RpcMethod, SafeParser, Schema, SchemaIssue, ServerContext, ServerSettings, ServiceCall, ServiceCallFunction, ServiceProvide, SettingsChange, StandardResult, StandardSchemaV1, StateChange, StateHistoryPoint, SyncResult, TelemetryPoint, TelemetryRead, TelemetryResolution, Unsubscribe };