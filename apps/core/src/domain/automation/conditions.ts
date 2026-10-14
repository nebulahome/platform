/**
 * Whether an automation's conditions hold right now: its `if`, and the conditions inside an If,
 * a loop or a wait.
 *
 * A list of conditions holds when every one in it does; an AND group the same, an OR group when
 * any does, and NOT turns any of them around. A condition turned off is left out, as if it were
 * not there - a list or a group with nothing left in it holds. Every condition is evaluated, not
 * only until the answer is known: the trace shows each card with what it saw, and "why did it not
 * run" is answered by the one that said false. Times and days are the house's ({@link zonedParts});
 * the sun is worked out from where the house stands; an expression runs in the alias evaluator's
 * sandbox, bounded in steps and time, over the readings of the entities it names.
 *
 * Pure: the state of the house, the clock and the house's position come in through the context.
 */
import {
  aliasScalarFromState,
  conditionLeavesOf,
  evaluateAliasExpression,
  isBlockEnabled,
  isConditionGroup,
  isSunPhase,
  numericReadingOf,
  stateTokenOf,
  sunState,
  type AliasScalar,
  type ConditionLeaf,
  type ConditionNode,
  type EntityState,
  type GeoPosition,
} from '@nebulahome/contracts';

import { isInTimeCondition, zonedParts } from './house-time.js';
import { compare } from './trigger-match.js';

/** What the checks can see of the house. */
export type ConditionContext = {
  readonly stateOf: (entityId: string) => EntityState | undefined;
  readonly now: Date;
  readonly timeZone: string;

  /** Where the house stands, for the sun; null when nobody has said. */
  readonly position: GeoPosition | null;
};

/** One check, as the trace records it. */
export type ConditionStep = {
  readonly path: string;
  readonly type: string;
  readonly result: 'true' | 'false' | 'failed' | 'skipped';
  readonly entityId?: string;
  readonly detail?: string;
  readonly error?: string;
};

/** What a list of checks said, and what each of them saw. */
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

