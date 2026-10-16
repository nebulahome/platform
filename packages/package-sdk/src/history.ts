/**
 * The past of the house's entities, as a package reads it: from its server with `ctx.history`,
 * from its interface with `useStateHistory` and `useTelemetry` (PACKAGES_DOCS.md 5.3, 6.4).
 *
 * Two records are kept. Every change of state, of every entity, is a **state point**: what it
 * became, what it was, when. Every numeric reading of a sensor is a **telemetry point**, kept raw
 * for a while and rolled up into minutes, hours and days for long: a lamp is read from the first,
 * a power meter from the second. A read names some entities and a window and answers each
 * entity's points oldest first; a window that holds more than a read returns loses its oldest
 * points, never the newest, and says so.
 *
 * Since 1.2.
 */
import type { CapabilityState } from './capabilities.js';
import type { EntityId } from './entities.js';
import type { JsonObject } from './json.js';

/** How finely readings are read: every one, or a bucket of a minute, an hour or a day. */
export type TelemetryResolution = 'raw' | '1m' | '1h' | '1d';

/** What caused a change, when the platform knows it. */
export type ChangeCause = {
  readonly type: 'automation' | 'scene' | 'user' | 'device' | 'alias' | 'startup';

  /** Which run, scene or person; absent for a device and at startup. */
  readonly id?: string;
};

/** One change of an entity's state. */
export type StateHistoryPoint = {
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
export type TelemetryPoint = {
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
export type HistorySeries<TPoint> = Readonly<Record<EntityId, readonly TPoint[]>>;
