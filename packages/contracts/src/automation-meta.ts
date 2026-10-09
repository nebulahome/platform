/**
 * What every block of an automation shares, and the small vocabularies the blocks are written in.
 *
 * A block - a trigger, a condition, a group of conditions, an action - can carry a name its author
 * gave it and can be turned off without being deleted. Both are optional and both are absent on a
 * block nobody touched, so a document written before they existed reads exactly as it did.
 *
 * The vocabularies (comparison operators, days, months, clock times, durations, expression
 * variables) live here rather than beside the blocks that use them because triggers, conditions
 * and actions all use them, and none of those files should import another just for a word list.
 */
import { z } from 'zod';

import { entityIdSchema } from './entity-id.js';

/** How two numbers are compared, wherever this format compares them. */
export const COMPARISON_OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const;

/** How two numbers are compared. */
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/** The days a block can be restricted to, starting on Monday as the ISO week does. */
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

/** The months a time trigger can be restricted to, January first. */
export const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/** A month. */
export type Month = (typeof MONTHS)[number];

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

/**
 * The name an expression gives an entity's reading: `power`, `avg_power`.
 *
 * The same shape an alias gives its sources, because the same evaluator reads both. `true` and
 * `false` are literals in that language, so they cannot also be names.
 */
export const expressionVariableNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, 'Must be a lower-case variable name')
  .refine((name) => name !== 'true' && name !== 'false', {
    message: 'Is a word the expression already means something by',
  });

/** The entities an expression reads, by the names it uses for them. At most sixteen. */
export const expressionVariablesSchema = z
  .record(expressionVariableNameSchema, entityIdSchema)
  .refine((variables) => Object.keys(variables).length <= 16, {
    message: 'An expression reads sixteen entities at most',
  });

/** What every block carries besides what it does. */
export type BlockMeta = {
  /** What its author called it, shown in place of the sentence the editor writes for it. */
  readonly name?: string | undefined;

  /**
   * False when the block is turned off: kept in the document, skipped by the engine. Absent
   * means on, and the editor deletes the key rather than writing `true`, so a block nobody turned
   * off reads the same as one written before blocks could be.
   */
  readonly isEnabled?: boolean | undefined;
};

/**
 * The fields of {@link BlockMeta}, to spread into each block's object schema.
 *
 * Spread rather than merged with `.extend()` because the blocks are plain `z.object`s that strip
 * keys they do not declare: a block that did not declare these would lose its name on save.
 */
export const blockMetaShape = {
  name: z.string().trim().min(1).max(80).optional(),
  isEnabled: z.boolean().optional(),
};

/**
 * Whether the engine should take a block into account.
 *
 * @param block - Any trigger, condition or action.
 * @returns False only for a block turned off.
 */
export function isBlockEnabled(block: BlockMeta): boolean {
  return block.isEnabled !== false;
}
