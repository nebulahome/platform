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
 * The saved document is `{ triggers, if, then }`. Triggers and `if` are boolean trees (AND/OR,
 * and NOT on `if`); `then` is the action sequence. A legacy document `{ triggers, conditions,
 * actions }` is still accepted: a flat trigger list becomes OR, a flat conditions list becomes
 * AND under `if`, and `actions` become `then`.
 *
 * **This validates the document, not the world it refers to.** That an entity exists, that a
 * scene is real, that a package offers the service being called: none of that can be known from
 * the document, and all of it can stop being true after it is written. The engine resolves those
 * when it runs, and a run that cannot resolve one is a traced failure rather than a rejected
 * save - otherwise renaming an entity would make every automation mentioning it unsaveable.
 *
 * Trees and actions nest, so both are recursive. Zod cannot infer a recursive type on its own,
 * which is why each declares its TypeScript type by hand and hands it to `z.lazy`. The types are
 * the source of truth for the shape; the schemas are the source of truth for what is accepted.
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

/**
 * A trigger tree: leaves are triggers, nodes combine them with AND or OR.
 *
 * AND binds tighter than OR when a UI flattens a sequence of blocks into a tree; the document
 * itself stores the tree explicitly. A legacy flat list of triggers is read as OR.
 */
export type TriggerTree =
  AutomationTrigger | { readonly op: 'and' | 'or'; readonly items: readonly TriggerTree[] };

/**
 * Whether a value looks like a trigger-tree node rather than a leaf.
 *
 * @param value - A leaf or a node.
 * @returns True for an AND or OR node.
 */
export function isTriggerTreeOp(
  value: TriggerTree,
): value is Extract<TriggerTree, { readonly op: 'and' | 'or' }> {
  return 'op' in value;
}

/** A trigger tree. */
export const triggerTreeSchema: z.ZodType<TriggerTree> = z.lazy(() =>
  z.union([
    automationTriggerSchema,
    z.object({
      op: z.enum(['and', 'or']),
      items: z.array(triggerTreeSchema).min(1).max(20),
    }),
  ]),
);

/** The leaf kinds of condition — what has to hold, without composing others. */
export const CONDITION_LEAF_TYPES = [
  'state',
  'numeric',
  'time_window',
  'day_of_week',
  'area_occupancy',
  'expression',
] as const;

/** A leaf condition kind. */
export type ConditionLeafType = (typeof CONDITION_LEAF_TYPES)[number];

/**
 * The kinds of condition an automation can be gated on.
 *
 * Includes the draft/editor composition forms (`and` / `or` / `not` with a `type` field). The
 * saved document uses {@link BooleanTree} with `op` instead; see {@link booleanTreeFromCondition}.
 */
export const CONDITION_TYPES = [...CONDITION_LEAF_TYPES, 'and', 'or', 'not'] as const;

/** What has to hold before the actions run. */
export type ConditionType = (typeof CONDITION_TYPES)[number];

/** A single check, with no composition. */
export type ConditionLeaf =
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
  | { readonly type: 'expression'; readonly expression: string };

/**
 * A condition as the draft/editor holds it.
 *
 * Composition here still uses `type: 'and' | 'or' | 'not'` so existing field components keep
 * working. The document's `if` field stores the same idea as {@link BooleanTree}.
 */
export type AutomationCondition =
  | ConditionLeaf
  | { readonly type: 'and'; readonly conditions: readonly AutomationCondition[] }
  | { readonly type: 'or'; readonly conditions: readonly AutomationCondition[] }
  | { readonly type: 'not'; readonly condition: AutomationCondition };

/**
 * Boolean tree for `if` and for conditions inside actions.
 *
 * Leaves are any condition leaf (entity state, numeric, time, …). Non-state leaves already saved
 * must still parse. Nodes are `{ op: 'and' | 'or', items }` or unary `{ op: 'not', item }`. A
 * legacy flat conditions array is read as AND.
 */
export type BooleanTree =
  | ConditionLeaf
  | { readonly op: 'and' | 'or'; readonly items: readonly BooleanTree[] }
  | { readonly op: 'not'; readonly item: BooleanTree };

/**
 * Whether a value looks like a boolean-tree node rather than a leaf.
 *
 * @param value - A leaf or a node.
 * @returns True for an AND, OR or NOT node.
 */
export function isBooleanTreeOp(
  value: BooleanTree,
): value is Extract<BooleanTree, { readonly op: 'and' | 'or' | 'not' }> {
  return 'op' in value;
}

