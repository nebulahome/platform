/**
 * Whether an automation's checks hold right now: the `if` tree, and the conditions inside an
 * if/else, a loop or a wait.
 *
 * Every leaf is evaluated, not only until the answer is known: the trace shows each card with
 * what it saw, and "why did it not run" is answered by the one that said false. Times and days
 * are the house's ({@link zonedParts}); an expression runs in the alias evaluator's sandbox,
 * bounded in steps and time, over the readings of the entities it names.
 *
 * Pure: the state of the house, the clock and the occupancy of the areas come in through the
 * context.
 */
import {
  aliasScalarFromState,
  evaluateAliasExpression,
  isBooleanTreeOp,
  numericReadingOf,
  stateTokenOf,
  type AliasScalar,
  type BooleanTree,
  type ConditionLeaf,
  type EntityState,
} from '@nebulahome/contracts';

import { isInWindow, zonedParts } from './house-time.js';
import { compare } from './trigger-match.js';

/** What the checks can see of the house. */
export type ConditionContext = {
  readonly stateOf: (entityId: string) => EntityState | undefined;
  readonly now: Date;
  readonly timeZone: string;

  /**
   * Whether somebody is in an area, by its key: true or false from its sensors, null when it
   * has none to say.
   */
  readonly occupancy: (areaKey: string) => boolean | null;
};

/** One check, as the trace records it. */
export type ConditionStep = {
  readonly path: string;
  readonly type: string;
  readonly result: 'true' | 'false' | 'failed';
  readonly entityId?: string;
  readonly detail?: string;
  readonly error?: string;
};

/** What a tree said, and what each of its checks saw. */
export type ConditionOutcome = {
  readonly value: boolean;
  readonly steps: readonly ConditionStep[];
};

/** Day names, for the trace. */
const DAY_WORDS: Readonly<Record<string, string>> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/**
 * Formats seconds since midnight as a time of day.
 *
 * @param seconds - The seconds.
 * @returns `HH:MM`.
 */
function clockOf(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * A step for a leaf.
 *
 * @param path - Where the leaf is.
 * @param leaf - The leaf.
 * @param value - What it said.
 * @param detail - What it saw.
 * @returns The step.
 */
function step(path: string, leaf: ConditionLeaf, value: boolean, detail: string): ConditionStep {
  return {
    path,
    type: leaf.type,
    result: value ? 'true' : 'false',
    ...('entityId' in leaf ? { entityId: leaf.entityId } : {}),
    detail,
  };
}

/**
 * Turns an expression's result into a yes or no.
 *
 * @param value - What it produced.
 * @returns True for true, a non-zero number or non-empty text.
 */
function truthy(value: AliasScalar): boolean {
  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return value.length > 0;
  }

  return value;
}

/**
 * Evaluates an expression leaf.
 *
 * @param path - Where it is.
 * @param leaf - The expression.
 * @param context - The house.
 * @returns What it said.
 */
function evaluateExpression(
  path: string,
  leaf: Extract<ConditionLeaf, { type: 'expression' }>,
  context: ConditionContext,
): ConditionStep {
  const bindings = new Map<string, AliasScalar>();
  const read: string[] = [];

  for (const [name, entityId] of Object.entries(leaf.variables ?? {})) {
    const state = context.stateOf(entityId);
    const scalar = state?.isAvailable === true ? aliasScalarFromState(state.state) : undefined;

    if (scalar === undefined) {
      return {
        path,
        type: leaf.type,
        result: 'false',
        detail: `${name} (${entityId}) has no reading`,
      };
    }

    bindings.set(name, scalar);
    read.push(`${name} ${String(scalar)}`);
  }

  const result = evaluateAliasExpression(leaf.expression, bindings);

  if (!result.ok) {
    return { path, type: leaf.type, result: 'failed', error: result.error.slice(0, 500) };
  }

  const value = truthy(result.value);

  return {
    path,
    type: leaf.type,
    result: value ? 'true' : 'false',
    detail: (read.length === 0 ? `reads ${String(result.value)}` : read.join(', ')).slice(0, 500),
  };
}

/**
 * Evaluates one leaf.
 *
 * @param path - Where it is.
 * @param leaf - The leaf.
 * @param context - The house.
 * @returns What it said, and what it saw.
 */
