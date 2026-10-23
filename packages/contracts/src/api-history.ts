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

/**
 * How one automation run ended. Mirrors the `automation_runs_result` CHECK.
 *
 * `condition_not_met` is not a failure: the automation woke, checked, and correctly did nothing.
 * The interface shows it as skipped. `cancelled` is a run another one replaced (restart mode), an
 * edit of the automation, or a shutdown.
 */
export const AUTOMATION_RUN_RESULTS = [
  'success',
  'condition_not_met',
  'failed',
  'timeout',
  'cancelled',
] as const;

/** How one automation run ended. */
export type AutomationRunResult = (typeof AUTOMATION_RUN_RESULTS)[number];

/** How one step of a run went. */
export const TRACE_STEP_RESULTS = [
  'ok',
  'true',
  'false',
  'failed',
  'timeout',
  'cancelled',
  'skipped',
  'partial',
] as const;

/** How one step of a run went. */
export type TraceStepResult = (typeof TRACE_STEP_RESULTS)[number];

/** Which part of the document a step belongs to. */
export const TRACE_STEP_KINDS = ['trigger', 'condition', 'action'] as const;

/** Which part of the document a step belongs to. */
export type TraceStepKind = (typeof TRACE_STEP_KINDS)[number];

/**
 * One step of a run: a trigger that fired, a condition that was checked, an action that ran.
 *
 * `path` locates the block in the document the way the editor addresses it (`if.0`,
 * `then.2.else.1`), so the interface can point at the card a step came from.
 */
export const traceStepSchema = z.object({
  path: z.string().max(200),
  kind: z.enum(TRACE_STEP_KINDS),

  /** The block's type: `entity`, `time`, `command`, `wait_for`… */
  type: z.string().max(40),

  /** When the step started. */
  at: timestampSchema,

  durationMs: z.int().min(0),
  result: z.enum(TRACE_STEP_RESULTS),

  /** The entity the step was about, when it was about one. */
  entityId: z.string().max(255).optional(),

  /** What it saw or did, in words: "living room motion is on", "sent turn_on". */
  detail: z.string().max(500).optional(),

  /** Why it failed. */
  error: z.string().max(500).optional(),
});

/** One step of a run. */
export type TraceStep = z.output<typeof traceStepSchema>;

/**
 * What started a run.
 *
 * `state` and `numeric_state` are the kinds runs were recorded under before the two triggers
 * became one `entity` trigger; they stay so those rows still read.
 */
export const AUTOMATION_RUN_TRIGGER_KINDS = [
  'entity',
  'time',
  'sun',
  'manual',
  'automation',
  'webhook',
  'state',
  'numeric_state',
] as const;

/** What started a run. */
export type AutomationRunTriggerKind = (typeof AUTOMATION_RUN_TRIGGER_KINDS)[number];

/** What started a run, as the run row records it. */
export const automationRunTriggerSchema = z.object({
  kind: z.enum(AUTOMATION_RUN_TRIGGER_KINDS),

  /** The trigger leaf that fired, as a path into `triggers`. Absent for manual and automation. */
  path: z.string().max(200).optional(),

  entityId: z.string().max(255).optional(),

  /** The state token left and entered, for a state trigger. */
  from: z.string().max(200).optional(),
  to: z.string().max(200).optional(),

  /** The reading that crossed, for a numeric trigger. */
  value: z.number().optional(),

  /** The sun event, for a sun trigger: `sunset`, `golden_hour_start`… */
  event: z.string().max(40).optional(),

  /** Who pressed Run, for a manual run. */
  userId: z.uuid().optional(),

  /** The automation and run that called this one, for a run started by another. */
  automationId: z.uuid().optional(),
  runId: z.uuid().optional(),
});

/** What started a run. */
export type AutomationRunTrigger = z.output<typeof automationRunTriggerSchema>;

/** One recorded automation run. */
export const automationRunSchema = z.object({
  id: z.uuid(),
  automationId: z.uuid(),

  /** When it started. */
  time: timestampSchema,

  /** What fired it. */
  trigger: automationRunTriggerSchema,

  result: z.enum(AUTOMATION_RUN_RESULTS),

  /** When it ended. */
  finishedAt: timestampSchema.nullable(),

  /** How long it took. */
  durationMs: z.int().min(0).nullable(),

  /** Step-by-step record, which is what makes a failed run debuggable in the interface. */
  trace: z.array(traceStepSchema).max(1_001),

  /** Why it failed. */
  error: z.string().nullable(),
});

/** One recorded automation run. */
export type AutomationRun = z.output<typeof automationRunSchema>;

/** The latest run of an automation, as a list row shows it. */
export const automationLastRunSchema = z.object({
  id: z.uuid(),
  time: timestampSchema,
  finishedAt: timestampSchema.nullable(),
  result: z.enum(AUTOMATION_RUN_RESULTS),
});

/** The latest run of an automation. */
export type AutomationLastRun = z.output<typeof automationLastRunSchema>;
