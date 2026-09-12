/**
 * What an automation actually says: when this happens, if these hold, do this.
 *
 * `registry.automations.definition` is a `jsonb` column, and the comment beside it in the schema
 * has always promised that the document inside is validated against a schema of this name. This
 * is that schema. Until it existed the column was validated by nothing at all, which is the kind
 * of gap that only shows up as an engine crashing on a document written a year earlier.
 *
 * The shape is [ARCHITECTURE.md §6.1](../../../../ARCHITECTURE.md#61-automation-engine) and
 * nothing more. Every trigger, condition and action listed there is here, and nothing that is
 * not listed there is here - an automation format that grows past its own design document is one
 * the engine has to guess at.
 *
 * **This validates the document, not the world it refers to.** That an entity exists, that a
 * scene is real, that a package offers the service being called: none of that can be known from
 * the document, and all of it can stop being true after it is written. The engine resolves those
 * when it runs, and a run that cannot resolve one is a traced failure rather than a rejected
 * save - otherwise renaming an entity would make every automation mentioning it unsaveable.
 *
 * Conditions and actions nest, so both are recursive. Zod cannot infer a recursive type on its
 * own, which is why each of those two declares its TypeScript type by hand and hands it to
 * `z.lazy`. The types are the source of truth for the shape; the schemas are the source of truth
 * for what is accepted.
 */
import { z } from 'zod';

import { capabilityNameSchema } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { jsonObjectSchema } from './json.js';

/** How two numbers are compared, wherever this format compares them. */
export const COMPARISON_OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const;

/** How two numbers are compared. */
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/** The days a condition can be restricted to, starting on Monday as the ISO week does. */
export const DAYS_OF_WEEK = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** A day of the week. */
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

/** The two moments the sun gives a home automation. */
export const SOLAR_EVENTS = ['sunrise', 'sunset'] as const;

/** A moment defined by the sun rather than by the clock. */
export type SolarEvent = (typeof SOLAR_EVENTS)[number];

/** A time of day, as `HH:MM` or `HH:MM:SS` on a 24-hour clock. */
export const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Must be a time of day, as HH:MM or HH:MM:SS');

/**
 * A cron expression, in five or six fields.
 *
 * Checked for its shape and no further. A cron expression is a small language, and the parser the
 * engine schedules with is the only thing that can say whether `*\/7` on a 31-day month means what
 * its author hoped. Refusing to save what that parser would accept is worse than letting it
 * report the problem itself.
 */
export const cronExpressionSchema = z
  .string()
  .trim()
  .regex(/^(\S+\s+){4,5}\S+$/, 'Must be a cron expression of five or six fields');

/** A stretch of time, in milliseconds. Capped at a week: longer belongs to a schedule. */
export const durationMsSchema = z.int().min(0).max(604_800_000);

/** The kinds of trigger an automation can wake on. */
export const TRIGGER_TYPES = ['state', 'numeric_state', 'time', 'event', 'manual'] as const;

/** What wakes an automation. */
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** An entity entering, leaving, or changing to a given state. */
const stateTriggerSchema = z.object({
  type: z.literal('state'),
  entityId: entityIdSchema,

  /** The state being left. Absent means any. */
  from: z.string().nullish(),

  /** The state being entered. Absent means any change at all. */
  to: z.string().nullish(),

  /** How long the entity must hold the new state before this counts as having fired. */
  forMs: durationMsSchema.nullish(),
});

/** A numeric reading crossing a threshold. */
const numericStateTriggerSchema = z.object({
  type: z.literal('numeric_state'),
  entityId: entityIdSchema,
  operator: z.enum(COMPARISON_OPERATORS),
  value: z.number(),
  forMs: durationMsSchema.nullish(),
});

/** A fixed time, a cron expression, or a solar event. */
const timeTriggerSchema = z.object({
  type: z.literal('time'),
  at: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('clock'), time: clockTimeSchema }),
    z.object({ kind: z.literal('cron'), expression: cronExpressionSchema }),
    z.object({
      kind: z.literal('solar'),
      event: z.enum(SOLAR_EVENTS),

      /** Minutes before (negative) or after (positive) the event. */
      offsetMinutes: z.int().min(-720).max(720).default(0),
    }),
  ]),
});

/** A device event - a button press, a scene controller - or a platform event. */
const eventTriggerSchema = z.object({
  type: z.literal('event'),

  /** What happened, e.g. `button.pressed`. */
  event: z.string().min(1),

  /** Which entity it has to have come from. Absent means any. */
  entityId: entityIdSchema.nullish(),

  /** Fields the event must carry, matched exactly. */
  match: jsonObjectSchema.default({}),
});

/** Somebody, or something, asking for it explicitly. */
const manualTriggerSchema = z.object({ type: z.literal('manual') });

/** What wakes an automation. */
export const automationTriggerSchema = z.discriminatedUnion('type', [
  stateTriggerSchema,
  numericStateTriggerSchema,
  timeTriggerSchema,
  eventTriggerSchema,
  manualTriggerSchema,
]);

/** What wakes an automation. */
export type AutomationTrigger = z.output<typeof automationTriggerSchema>;

/** The kinds of condition an automation can be gated on. */
export const CONDITION_TYPES = [
  'state',
  'numeric',
  'time_window',
  'day_of_week',
  'area_occupancy',
  'expression',
  'and',
  'or',
  'not',
] as const;

