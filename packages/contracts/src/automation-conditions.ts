/**
 * What has to hold before an automation acts, or before a branch of it runs.
 *
 * A list of conditions means all of them. To say "either", or to group a few, there are two
 * group blocks, AND and OR, which hold conditions of their own and nest. Any condition or group
 * can be turned around with NOT (`isNot`), named, or turned off, like every block.
 *
 * Four kinds of leaf. An entity in a state or past a number; a time of day and the days it holds
 * on; a phase of the sun; an expression over readings. One form for the editor and the document,
 * so what the editor holds is what is saved.
 */
import { z } from 'zod';

import {
  blockMetaShape,
  clockTimeSchema,
  COMPARISON_OPERATORS,
  DAYS_OF_WEEK,
  expressionVariablesSchema,
  type BlockMeta,
  type ComparisonOperator,
  type DayOfWeek,
} from './automation-meta.js';
import { sunElevationSchema } from './automation-triggers.js';
import { entityIdSchema } from './entity-id.js';
import { SUN_PERIODS, SUN_PHASES, type SunPeriod, type SunPhase } from './sun.js';

/** The leaf kinds of condition: what has to hold, without composing others. */
export const CONDITION_LEAF_TYPES = ['entity', 'time', 'sun', 'expression'] as const;

/** A leaf condition kind. */
export type ConditionLeafType = (typeof CONDITION_LEAF_TYPES)[number];

/** The group kinds. */
export const CONDITION_GROUP_TYPES = ['and', 'or'] as const;

/** A group kind. */
export type ConditionGroupType = (typeof CONDITION_GROUP_TYPES)[number];

/** Every kind of condition block. */
export const CONDITION_TYPES = [...CONDITION_LEAF_TYPES, ...CONDITION_GROUP_TYPES] as const;

/** A kind of condition block. */
export type ConditionType = (typeof CONDITION_TYPES)[number];

/** What every condition carries: the block's meta, and NOT. */
export type ConditionMeta = BlockMeta & {
  /** True when the condition is turned around: it holds when what it says does not. */
  readonly isNot?: boolean | undefined;
};

/** The fields of {@link ConditionMeta}, to spread into each condition's object schema. */
const conditionMetaShape = { ...blockMetaShape, isNot: z.boolean().optional() };

/** What an entity has to be: in one of some states, or past a number. */
export type EntityMatch =
  | { readonly kind: 'state'; readonly states: readonly string[] }
  | { readonly kind: 'numeric'; readonly operator: ComparisonOperator; readonly value: number };

/** A single check, with no composition. */
export type ConditionLeaf = ConditionMeta &
  (
    | { readonly type: 'entity'; readonly entityId: string; readonly match: EntityMatch }
    | {
        readonly type: 'time';

        /** From when. Absent means from midnight. */
        readonly from?: string | undefined;

        /** Until when. Absent means until midnight; before `from` means past midnight. */
        readonly to?: string | undefined;

        /** The days it holds on. Absent or empty means every day. */
        readonly days?: readonly DayOfWeek[] | undefined;
      }
    | {
        readonly type: 'sun';
        readonly phase: SunPhase;

        /** For `above` and `below`: the elevation, in degrees. */
        readonly elevation?: number | undefined;

        /** The morning or the evening half of the day. Absent means either. */
        readonly period?: SunPeriod | undefined;
      }
    | {
        readonly type: 'expression';
        readonly expression: string;

        /** The entities the expression reads, by the names it uses. Absent means none. */
        readonly variables?: Readonly<Record<string, string>> | undefined;
      }
  );

/** A group: all of its conditions (AND), or any one of them (OR). */
export type ConditionGroup = ConditionMeta & {
  readonly type: ConditionGroupType;
  readonly conditions: readonly ConditionNode[];
};

/** A condition block: a leaf or a group. */
export type ConditionNode = ConditionLeaf | ConditionGroup;

/**
 * Whether a condition block is a group.
 *
 * @param node - A leaf or a group.
 * @returns True for AND and OR.
 */
export function isConditionGroup(node: ConditionNode): node is ConditionGroup {
  return node.type === 'and' || node.type === 'or';
}

/** What an entity has to be. */
export const entityMatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('state'), states: z.array(z.string().min(1)).min(1).max(20) }),
  z.object({
    kind: z.literal('numeric'),
    operator: z.enum(COMPARISON_OPERATORS),
    value: z.number(),
  }),
]);

/** The leaf schemas, each with the meta every condition carries. */
const entityConditionSchema = z.object({
  type: z.literal('entity'),
  ...conditionMetaShape,
  entityId: entityIdSchema,
  match: entityMatchSchema,
});

const timeConditionSchema = z
  .object({
    type: z.literal('time'),
    ...conditionMetaShape,
    from: clockTimeSchema.optional(),
    to: clockTimeSchema.optional(),
    days: z.array(z.enum(DAYS_OF_WEEK)).max(7).optional(),
  })
  .superRefine((condition, context) => {
    if (
      condition.from === undefined &&
      condition.to === undefined &&
      (condition.days ?? []).length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'Needs a time, a day, or both',
      });
    }
  });

const sunConditionSchema = z
  .object({
    type: z.literal('sun'),
    ...conditionMetaShape,
    phase: z.enum(SUN_PHASES),
    elevation: sunElevationSchema.optional(),
    period: z.enum(SUN_PERIODS).optional(),
  })
  .superRefine((condition, context) => {
    if (
      (condition.phase === 'above' || condition.phase === 'below') &&
      condition.elevation === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['elevation'],
        message: 'Needs the elevation to compare with',
      });
    }
  });

const expressionConditionSchema = z.object({
  type: z.literal('expression'),
  ...conditionMetaShape,

  /** Evaluated in the engine's sandbox. Bounded there, not here. */
  expression: z.string().min(1).max(2_000),

  /** The entities it reads, by the names it uses for them. */
  variables: expressionVariablesSchema.optional(),
});

/** A condition block: a leaf, or an AND or OR group of more. */
export const conditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    entityConditionSchema,
    timeConditionSchema,
    sunConditionSchema,
    expressionConditionSchema,
    z.object({
      type: z.literal('and'),
      ...conditionMetaShape,
      conditions: z.array(conditionNodeSchema).min(1).max(20),
    }),
    z.object({
      type: z.literal('or'),
      ...conditionMetaShape,
      conditions: z.array(conditionNodeSchema).min(1).max(20),
    }),
  ]),
);

/**
 * A list of conditions, all of which must hold.
 *
 * @param min - The fewest it may have: none where an empty list simply passes.
 * @returns The schema.
 */
export function conditionListSchema(min: number): z.ZodType<ConditionNode[]> {
  return z.array(conditionNodeSchema).min(min).max(20);
}

/**
 * Every leaf in a list of conditions, however deeply grouped, left to right.
 *
 * @param nodes - The conditions.
 * @returns The leaves.
 */
export function conditionLeavesOf(nodes: readonly ConditionNode[]): ConditionLeaf[] {
  return nodes.flatMap((node) =>
    isConditionGroup(node) ? conditionLeavesOf(node.conditions) : [node],
  );
}
