import { i as SettingsDefinition } from "./chunks/json.js";
import { a as TelemetryResolution, i as TelemetryPoint, n as HistorySeries, r as StateHistoryPoint, t as ChangeCause } from "./chunks/history.js";
import { A as ServiceProvide, B as StandardSchemaV1, C as RpcCall, D as ServerSettings, E as ServerContext, F as Unsubscribe, I as SafeParser, L as Schema, M as StateChange, N as SyncResult, O as ServiceCall, P as TelemetryRead, R as SchemaIssue, S as RpcAccess, T as RpcMethod, _ as LiveOnMessage, a as CustomEntityInput, b as Logger, c as EntityInput, d as HistoryRead, f as House, g as LiveCall, h as HouseEntity, i as CustomEntities, j as SettingsChange, k as ServiceCallFunction, l as EntitySnapshot, m as HouseDevice, n as CapabilityEntityInput, o as DeviceInput, p as HouseArea, r as CustomCommand, s as EntityFilter, t as Awaitable, u as HistoryAnswer, v as LivePublishOptions, w as RpcCaller, x as ReportOptions, y as LogMethod, z as StandardResult } from "./chunks/context.js";
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
export type { Awaitable, CapabilityEntityInput, ChangeCause, CustomCommand, CustomEntities, CustomEntityInput, DeviceInput, EntityFilter, EntityInput, EntitySnapshot, HistoryAnswer, HistoryRead, HistorySeries, House, HouseArea, HouseDevice, HouseEntity, LiveCall, LiveOnMessage, LivePublishOptions, LogMethod, Logger, ReportOptions, RpcAccess, RpcCall, RpcCaller, RpcMethod, SafeParser, Schema, SchemaIssue, ServerContext, ServerSettings, ServiceCall, ServiceCallFunction, ServiceProvide, SettingsChange, StandardResult, StandardSchemaV1, StateChange, StateHistoryPoint, SyncResult, TelemetryPoint, TelemetryRead, TelemetryResolution, Unsubscribe };