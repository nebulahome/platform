/**
 * What wakes an automation.
 *
 * A flat list: any one of the triggers firing wakes it. There is no AND between triggers - two
 * things rarely happen in the same instant, and "this happened while that holds" is what the
 * conditions are for.
 *
 * Six kinds. An entity changing (to a state, or across a number), a time on the clock, a moment
 * of the sun, a device event, somebody asking, or somebody calling its webhook address. Each
 * carries the {@link BlockMeta} every block does: a name, and whether it is turned off.
 */
import { z } from 'zod';

import {
  blockMetaShape,
  clockTimeSchema,
  COMPARISON_OPERATORS,
  cronExpressionSchema,
  DAYS_OF_WEEK,
  durationMsSchema,
  MONTHS,
  type DayOfWeek,
  type Month,
} from './automation-meta.js';
import { entityIdSchema } from './entity-id.js';
import { jsonObjectSchema } from './json.js';
import { SUN_DIRECTIONS, SUN_EVENTS, SUN_PERIODS } from './sun.js';

/**
 * Trigger kinds the format holds but the engine cannot wake on yet.
 *
 * Nothing reports device events to the bus - a button press has no state to change - so an
 * `event` trigger is saved and shown, and never fires. Listed in `design/missing.md`.
 */
export const UNAVAILABLE_TRIGGER_TYPES = ['event'] as const;

/** The kinds of trigger an automation can wake on. */
export const TRIGGER_TYPES = ['entity', 'time', 'sun', 'event', 'manual', 'webhook'] as const;

/** What wakes an automation. */
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** An elevation of the sun, in degrees. */
export const sunElevationSchema = z.number().min(-90).max(90);

/**
 * What an entity has to do: change state, or cross a number.
 *
 * Which one is offered follows from the entity: a switch has states, a temperature has a
 * number, a dimmable light has both and the editor lets its author pick.
 */
export const entityChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('state'),

    /** The state being left. Absent means any. */
    from: z.string().nullish(),

    /** The state being entered. Absent means any change at all. */
    to: z.string().nullish(),
  }),
  z.object({
    kind: z.literal('numeric'),
    operator: z.enum(COMPARISON_OPERATORS),
    value: z.number(),
  }),
]);

/** What an entity has to do. */
export type EntityChange = z.output<typeof entityChangeSchema>;

/** An entity changing. */
const entityTriggerSchema = z.object({
  type: z.literal('entity'),
  ...blockMetaShape,
  entityId: entityIdSchema,
  change: entityChangeSchema,

  /** How long the entity must hold the new state, or stay past the number, to count. */
  forMs: durationMsSchema.nullish(),
});

/**
 * When on the clock: a time with the days and months it applies to, or a cron expression.
 *
 * The simple form is kept as written rather than compiled to cron, so it opens again as the
 * fields its author filled in. {@link clockAtToCron} is the one place it becomes cron.
 */
export const timeAtSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('clock'),
    time: clockTimeSchema,

    /** The days it fires on. Absent or empty means every day. */
    weekdays: z.array(z.enum(DAYS_OF_WEEK)).max(7).optional(),

    /** The months it fires in. Absent or empty means every month. */
    months: z.array(z.enum(MONTHS)).max(12).optional(),
  }),
  z.object({ kind: z.literal('cron'), expression: cronExpressionSchema }),
]);

/** When on the clock. */
export type TimeAt = z.output<typeof timeAtSchema>;

/** A time on the clock. */
const timeTriggerSchema = z.object({
  type: z.literal('time'),
  ...blockMetaShape,
  at: timeAtSchema,
});