/** A leaf condition. */
export const conditionLeafSchema: z.ZodType<ConditionLeaf> = z.discriminatedUnion('type', [
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
]);

/**
 * Rewrites a legacy `type: 'and' | 'or' | 'not'` node into the `op` tree, and walks children.
 *
 * @param raw - Whatever was stored.
 * @returns The same idea in {@link BooleanTree} shape, or the input when it is not an object.
 */
export function migrateBooleanTree(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }

  const node = raw as Record<string, unknown>;
  const op = node['op'];
  const type = node['type'];

  if (op === 'and' || op === 'or') {
    const items = node['items'];

    if (!Array.isArray(items)) {
      return raw;
    }

    return { op, items: items.map((item) => migrateBooleanTree(item)) };
  }

  if (op === 'not') {
    return { op: 'not', item: migrateBooleanTree(node['item']) };
  }

  if (type === 'and' || type === 'or') {
    const conditions = node['conditions'];
    const children = Array.isArray(conditions) ? conditions : [];

    return { op: type, items: children.map((item) => migrateBooleanTree(item)) };
  }

  if (type === 'not') {
    return { op: 'not', item: migrateBooleanTree(node['condition']) };
  }

  return raw;
}

/** A boolean tree. Accepts legacy `type`-style composition and rewrites it to `op`. */
export const booleanTreeSchema: z.ZodType<BooleanTree> = z.lazy(() =>
  z.preprocess(
    migrateBooleanTree,
    z.union([
      conditionLeafSchema,
      z.object({
        op: z.enum(['and', 'or']),
        items: z.array(booleanTreeSchema).min(1).max(20),
      }),
      z.object({ op: z.literal('not'), item: booleanTreeSchema }),
    ]),
  ),
);

/**
 * A condition as the draft/editor composes it (`type: 'and' | 'or' | 'not'`).
 *
 * Prefer {@link booleanTreeSchema} for anything that is persisted.
 */
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
      expression: z.string().min(1).max(2_000),
    }),
    z.object({ type: z.literal('and'), conditions: z.array(automationConditionSchema).min(1) }),
    z.object({ type: z.literal('or'), conditions: z.array(automationConditionSchema).min(1) }),
    z.object({ type: z.literal('not'), condition: automationConditionSchema }),
  ]),
);

/**
 * Turns a draft/editor condition into the document's boolean tree.
 *
 * @param condition - The draft form.
 * @returns The same check as a {@link BooleanTree}.
 */
export function booleanTreeFromCondition(condition: AutomationCondition): BooleanTree {
  if (condition.type === 'and') {
    return { op: 'and', items: condition.conditions.map(booleanTreeFromCondition) };
  }

  if (condition.type === 'or') {
    return { op: 'or', items: condition.conditions.map(booleanTreeFromCondition) };
  }

  if (condition.type === 'not') {
    return { op: 'not', item: booleanTreeFromCondition(condition.condition) };
  }

  return condition;
}

/**
 * Turns a document boolean tree into the draft/editor condition form.
 *
 * @param tree - The stored tree.
 * @returns The same check with `type`-style composition.
 */
export function conditionFromBooleanTree(tree: BooleanTree): AutomationCondition {
  if (isBooleanTreeOp(tree)) {
    if (tree.op === 'not') {
      return { type: 'not', condition: conditionFromBooleanTree(tree.item) };
    }

    return { type: tree.op, conditions: tree.items.map(conditionFromBooleanTree) };
  }

  return tree;
}

/** The kinds of thing an automation can do. */
export const ACTION_TYPES = [
  'command',
  'scene',
  'automation',
  'wait_duration',
  'wait_for',
  'wait_for_trigger',
  'notify',
  'package_service',
  'parallel',
  'sequence',
  'switch',
  'while',
  'do_while',
  'if',
  'for',
  'stop',
] as const;

/** Something an automation does. */
export type ActionType = (typeof ACTION_TYPES)[number];

/** Action kinds that hold other actions (or branches of them). */
export const NESTED_ACTION_TYPES = [
  'parallel',
  'sequence',
  'switch',
  'while',
  'do_while',
  'if',
  'for',
] as const;

/** How a `for` block repeats. */
export type ForRepeat =
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'each'; readonly items: string };

