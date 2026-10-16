import { V as CapabilityCommand, et as ReportedCapabilityState, i as SettingsDefinition, lt as EntityId, r as JsonValue, t as JsonObject } from "./chunks/json.js";
import { i as TelemetryPoint, r as StateHistoryPoint } from "./chunks/history.js";
import { T as StateChange, _ as RpcCaller, l as EntitySnapshot, m as ReportOptions, o as DeviceInput, t as Awaitable, y as ServerContext } from "./chunks/context.js";
//#region src/testing/index.d.ts
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
  readonly callRpc: (method: string, input?: JsonValue, caller?: RpcCaller) => Promise<JsonValue | undefined>;
  /**
   * Calls one of the services the package provides.
   *
   * @param name - The service.
   * @param input - What it is handed.
   * @param caller - The calling package's id; `test` when not said.
   * @returns What it answered.
   */
  readonly callService: (name: string, input?: unknown, caller?: string) => Promise<JsonValue | undefined>;
  /**
   * Changes settings as the owner would: when every field changed is live, the process hears
   * it; otherwise the platform would restart it, which the test does if it wants to.
   *
   * @param patch - What changes.
   * @returns Whether the platform would restart the package.
   */
  readonly changeSettings: (patch: JsonObject) => Promise<{
    readonly isRestart: boolean;
  }>;
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
  readonly answerService: (target: string, name: string, handler: (input: JsonValue | undefined) => Awaitable<unknown>) => void;
  /** Asks the package to stop: aborts `ctx.signal`. */
  readonly stop: () => void;
};
/**
 * Builds a context with no platform behind it.
 *
 * @param options - Its id, settings and the house it reads.
 * @returns The context, and what the package does with it.
 */
export declare function createTestContext<TSettings extends SettingsDefinition | undefined = undefined>(options?: TestContextOptions<TSettings>): TestContext<TSettings>;
//#endregion