/** A moment of the sun. */
const sunTriggerSchema = z
  .object({
    type: z.literal('sun'),
    ...blockMetaShape,
    event: z.enum(SUN_EVENTS),

    /** Minutes before (negative) or after (positive) the event. Absent means at it. */
    offsetMinutes: z.int().min(-720).max(720).optional(),

    /** For the golden and blue hour, which of the two a day has. Absent means both. */
    period: z.enum(SUN_PERIODS).optional(),

    /** For `elevation_crossed`: the elevation, in degrees. */
    elevation: sunElevationSchema.optional(),

    /** For `elevation_crossed`: which way through it. Absent means either. */
    direction: z.enum(SUN_DIRECTIONS).optional(),
  })
  .superRefine((trigger, context) => {
    if (trigger.event === 'elevation_crossed' && trigger.elevation === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['elevation'],
        message: 'Needs the elevation the sun crosses',
      });
    }
  });

/** A device event - a button press, a scene controller - or a platform event. */
const eventTriggerSchema = z.object({
  type: z.literal('event'),
  ...blockMetaShape,

  /** What happened, e.g. `button.pressed`. */
  event: z.string().min(1),

  /** Which entity it has to have come from. Absent means any. */
  entityId: entityIdSchema.nullish(),

  /** Fields the event must carry, matched exactly. */
  match: jsonObjectSchema.optional(),
});

/** Somebody, or something, asking for it explicitly. */
const manualTriggerSchema = z.object({ type: z.literal('manual'), ...blockMetaShape });

/** The methods a webhook can be called with. */
export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** A method a webhook can be called with. */
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number];

/** Where a webhook may be called from: the house's own network, or anywhere. */
export const WEBHOOK_REACHES = ['local', 'internet'] as const;

/** Where a webhook may be called from. */
export type WebhookReach = (typeof WEBHOOK_REACHES)[number];

/**
 * A webhook's id: the last part of its address, 128 random bits in hexadecimal. Knowing it is
 * what lets somebody start the automation, so it is as long as a password should be.
 */
export const webhookIdSchema = z.string().regex(/^[0-9a-f]{32}$/u, 'Must be 32 hexadecimal digits');

/** Somebody, or something, calling the automation's address: `/api/hooks/<hookId>`. */
const webhookTriggerSchema = z.object({
  type: z.literal('webhook'),
  ...blockMetaShape,
  hookId: webhookIdSchema,

  /** The one method it answers, or any. Another gets 405 and starts nothing. */
  method: z.enum([...WEBHOOK_METHODS, 'any']),

  /** `local` answers 404 to a call from outside the house's network. */
  reach: z.enum(WEBHOOK_REACHES),
});

/** What wakes an automation. */
export const automationTriggerSchema = z.discriminatedUnion('type', [
  entityTriggerSchema,
  timeTriggerSchema,
  sunTriggerSchema,
  eventTriggerSchema,
  manualTriggerSchema,
  webhookTriggerSchema,
]);

/** What wakes an automation. */
export type AutomationTrigger = z.output<typeof automationTriggerSchema>;

/** The weekdays as cron numbers them, Sunday first. */
const CRON_WEEKDAYS: readonly DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * Writes a list of numbers as one cron field.
 *
 * @param numbers - The values, in any order.
 * @returns `*` for none, otherwise the values comma-separated in order.
 */
function cronField(numbers: readonly number[]): string {
  return numbers.length === 0
    ? '*'
    : [...new Set(numbers)].toSorted((left, right) => left - right).join(',');
}

/**
 * The cron expression a simple clock time stands for: seconds, minutes, hours, any day of the
 * month, the months, the weekdays.
 *
 * @param at - The time, with its weekdays and months.
 * @returns Six cron fields.
 */
export function clockAtToCron(at: Extract<TimeAt, { kind: 'clock' }>): string {
  const [hours = '0', minutes = '0', seconds = '0'] = at.time.split(':');
  const months = (at.months ?? []).map((month: Month) => MONTHS.indexOf(month) + 1);
  const weekdays = (at.weekdays ?? []).map((day) => CRON_WEEKDAYS.indexOf(day));

  return [
    String(Number(seconds)),
    String(Number(minutes)),
    String(Number(hours)),
    '*',
    cronField(months),
    cronField(weekdays),
  ].join(' ');
}