/**
 * Something an automation does.
 *
 * Recursive: blocks that hold other actions (`parallel`, `sequence`, `switch`, loops, `if`) nest
 * the same action type. Conditions inside `if` / `while` / `do_while` use {@link BooleanTree}.
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
      readonly condition: BooleanTree;
      readonly timeoutMs: number;
    }
  | {
      readonly type: 'wait_for_trigger';
      readonly trigger: AutomationTrigger;
      readonly timeoutMs: number;
    }
  | { readonly type: 'notify'; readonly channel: string; readonly message: string }
  | {
      readonly type: 'package_service';
      readonly packageId: string;
      readonly service: string;
      readonly params: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'parallel'; readonly actions: readonly AutomationAction[] }
  | { readonly type: 'sequence'; readonly actions: readonly AutomationAction[] }
  | {
      readonly type: 'switch';
      readonly entityId: string;
      readonly cases: readonly {
        readonly value: string;
        readonly actions: readonly AutomationAction[];
      }[];
      readonly default?: readonly AutomationAction[] | undefined;
    }
  | {
      readonly type: 'while';
      readonly condition: BooleanTree;
      readonly actions: readonly AutomationAction[];
    }
  | {
      readonly type: 'do_while';
      readonly condition: BooleanTree;
      readonly actions: readonly AutomationAction[];
    }
  | {
      readonly type: 'if';
      readonly condition: BooleanTree;
      readonly then: readonly AutomationAction[];
      readonly else?: readonly AutomationAction[] | undefined;
    }
  | {
      readonly type: 'for';
      readonly over: ForRepeat;
      readonly actions: readonly AutomationAction[];
    }
  | { readonly type: 'stop' };

/**
 * A list of nested actions.
 *
 * @returns The schema of a branch or a loop body.
 */
const nestedActionsSchema = (): z.ZodType<AutomationAction[]> =>
  z.array(automationActionSchema).max(50);

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
      condition: booleanTreeSchema,

      /** How long to wait before giving up. A wait with no end is a run that never finishes. */
      timeoutMs: durationMsSchema,
    }),
    z.object({
      type: z.literal('wait_for_trigger'),
      trigger: automationTriggerSchema,
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
    z.object({
      type: z.literal('parallel'),
      actions: z.array(automationActionSchema).min(1).max(50),
    }),
    z.object({
      type: z.literal('sequence'),
      actions: z.array(automationActionSchema).min(1).max(50),
    }),
    z.object({
      type: z.literal('switch'),
      entityId: entityIdSchema,
      cases: z
        .array(
          z.object({
            value: z.string().min(1),
            actions: nestedActionsSchema(),
          }),
        )
        .min(1)
        .max(20),
      default: nestedActionsSchema().optional(),
    }),
    z.object({
      type: z.literal('while'),
      condition: booleanTreeSchema,
      actions: z.array(automationActionSchema).min(1).max(50),
    }),
    z.object({
      type: z.literal('do_while'),
      condition: booleanTreeSchema,
      actions: z.array(automationActionSchema).min(1).max(50),
    }),
    z.object({
      type: z.literal('if'),
      condition: booleanTreeSchema,
      then: nestedActionsSchema(),
      else: nestedActionsSchema().optional(),
    }),
    z.object({
      type: z.literal('for'),
      over: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('count'), count: z.int().min(1).max(10_000) }),
        z.object({ kind: z.literal('each'), items: z.string().min(1).max(2_000) }),
      ]),
      actions: z.array(automationActionSchema).min(1).max(50),
    }),
    z.object({ type: z.literal('stop') }),
  ]),
);

/**
 * Rewrites a legacy flat trigger list into a tree (OR), and walks `op` nodes.
 *
 * @param raw - Whatever was stored under `triggers`.
 * @returns A {@link TriggerTree}-shaped value for the inner schema to check.
 */
export function migrateTriggers(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    if (raw.length === 1) {
      return migrateTriggerNode(raw[0]);
    }

    return { op: 'or', items: raw.map((item) => migrateTriggerNode(item)) };
  }

  return migrateTriggerNode(raw);
}

/**
 * Walks one trigger-tree node.
 *
 * @param raw - A leaf or an `op` node.
 * @returns The same shape with children migrated.
 */
function migrateTriggerNode(raw: unknown): unknown {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'op' in raw) {
    const node = raw as { op: unknown; items?: unknown };

    if ((node.op === 'and' || node.op === 'or') && Array.isArray(node.items)) {
      return { op: node.op, items: node.items.map((item) => migrateTriggerNode(item)) };
    }
  }

  return raw;
}

/**
 * Builds the `if` tree from a legacy `conditions` array (AND) or an already-migrated tree.
 *
 * @param raw - A tree, a flat list, or absent.
 * @returns A {@link BooleanTree}, or `undefined` when there is nothing to check.
 */
