import { G as CapabilityState, lt as EntityId, t as JsonObject } from "./json.js";
//#region src/history.d.ts
/** How finely readings are read: every one, or a bucket of a minute, an hour or a day. */
type TelemetryResolution = 'raw' | '1m' | '1h' | '1d';
/** What caused a change, when the platform knows it. */
type ChangeCause = {
  readonly type: 'automation' | 'scene' | 'user' | 'device' | 'alias' | 'startup';
  /** Which run, scene or person; absent for a device and at startup. */
  readonly id?: string;
};
/** One change of an entity's state. */
type StateHistoryPoint = {
  /** When it changed, ISO 8601. */
  readonly time: string;
  /** What it became. */
  readonly state: CapabilityState;
  /** What it was; null for the first report the platform recorded. */
  readonly previousState: CapabilityState | null;
  readonly attributes: JsonObject;
  readonly isAvailable: boolean;
  /** Which package, integration or engine reported it. */
  readonly source: string;
  readonly cause?: ChangeCause;
};
/** One reading, or one bucket of readings. */
type TelemetryPoint = {
  /** The reading's time, or the bucket's start, ISO 8601. */
  readonly time: string;
  /** The reading, or the bucket's average. */
  readonly value: number;
  /** A bucket's lowest, highest and how many readings it holds; absent for raw readings. */
  readonly min?: number;
  readonly max?: number;
  readonly count?: number;
};
/** Each entity's points, oldest first: an entity never recorded, or not readable, has none. */
type HistorySeries<TPoint> = Readonly<Record<EntityId, readonly TPoint[]>>;
//#endregion
export { TelemetryResolution as a, TelemetryPoint as i, HistorySeries as n, StateHistoryPoint as r, ChangeCause as t };