function evaluateLeaf(path: string, leaf: ConditionLeaf, context: ConditionContext): ConditionStep {
  switch (leaf.type) {
    case 'state': {
      const state = context.stateOf(leaf.entityId);
      const token = state === undefined ? undefined : stateTokenOf(state.state, state.isAvailable);

      return step(path, leaf, token === leaf.state, `is ${token ?? 'unknown'}`);
    }
    case 'numeric': {
      const state = context.stateOf(leaf.entityId);
      const reading = state?.isAvailable === true ? numericReadingOf(state.state) : undefined;

      if (reading === undefined) {
        return step(path, leaf, false, 'has no reading');
      }

      return step(
        path,
        leaf,
        compare(leaf.operator, reading, leaf.value),
        `reads ${String(reading)}`,
      );
    }
    case 'time_window': {
      const { secondsOfDay } = zonedParts(context.now, context.timeZone);

      return step(
        path,
        leaf,
        isInWindow(secondsOfDay, leaf.from, leaf.to),
        `it is ${clockOf(secondsOfDay)}`,
      );
    }
    case 'day_of_week': {
      const { weekday } = zonedParts(context.now, context.timeZone);

      return step(
        path,
        leaf,
        leaf.days.includes(weekday),
        `it is ${DAY_WORDS[weekday] ?? weekday}`,
      );
    }
    case 'area_occupancy': {
      const occupied = context.occupancy(leaf.areaKey);

      if (occupied === null) {
        return step(
          path,
          leaf,
          false,
          `No motion, occupancy or presence sensor in ${leaf.areaKey}`,
        );
      }

      return step(
        path,
        leaf,
        occupied === leaf.isOccupied,
        occupied ? 'somebody is there' : 'nobody is there',
      );
    }
    case 'expression': {
      return evaluateExpression(path, leaf, context);
    }
  }
}

/**
 * Evaluates a tree of checks.
 *
 * A check that fails to evaluate - an expression that does not parse - counts as false.
 *
 * @param tree - The tree.
 * @param path - Its path: `if`, `then.2.condition`.
 * @param context - The house, the clock and the areas.
 * @returns Whether it holds, and every check's step.
 */
export function evaluateConditions(
  tree: BooleanTree,
  path: string,
  context: ConditionContext,
): ConditionOutcome {
  if (!isBooleanTreeOp(tree)) {
    const leafStep = evaluateLeaf(path, tree, context);

    return { value: leafStep.result === 'true', steps: [leafStep] };
  }

  if (tree.op === 'not') {
    const inner = evaluateConditions(tree.item, `${path}.not`, context);

    return { value: !inner.value, steps: inner.steps };
  }

  const outcomes = tree.items.map((item, index) =>
    evaluateConditions(item, `${path}.${String(index)}`, context),
  );
  const value =
    tree.op === 'and'
      ? outcomes.every((outcome) => outcome.value)
      : outcomes.some((outcome) => outcome.value);

  return { value, steps: outcomes.flatMap((outcome) => outcome.steps) };
}

/**
 * The areas a tree asks about, so their occupancy can be read before it is evaluated.
 *
 * @param tree - The tree.
 * @returns Each area key once.
 */
export function areasOfConditions(tree: BooleanTree): string[] {
  if (!isBooleanTreeOp(tree)) {
    return tree.type === 'area_occupancy' ? [tree.areaKey] : [];
  }

  const items = tree.op === 'not' ? [tree.item] : tree.items;

  return [...new Set(items.flatMap(areasOfConditions))];
}

/**
 * The entities a tree reads, so a wait can listen for them.
 *
 * @param tree - The tree.
 * @returns Each entity once.
 */
export function entitiesOfConditions(tree: BooleanTree): string[] {
  if (!isBooleanTreeOp(tree)) {
    if (tree.type === 'state' || tree.type === 'numeric') {
      return [tree.entityId];
    }

    return tree.type === 'expression' ? Object.values(tree.variables ?? {}) : [];
  }

  const items = tree.op === 'not' ? [tree.item] : tree.items;

  return [...new Set(items.flatMap(entitiesOfConditions))];
}

/**
 * Whether a tree depends on the clock, so a wait must look again as time passes.
 *
 * @param tree - The tree.
 * @returns True when it has a time window, a day, or an area (whose sensors are read fresh).
 */
export function dependsOnClock(tree: BooleanTree): boolean {
  if (!isBooleanTreeOp(tree)) {
    return (
      tree.type === 'time_window' || tree.type === 'day_of_week' || tree.type === 'area_occupancy'
    );
  }

  const items = tree.op === 'not' ? [tree.item] : tree.items;

  return items.some(dependsOnClock);
}

/**
 * Whether somebody is in an area, by its sensors.
 *
 * @param sensorIds - The motion, occupancy and presence sensors in the area and below it.
 * @param stateOf - The live state of an entity.
 * @returns True when any reachable one is on, false when none is, null when there are none.
 */
export function isOccupied(
  sensorIds: readonly string[],
  stateOf: (entityId: string) => EntityState | undefined,
): boolean | null {
  if (sensorIds.length === 0) {
    return null;
  }

  return sensorIds.some((entityId) => {
    const state = stateOf(entityId);

    return state !== undefined && stateTokenOf(state.state, state.isAvailable) === 'on';
  });
}