export function migrateIf(raw: unknown): unknown {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return undefined;
    }

    if (raw.length === 1) {
      return migrateBooleanTree(raw[0]);
    }

    return { op: 'and', items: raw.map((item) => migrateBooleanTree(item)) };
  }

  return migrateBooleanTree(raw);
}

/**
 * Lifts a legacy `{ triggers, conditions, actions }` document into `{ triggers, if, then }`.
 *
 * @param raw - Whatever was stored in the column.
 * @returns The document shape the inner schema expects.
 */
export function migrateDefinition(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }

  const doc = raw as Record<string, unknown>;
  const hasLegacyActions = 'actions' in doc && !('then' in doc);
  const hasLegacyConditions = 'conditions' in doc && !('if' in doc);

  const migrated: Record<string, unknown> = {
    triggers: migrateTriggers(doc['triggers']),
    then: hasLegacyActions ? doc['actions'] : doc['then'],
  };

  if ('if' in doc) {
    const tree = migrateIf(doc['if']);

    if (tree !== undefined) {
      migrated['if'] = tree;
    }
  } else if (hasLegacyConditions) {
    const tree = migrateIf(doc['conditions']);

    if (tree !== undefined) {
      migrated['if'] = tree;
    }
  }

  return migrated;
}

/**
 * The whole document: `{ triggers, if, then }`.
 *
 * At least one trigger and at least one action in `then`, because an automation with neither is
 * a row that can never do anything and saving one is a way of losing work quietly. `if` is
 * optional: plenty of useful automations are "when this happens, do that".
 *
 * Legacy `{ triggers, conditions, actions }` is accepted and normalised. The ceilings are there
 * so a document cannot be used to exhaust the engine before the engine exists to defend itself.
 */
const automationDefinitionObjectSchema = z.object({
  triggers: triggerTreeSchema,
  if: booleanTreeSchema.optional(),
  then: z.array(automationActionSchema).min(1).max(50),
});

/** The whole document, accepting legacy shapes. */
export const automationDefinitionSchema: z.ZodType<AutomationDefinition> = z.preprocess(
  migrateDefinition,
  automationDefinitionObjectSchema,
);

/** What an automation says. */
export type AutomationDefinition = {
  /** What wakes it — a leaf or an AND/OR tree. */
  readonly triggers: TriggerTree;

  /** What must hold before `then` runs. Absent means nothing to check. */
  readonly if?: BooleanTree | undefined;

  /** What it does, in order. */
  readonly then: readonly AutomationAction[];
};

/**
 * Collects every trigger leaf in a tree, left to right.
 *
 * @param tree - The trigger tree.
 * @returns The leaves in document order.
 */
export function flattenTriggers(tree: TriggerTree): AutomationTrigger[] {
  if (isTriggerTreeOp(tree)) {
    return tree.items.flatMap(flattenTriggers);
  }

  return [tree];
}

/**
 * Collects every condition leaf in a boolean tree, left to right.
 *
 * @param tree - The boolean tree.
 * @returns The leaves in document order.
 */
export function flattenConditionLeaves(tree: BooleanTree): ConditionLeaf[] {
  if (isBooleanTreeOp(tree)) {
    if (tree.op === 'not') {
      return flattenConditionLeaves(tree.item);
    }

    return tree.items.flatMap(flattenConditionLeaves);
  }

  return [tree];
}

/**
 * Builds a trigger tree from a flat list (OR), as the legacy list meant.
 *
 * @param triggers - Leaf triggers.
 * @returns A single leaf, or an OR node.
 */
export function triggerTreeFromList(triggers: readonly AutomationTrigger[]): TriggerTree {
  const [only] = triggers;

  if (triggers.length === 1 && only !== undefined) {
    return only;
  }

  return { op: 'or', items: [...triggers] };
}

/**
 * Builds an `if` tree from a flat list of draft conditions (AND), as the legacy list meant.
 *
 * @param conditions - Draft/editor conditions.
 * @returns A boolean tree, or `undefined` when the list is empty.
 */
export function ifTreeFromConditions(
  conditions: readonly AutomationCondition[],
): BooleanTree | undefined {
  const [only] = conditions;

  if (only === undefined) {
    return undefined;
  }

  if (conditions.length === 1) {
    return booleanTreeFromCondition(only);
  }

  return { op: 'and', items: conditions.map(booleanTreeFromCondition) };
}