/** Sun phases, for the trace. */
const PHASE_WORDS: Readonly<Record<string, string>> = {
  day: 'day',
  twilight: 'twilight',
  night: 'night',
  golden_hour: 'the golden hour',
  blue_hour: 'the blue hour',
  midnight_sun: 'the midnight sun',
  polar_night: 'the polar night',
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
 * @param value - What it said, before NOT.
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
 * Evaluates an entity leaf.
 *
 * @param path - Where it is.
 * @param leaf - The entity check.
 * @param context - The house.
 * @returns What it said, before NOT.
 */
function evaluateEntity(
  path: string,
  leaf: Extract<ConditionLeaf, { type: 'entity' }>,
  context: ConditionContext,
): ConditionStep {
  const state = context.stateOf(leaf.entityId);

  if (leaf.match.kind === 'state') {
    const token = state === undefined ? undefined : stateTokenOf(state.state, state.isAvailable);

    return step(
      path,
      leaf,
      token !== undefined && leaf.match.states.includes(token),
      `is ${token ?? 'unknown'}`,
    );
  }

  const reading = state?.isAvailable === true ? numericReadingOf(state.state) : undefined;

  if (reading === undefined) {
    return step(path, leaf, false, 'has no reading');
  }

  return step(
    path,
    leaf,
    compare(leaf.match.operator, reading, leaf.match.value),
    `reads ${String(reading)}`,
  );
}

/**
 * Evaluates a sun leaf.
 *
 * @param path - Where it is.
 * @param leaf - The sun check.
 * @param context - The house.
 * @returns What it said, before NOT.
 */
function evaluateSun(
  path: string,
  leaf: Extract<ConditionLeaf, { type: 'sun' }>,
  context: ConditionContext,
): ConditionStep {
  if (context.position === null) {
    return {
      path,
      type: leaf.type,
      result: 'failed',
      error: 'The house has no position, so the sun has no height here',
    };
  }

  const state = sunState(context.now, context.position);
  const phase = PHASE_WORDS[leaf.phase];
  const elevation = `the sun is at ${state.elevation.toFixed(1)}°`;

  return step(
    path,
    leaf,
    isSunPhase(leaf, state),
    phase === undefined ? elevation : `${elevation}, asked for ${phase}`,
  );
}

/**
 * Evaluates one leaf, NOT not applied.
 *
 * @param path - Where it is.
 * @param leaf - The leaf.
 * @param context - The house.
 * @returns What it said, and what it saw.
 */
function evaluateLeaf(path: string, leaf: ConditionLeaf, context: ConditionContext): ConditionStep {
  switch (leaf.type) {
    case 'entity': {
      return evaluateEntity(path, leaf, context);
    }
    case 'time': {
      const parts = zonedParts(context.now, context.timeZone);

      return step(
        path,
        leaf,
        isInTimeCondition(parts, leaf),
        `it is ${DAY_WORDS[parts.weekday] ?? parts.weekday} ${clockOf(parts.secondsOfDay)}`,
      );
    }
    case 'sun': {
      return evaluateSun(path, leaf, context);
    }
    case 'expression': {
      return evaluateExpression(path, leaf, context);
    }
  }
}

/**
 * Turns a step's result around for NOT. A failure stays one.
 *
 * @param leafStep - The step.
 * @returns The step, its result inverted.
 */
function negated(leafStep: ConditionStep): ConditionStep {
  if (leafStep.result === 'true') {
    return { ...leafStep, result: 'false' };
  }

  return leafStep.result === 'false' ? { ...leafStep, result: 'true' } : leafStep;
}

/**
 * Evaluates one condition: a leaf, or a group of more.
 *
 * @param node - The condition.
 * @param path - Where it is.
 * @param context - The house.
 * @returns Whether it holds, NOT applied, and the steps of everything in it.
 */
function evaluateNode(
  node: ConditionNode,
  path: string,
  context: ConditionContext,
): ConditionOutcome {
  if (isConditionGroup(node)) {
    const inner = evaluateList(node.conditions, `${path}.conditions`, context, node.type);
    const value = node.isNot === true ? !inner.value : inner.value;

    return {
      value,
      steps: [{ path, type: node.type, result: value ? 'true' : 'false' }, ...inner.steps],
    };
  }

  const evaluated = evaluateLeaf(path, node, context);
  const leafStep = node.isNot === true ? negated(evaluated) : evaluated;

  return { value: leafStep.result === 'true', steps: [leafStep] };
}

/**
 * Evaluates a list of conditions, all of which (AND) or any of which (OR) must hold.
 *
 * @param nodes - The conditions.
 * @param path - Where the list is.
 * @param context - The house.
 * @param join - How they combine.
 * @returns Whether the list holds, and every step.
 */
function evaluateList(
  nodes: readonly ConditionNode[],
  path: string,
  context: ConditionContext,
  join: 'and' | 'or',
): ConditionOutcome {
  const steps: ConditionStep[] = [];
  const values: boolean[] = [];

  for (const [index, node] of nodes.entries()) {
    const at = `${path}.${String(index)}`;

    if (!isBlockEnabled(node)) {
      steps.push({ path: at, type: node.type, result: 'skipped', detail: 'Turned off' });
      continue;
    }

    const outcome = evaluateNode(node, at, context);

    values.push(outcome.value);
    steps.push(...outcome.steps);
  }

  // Nothing left to check holds: a list emptied by turning its conditions off asks nothing.
  const value =
    values.length === 0 || (join === 'and' ? values.every(Boolean) : values.some(Boolean));

  return { value, steps };
}

/**
 * Evaluates a list of conditions, all of which must hold.
 *
 * A check that fails to evaluate - an expression that does not parse, the sun in a house with no
 * position - counts as false.
 *
 * @param nodes - The conditions.
 * @param path - Where the list is: `if`, `then.2.conditions`.
 * @param context - The house and the clock.
 * @returns Whether they hold, and every check's step.
 */
export function evaluateConditions(
  nodes: readonly ConditionNode[],
  path: string,
  context: ConditionContext,
): ConditionOutcome {
  return evaluateList(nodes, path, context, 'and');
}

/**
 * The entities a list of conditions reads, so a wait can listen for them.
 *
 * @param nodes - The conditions.
 * @returns Each entity once.
 */
export function entitiesOfConditions(nodes: readonly ConditionNode[]): string[] {
  const found = new Set<string>();

  for (const leaf of conditionLeavesOf(nodes)) {
    if (leaf.type === 'entity') {
      found.add(leaf.entityId);
    } else if (leaf.type === 'expression') {
      for (const entityId of Object.values(leaf.variables ?? {})) {
        found.add(entityId);
      }
    }
  }

  return [...found];
}

/**
 * Whether a list of conditions depends on the clock, so a wait must look again as time passes.
 *
 * @param nodes - The conditions.
 * @returns True when one of them is a time or a phase of the sun.
 */
export function dependsOnClock(nodes: readonly ConditionNode[]): boolean {
  return conditionLeavesOf(nodes).some((leaf) => leaf.type === 'time' || leaf.type === 'sun');
}
