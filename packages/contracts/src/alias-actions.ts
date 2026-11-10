/**
 * What a part of an alias does when it is told something, or when its value changes.
 *
 * Each part may hold actions: a When (a command the part takes, or a change of its value) and the
 * actions an automation runs, the same blocks. When a command reaches a part with an action for
 * it, only that action runs: a Stored part still keeps the value, but nothing is forwarded and a
 * Formula or Code part no longer refuses it. A command with no action does what it always did.
 *
 * A command param inside them may be a formula (`{ formula: 'command.level * 0.6' }`): `command.*`
 * names the command's own values, any other name an entity's reading.
 */
import { z } from 'zod';

import { aliasExpressionNames } from './alias-expression.js';
import { aliasStepSchema, isParamFormula, type AutomationAction } from './automation-actions.js';
import { blockMetaShape, COMPARISON_OPERATORS, durationMsSchema } from './automation-meta.js';
import { entityChangeSchema } from './automation-triggers.js';
import { walkActions } from './automation-walk.js';

/** The prefix of a command's own values in a formula: `command.level`. */
export const COMMAND_VALUE_PREFIX = 'command.';

/** What starts an action: a command the part takes, or its value changing. */
export const aliasActionWhenSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('command'),
    command: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u, 'Must be a command name'),

    /** Only when a number the command carries compares so: `level` above 60. */
    match: z
      .object({
        field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/u, 'Must be a command field'),
        operator: z.enum(COMPARISON_OPERATORS),
        value: z.number(),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('change'),
    change: entityChangeSchema,

    /** How long the part must hold the new value, or stay past the number, to count. */
    forMs: durationMsSchema.nullish(),
  }),
]);

/** What starts an action. */
export type AliasActionWhen = z.output<typeof aliasActionWhenSchema>;

/** One action of a part. */
export const aliasActionSchema = z.object({
  /** Its id within the part: what its runs are recorded by. */
  id: z.string().regex(/^[\w-]{1,40}$/u, 'Must be an action id'),
  ...blockMetaShape,
  when: aliasActionWhenSchema,

  /** What it does, in order. Empty while it is being written; saving one is refused. */
  then: z.array(aliasStepSchema).max(50),
});

/** One action of a part. */
export type AliasAction = z.output<typeof aliasActionSchema>;

/** The most actions a part holds. */
export const MAX_ALIAS_ACTIONS = 16;

/** What the actions of an alias act on, each list without repeats. */
export type AliasActionTargets = {
  readonly entities: string[];
  readonly scenes: string[];
  readonly automations: string[];
};

/**
 * What a list of action steps acts on: the entities it commands, the scenes it applies, the
 * automations it starts.
 *
 * @param steps - The steps, nested blocks included.
 * @returns The targets.
 */
export function aliasStepTargets(steps: readonly AutomationAction[]): AliasActionTargets {
  const entities = new Set<string>();
  const scenes = new Set<string>();
  const automations = new Set<string>();

  walkActions(steps, 'then', (visited) => {
    if (visited.family !== 'action') {
      return;
    }

    const block = visited.block;

    if (block.type === 'command' || block.type === 'switch') {
      entities.add(block.entityId);
    } else if (block.type === 'scene') {
      scenes.add(block.sceneKey);
    } else if (block.type === 'automation') {
      automations.add(block.automationKey);
    }
  });

  return { entities: [...entities], scenes: [...scenes], automations: [...automations] };
}

/**
 * Every formula in a list of steps, nested blocks included.
 *
 * @param steps - The steps.
 * @returns The formula texts, in document order.
 */
export function aliasStepFormulas(steps: readonly AutomationAction[]): string[] {
  const formulas: string[] = [];

  walkActions(steps, 'then', (visited) => {
    if (visited.family === 'action' && visited.block.type === 'command') {
      for (const value of Object.values(visited.block.params)) {
        if (isParamFormula(value)) {
          formulas.push(value.formula);
        }
      }
    }
  });

  return formulas;
}

/**
 * The entities the formulas of some steps read: every name that is not one of the command's own.
 *
 * @param steps - The steps.
 * @returns The entity ids (or `entity.field` names), each once.
 */
export function aliasStepReads(steps: readonly AutomationAction[]): string[] {
  const names = new Set<string>();

  for (const formula of aliasStepFormulas(steps)) {
    for (const name of aliasExpressionNames(formula)) {
      if (!name.startsWith(COMMAND_VALUE_PREFIX)) {
        names.add(name);
      }
    }
  }

  return [...names];
}

/**
 * Whether a command starts an action: same name, and its match, when it has one, holds.
 *
 * @param when - The action's When.
 * @param command - The command, `{ command: 'set_level', level: 72 }`.
 * @returns True when it does.
 */
export function aliasCommandMatches(
  when: AliasActionWhen,
  command: Readonly<Record<string, unknown>>,
): boolean {
  if (when.kind !== 'command' || when.command !== command['command']) {
    return false;
  }

  if (when.match === undefined) {
    return true;
  }

  const value = command[when.match.field];

  return typeof value === 'number' && compareNumbers(when.match.operator, value, when.match.value);
}

/**
 * Compares two numbers the way a threshold does.
 *
 * @param operator - How.
 * @param left - The value.
 * @param right - The threshold.
 * @returns Whether it holds.
 */
export function compareNumbers(
  operator: (typeof COMPARISON_OPERATORS)[number],
  left: number,
  right: number,
): boolean {
  switch (operator) {
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
  }
}
