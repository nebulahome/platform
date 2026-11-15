import { i as SettingsDefinition } from "./chunks/json.js";
import { a as TelemetryResolution, i as TelemetryPoint, n as HistorySeries, r as StateHistoryPoint, t as ChangeCause } from "./chunks/history.js";
import { A as ServiceCallFunction, B as StandardResult, C as RpcAccess, D as ServerContext, E as RpcMethod, F as TelemetryRead, I as Unsubscribe, L as SafeParser, M as SettingsChange, N as StateChange, O as ServerSettings, P as SyncResult, R as Schema, S as ReportOptions, T as RpcCaller, V as StandardSchemaV1, _ as LiveCall, a as CustomEntities, b as LogMethod, c as EntityFilter, d as HistoryAnswer, f as HistoryRead, g as HouseEntity, h as HouseDevice, i as CustomCommand, j as ServiceProvide, k as ServiceCall, l as EntityInput, m as HouseArea, n as CapabilityEntityInput, o as CustomEntityInput, p as House, r as ContainerStatus, s as DeviceInput, t as Awaitable, u as EntitySnapshot, v as LiveOnMessage, w as RpcCall, x as Logger, y as LivePublishOptions, z as SchemaIssue } from "./chunks/context.js";
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
export type { Awaitable, CapabilityEntityInput, ChangeCause, ContainerStatus, CustomCommand, CustomEntities, CustomEntityInput, DeviceInput, EntityFilter, EntityInput, EntitySnapshot, HistoryAnswer, HistoryRead, HistorySeries, House, HouseArea, HouseDevice, HouseEntity, LiveCall, LiveOnMessage, LivePublishOptions, LogMethod, Logger, ReportOptions, RpcAccess, RpcCall, RpcCaller, RpcMethod, SafeParser, Schema, SchemaIssue, ServerContext, ServerSettings, ServiceCall, ServiceCallFunction, ServiceProvide, SettingsChange, StandardResult, StandardSchemaV1, StateChange, StateHistoryPoint, SyncResult, TelemetryPoint, TelemetryRead, TelemetryResolution, Unsubscribe };