/** What has to hold before the actions run. */
export type ConditionType = (typeof CONDITION_TYPES)[number];

/**
 * What has to hold before the actions run.
 *
 * Declared by hand because it refers to itself: `and`, `or` and `not` take conditions, which is
 * what makes a rule like "after sunset, unless somebody is in the kitchen" expressible at all.
 */
export type AutomationCondition =
  | { readonly type: 'state'; readonly entityId: string; readonly state: string }
  | {
      readonly type: 'numeric';
      readonly entityId: string;
      readonly operator: ComparisonOperator;
      readonly value: number;
    }
  | { readonly type: 'time_window'; readonly from: string; readonly to: string }
  | { readonly type: 'day_of_week'; readonly days: readonly DayOfWeek[] }
  | { readonly type: 'area_occupancy'; readonly areaKey: string; readonly isOccupied: boolean }
  | { readonly type: 'expression'; readonly expression: string }
  | { readonly type: 'and'; readonly conditions: readonly AutomationCondition[] }
  | { readonly type: 'or'; readonly conditions: readonly AutomationCondition[] }
  | { readonly type: 'not'; readonly condition: AutomationCondition };

/** What has to hold before the actions run. */
export const automationConditionSchema: z.ZodType<AutomationCondition> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('state'), entityId: entityIdSchema, state: z.string().min(1) }),
    z.object({
      type: z.literal('numeric'),
      entityId: entityIdSchema,
      operator: z.enum(COMPARISON_OPERATORS),
      value: z.number(),
    }),
    z.object({
      type: z.literal('time_window'),
      from: clockTimeSchema,

      /** A window whose end is before its start wraps past midnight, which is what "at night" is. */
      to: clockTimeSchema,
    }),
    z.object({ type: z.literal('day_of_week'), days: z.array(z.enum(DAYS_OF_WEEK)).min(1) }),
    z.object({
      type: z.literal('area_occupancy'),
      areaKey: z.string().min(1),
      isOccupied: z.boolean(),
    }),
    z.object({
      type: z.literal('expression'),

      /** Evaluated in the engine's sandbox. Bounded there, not here. */
      expression: z.string().min(1).max(2_000),
    }),
    z.object({ type: z.literal('and'), conditions: z.array(automationConditionSchema).min(1) }),
    z.object({ type: z.literal('or'), conditions: z.array(automationConditionSchema).min(1) }),
    z.object({ type: z.literal('not'), condition: automationConditionSchema }),
  ]),
);

/** The kinds of thing an automation can do. */
export const ACTION_TYPES = [
  'command',
  'scene',
  'automation',
  'wait_duration',
  'wait_for',
  'notify',
  'package_service',
  'parallel',
] as const;

/** Something an automation does. */
export type ActionType = (typeof ACTION_TYPES)[number];

/**
 * Something an automation does.
 *
 * Recursive for one reason: `parallel`. Actions run in order unless a block says otherwise, and
 * that block holds actions.
 */
export type AutomationAction =
  | {
      readonly type: 'command';
      readonly entityId: string;
      readonly capability: string;
      readonly params: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'scene'; readonly sceneKey: string }
  | { readonly type: 'automation'; readonly automationKey: string }
  | { readonly type: 'wait_duration'; readonly durationMs: number }
  | {
      readonly type: 'wait_for';
      readonly condition: AutomationCondition;
      readonly timeoutMs: number;
    }
  | { readonly type: 'notify'; readonly channel: string; readonly message: string }
  | {
      readonly type: 'package_service';
      readonly packageId: string;
      readonly service: string;
      readonly params: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'parallel'; readonly actions: readonly AutomationAction[] };

/** Something an automation does. */
export const automationActionSchema: z.ZodType<AutomationAction> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('command'),
      entityId: entityIdSchema,
      capability: capabilityNameSchema,
      params: jsonObjectSchema.default({}),
    }),
    z.object({ type: z.literal('scene'), sceneKey: z.string().min(1) }),
    z.object({ type: z.literal('automation'), automationKey: z.string().min(1) }),
    z.object({ type: z.literal('wait_duration'), durationMs: durationMsSchema }),
    z.object({
      type: z.literal('wait_for'),
      condition: automationConditionSchema,

      /** How long to wait before giving up. A wait with no end is a run that never finishes. */
      timeoutMs: durationMsSchema,
    }),
    z.object({
      type: z.literal('notify'),
      channel: z.string().min(1),
      message: z.string().min(1).max(2_000),
    }),
    z.object({
      type: z.literal('package_service'),
      packageId: z.string().min(1),
      service: z.string().min(1),
      params: jsonObjectSchema.default({}),
    }),
    z.object({ type: z.literal('parallel'), actions: z.array(automationActionSchema).min(1) }),
  ]),
);

/**
 * The whole document.
 *
 * At least one trigger and at least one action, because an automation with neither is a row that
 * can never do anything and saving one is a way of losing work quietly. Conditions are optional:
 * plenty of useful automations are "when this happens, do that".
 *
 * The ceilings are there so a document cannot be used to exhaust the engine before the engine
 * exists to defend itself. They are generous by the standards of a house.
 */
export const automationDefinitionSchema = z.object({
  triggers: z.array(automationTriggerSchema).min(1).max(20),
  conditions: z.array(automationConditionSchema).max(20).default([]),
  actions: z.array(automationActionSchema).min(1).max(50),
});

/** What an automation says. */
export type AutomationDefinition = z.output<typeof automationDefinitionSchema>;
