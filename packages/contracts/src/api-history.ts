/**
 * Reading the past: state changes and numeric telemetry.
 *
 * Both are hypertables, both are keyset-paginated by time, and both are read newest first
 * because that is what a person opening a chart wants to see before anything else.
 */
import { z } from 'zod';

import { entityIdSchema } from './entity-id.js';
import { changeContextSchema, sourceRefSchema } from './entity-state.js';
import { jsonObjectSchema } from './json.js';
import { timestampSchema } from './timestamp.js';

/** What a history or telemetry request may narrow by. */
export const historyQuerySchema = z.object({
  /** The entity to read. Required: an unbounded read across every entity is a table scan. */
  entityId: z.string().min(3).max(255),

  /** Inclusive lower bound. Defaults to twenty-four hours before `to`. */
  from: z.iso.datetime({ offset: true }).optional(),

  /** Exclusive upper bound. Defaults to now. */
  to: z.iso.datetime({ offset: true }).optional(),
});

/** What a history or telemetry request may narrow by. */
export type HistoryQuery = z.output<typeof historyQuerySchema>;

/** One recorded state change. */
export const stateHistoryPointSchema = z.object({
  /** When it changed. */
  time: timestampSchema,

  entityId: entityIdSchema,

  /** What it became. */
  state: jsonObjectSchema,

  /** What it was, so a change reads without fetching the row before it. */
  previousState: jsonObjectSchema.nullable(),

  /** Extras at that moment. */
  attributes: jsonObjectSchema.default({}),

  /** Whether the entity was reachable. */
  isAvailable: z.boolean(),

  /** Which adapter or engine produced it. */
  source: sourceRefSchema,

  /** What caused it, when that is known. */
  context: changeContextSchema.optional(),
});

/** One recorded state change. */
export type StateHistoryPoint = z.output<typeof stateHistoryPointSchema>;

/** Which rolled-up resolution to read telemetry at. */
export const TELEMETRY_RESOLUTIONS = ['raw', '1m', '1h', '1d'] as const;

/** Which rolled-up resolution to read telemetry at. */
export type TelemetryResolution = (typeof TELEMETRY_RESOLUTIONS)[number];

/** What a telemetry request may narrow by. */
export const telemetryQuerySchema = historyQuerySchema.extend({
  /**
   * Which continuous aggregate to read.
   *
   * `raw` is every reading. The rolled-up levels come from the ladder in DATABASE.md 9 and
   * exist so that a year-long chart reads a few hundred rows instead of a few million.
   */
  resolution: z.enum(TELEMETRY_RESOLUTIONS).default('raw'),
});

/** What a telemetry request may narrow by. */
export type TelemetryQuery = z.output<typeof telemetryQuerySchema>;

/**
 * One telemetry reading, raw or rolled up.
 *
 * The aggregate fields are absent at `raw` resolution, where a bucket holds one reading and
 * `min`, `max` and `avg` would all be the same number.
 */
export const telemetryPointSchema = z.object({
  /** The reading's time, or the bucket's start. */
  time: timestampSchema,

  /** The reading, or the bucket's average. */
  value: z.number(),

  /** The bucket's lowest reading. */
  min: z.number().optional(),

  /** The bucket's highest reading. */
  max: z.number().optional(),

  /** How many readings the bucket holds. */
  count: z.int().min(1).optional(),
});

/** One telemetry reading. */
export type TelemetryPoint = z.output<typeof telemetryPointSchema>;

/** How one automation run ended. */
export const AUTOMATION_RESULTS = ['success', 'failed', 'skipped', 'timeout'] as const;

/** How one automation run ended. */
export type AutomationResult = (typeof AUTOMATION_RESULTS)[number];

/** One recorded automation run. */
export const automationRunSchema = z.object({
  id: z.uuid(),
  automationId: z.uuid(),

  /** When it started. */
  time: timestampSchema,

  /** What fired it. */
  trigger: jsonObjectSchema,

  result: z.enum(AUTOMATION_RESULTS),

  /** When it ended. Null while it is still running. */
  finishedAt: timestampSchema.nullable(),

  /** How long it took. */
  durationMs: z.int().min(0).nullable(),

  /** Step-by-step record, which is what makes a failed run debuggable in the interface. */
  trace: jsonObjectSchema.nullable(),

  /** Why it failed. */
  error: z.string().nullable(),
});

/** One recorded automation run. */
export type AutomationRun = z.output<typeof automationRunSchema>;
