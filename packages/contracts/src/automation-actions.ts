/**
 * What an automation does: a sequence of actions, some of which hold sequences of their own.
 *
 * Plain actions set an entity, apply a scene, start another automation, wait, call a package.
 * Control blocks hold others: an If with its conditions and two branches, a Switch on an entity's
 * state, loops, a Sequence, branches run in Parallel. Every one carries the {@link BlockMeta}
 * every block does, so any of them can be named or turned off - a control block turned off takes
 * what it holds with it.
 */
import { z } from 'zod';

import { conditionListSchema, type ConditionNode } from './automation-conditions.js';
import { blockMetaShape, durationMsSchema, type BlockMeta } from './automation-meta.js';
import { automationTriggerSchema, type AutomationTrigger } from './automation-triggers.js';
import { capabilityNameSchema, commandSchemaFor } from './capabilities.js';
import { entityIdSchema } from './entity-id.js';
import { jsonObjectSchema } from './json.js';
import { isPackageServiceAllowed, packageIdSchema } from './package-id.js';

/**
 * Action kinds the format holds but the engine cannot run yet: there is no notification service.
 * A run that reaches one records it as a failed step.
 */
export const UNAVAILABLE_ACTION_TYPES = ['notify'] as const;

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
 * Recursive: control blocks hold the same action type. Conditions inside `if`, `while`,
 * `do_while` and `wait_for` are lists of {@link ConditionNode}, all of which must hold.
 */
export type AutomationAction = BlockMeta &
  (
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
        readonly conditions: readonly ConditionNode[];
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
    | {
        readonly type: 'parallel';

        /** Each branch is a sequence of its own; the branches run at once. */
        readonly branches: readonly (readonly AutomationAction[])[];
      }
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
        readonly conditions: readonly ConditionNode[];
        readonly actions: readonly AutomationAction[];
      }
    | {
        readonly type: 'do_while';
        readonly conditions: readonly ConditionNode[];
        readonly actions: readonly AutomationAction[];
      }
    | {
        readonly type: 'if';

        /** All must hold for `then`; an empty list always does. */
        readonly conditions: readonly ConditionNode[];
        readonly then: readonly AutomationAction[];
        readonly else?: readonly AutomationAction[] | undefined;
      }
    | {
        readonly type: 'for';
        readonly over: ForRepeat;
        readonly actions: readonly AutomationAction[];
      }
    | { readonly type: 'stop' }
  );

/**
 * A list of nested actions.
 *
 * @returns The schema of a branch or a loop body.
 */
const nestedActionsSchema = (): z.ZodType<AutomationAction[]> =>
  z.array(automationActionSchema).max(50);

/**
 * A list of nested actions that must hold at least one.
 *
 * @returns The schema of a loop body or a sequence.
 */
const filledActionsSchema = (): z.ZodType<AutomationAction[]> =>
  z.array(automationActionSchema).min(1).max(50);

/**
 * Whether a command body sets a stored number helper: `{ command: 'set_value', value }`.
 *
 * @param params - The command body.
 * @returns True for that one shape.
 */
function isStoredNumberCommand(params: Readonly<Record<string, unknown>>): boolean {
  return params['command'] === 'set_value' && typeof params['value'] === 'number';
}

/** Something an automation does. */
export const automationActionSchema: z.ZodType<AutomationAction> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('command'),
        ...blockMetaShape,
        entityId: entityIdSchema,
        capability: capabilityNameSchema,

        /** The command body, `{ command: 'set_level', level: 60 }`, as the capability defines it. */
        params: jsonObjectSchema.default({}),
      })
      .superRefine((action, context) => {
        // Whether the entity has the capability is the world's business; whether the command is
        // one the capability can take at all is the document's, and saving one it cannot is a
        // run that fails every time it is reached.
        const schema = commandSchemaFor(action.capability);

        if (action.capability === 'sensor_numeric' && isStoredNumberCommand(action.params)) {
          // A stored number helper is set this way; a physical sensor refuses it when it runs.
          return;
        }

        if (schema === null) {
          context.addIssue({
            code: 'custom',
            path: ['capability'],
            message: 'This capability reports only and takes no commands',
          });

          return;
        }

        const parsed = schema.safeParse(action.params);

        if (!parsed.success) {
          context.addIssue({
            code: 'custom',
            path: ['params'],
            message: `Not a command ${action.capability} takes: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
          });
        }
      }),
    z.object({ type: z.literal('scene'), ...blockMetaShape, sceneKey: z.string().min(1) }),
    z.object({
      type: z.literal('automation'),
      ...blockMetaShape,
      automationKey: z.string().min(1),
    }),
    z.object({ type: z.literal('wait_duration'), ...blockMetaShape, durationMs: durationMsSchema }),
    z.object({
      type: z.literal('wait_for'),
      ...blockMetaShape,
      conditions: conditionListSchema(1),

      /** How long to wait before giving up. A wait with no end is a run that never finishes. */
      timeoutMs: durationMsSchema,
    }),
    z.object({
      type: z.literal('wait_for_trigger'),
      ...blockMetaShape,
      trigger: automationTriggerSchema,
      timeoutMs: durationMsSchema,
    }),
    z.object({
      type: z.literal('notify'),
      ...blockMetaShape,
      channel: z.string().min(1),
      message: z.string().min(1).max(2_000),
    }),
    z.object({
      type: z.literal('package_service'),
      ...blockMetaShape,

      /** A package, never a part of the platform: `svc.core.*` and its kin are not for calling. */
      packageId: packageIdSchema,
      service: z
        .string()
        .min(1)
        .max(64)
        .refine(isPackageServiceAllowed, { message: 'Is a name the platform keeps for itself' }),
      params: jsonObjectSchema.default({}),
    }),
    z.object({
      type: z.literal('parallel'),
      ...blockMetaShape,
      branches: z.array(filledActionsSchema()).min(1).max(10),
    }),
    z.object({ type: z.literal('sequence'), ...blockMetaShape, actions: filledActionsSchema() }),
    z.object({
      type: z.literal('switch'),
      ...blockMetaShape,
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
      ...blockMetaShape,
      conditions: conditionListSchema(1),
      actions: filledActionsSchema(),
    }),
    z.object({
      type: z.literal('do_while'),
      ...blockMetaShape,
      conditions: conditionListSchema(1),
      actions: filledActionsSchema(),
    }),
    z.object({
      type: z.literal('if'),
      ...blockMetaShape,
      conditions: conditionListSchema(0),
      then: nestedActionsSchema(),
      else: nestedActionsSchema().optional(),
    }),
    z.object({
      type: z.literal('for'),
      ...blockMetaShape,
      over: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('count'), count: z.int().min(1).max(10_000) }),
        z.object({ kind: z.literal('each'), items: z.string().min(1).max(2_000) }),
      ]),
      actions: filledActionsSchema(),
    }),
    z.object({ type: z.literal('stop'), ...blockMetaShape }),
  ]),
);
