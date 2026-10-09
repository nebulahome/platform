/**
 * Saying what an automation does, in words.
 *
 * A definition is a document, and a list of documents is not a list anybody can read. What a
 * person scanning the page wants is the shape of the rule - what wakes it, what it checks, what
 * it then does - which is three short phrases rather than a JSON tree.
 *
 * Here rather than in the component because it is a translation from the domain into English,
 * and RULES.md 15.1 keeps that out of a component: a component decides what to render, not what
 * things mean. It is also the part worth testing, and a pure function is the only version of it
 * a test can reach.
 *
 * **Deliberately lossy.** A nested `and` of four conditions reads as "4 conditions", because a
 * summary that tries to be complete stops being a summary. The editor is where the whole
 * document is shown.
 */
import type {
  AutomationAction,
  AutomationCondition,
  AutomationDefinition,
  AutomationTrigger,
  BooleanTree,
  TriggerTree,
} from '@nebulahome/contracts';
import { flattenTriggers, isTriggerTreeOp, migrateDefinition } from '@nebulahome/contracts';

import { actionSummary, NO_NAMES, triggerSummary, type BlockNames } from '@/lib/block-summary';

/** How one part of the chain reads. */
export type AutomationSummary = {
  /** What wakes it. */
  readonly trigger: string;

  /** What it checks first, or null when it checks nothing. */
  readonly conditions: string | null;

  /** What it does. */
  readonly actions: string;
};

/**
 * Says what one trigger waits for, as its closed block does.
 *
 * @param trigger - The trigger.
 * @param names - Where names come from; the addresses spelled out without.
 * @returns One phrase.
 */
export function describeTrigger(trigger: AutomationTrigger, names: BlockNames = NO_NAMES): string {
  return triggerSummary(trigger, names);
}

/**
 * Says what one action does, as its closed block does.
 *
 * @param action - The action.
 * @param names - Where names come from; the addresses spelled out without.
 * @returns One phrase.
 */
export function describeAction(action: AutomationAction, names: BlockNames = NO_NAMES): string {
  return actionSummary(action, names);
}

/**
 * Counts a condition, including the ones inside it.
 *
 * A composed condition is one node and several checks, and "1 condition" for a three-way `and`
 * understates what somebody is about to open.
 *
 * Accepts both the document's {@link BooleanTree} (`op`) and the draft's
 * {@link AutomationCondition} (`type: 'and' | 'or' | 'not'`).
 *
 * @param condition - The condition.
 * @returns How many leaf checks it makes.
 */
export function countChecks(condition: BooleanTree | AutomationCondition): number {
  if ('op' in condition) {
    if (condition.op === 'not') {
      return countChecks(condition.item);
    }

    return condition.items.reduce((total, inner) => total + countChecks(inner), 0);
  }

  if (condition.type === 'and' || condition.type === 'or') {
    return condition.conditions.reduce((total, inner) => total + countChecks(inner), 0);
  }

  if (condition.type === 'not') {
    return countChecks(condition.condition);
  }

  return 1;
}

/**
 * Counts leaf checks in a stored `if` tree.
 *
 * @param tree - The `if` tree, or undefined when there is none.
 * @returns How many leaf checks it makes.
 */
function countIfChecks(tree: BooleanTree | undefined): number {
  return tree === undefined ? 0 : countChecks(tree);
}

/**
 * Describes the trigger side of a tree.
 *
 * @param tree - The trigger tree.
 * @param names - Where names come from.
 * @returns One phrase, with a "+N" when there are more leaves.
 */
function describeTriggerTree(tree: TriggerTree, names: BlockNames): string {
  const leaves = isTriggerTreeOp(tree) ? flattenTriggers(tree) : [tree];
  const [first] = leaves;

  if (first === undefined) {
    return 'no trigger';
  }

  const extra = leaves.length - 1;

  return extra > 0
    ? `${describeTrigger(first, names)} +${String(extra)}`
    : describeTrigger(first, names);
}

/**
 * Says what the whole rule does.
 *
 * @param definition - The stored document (`{ triggers, if, then }`, or a legacy shape already
 *   normalised by the caller).
 * @param names - Where names come from.
 * @returns The three phrases the list shows.
 */
export function describeAutomation(
  definition: AutomationDefinition,
  names: BlockNames = NO_NAMES,
): AutomationSummary {
  const trigger = describeTriggerTree(definition.triggers, names);

  const checks = countIfChecks(definition.if);

  const actionsList = definition.then;
  const [firstAction] = actionsList;
  const extraActions = actionsList.length - 1;

  const actions =
    firstAction === undefined
      ? 'no actions'
      : extraActions > 0
        ? `${describeAction(firstAction, names)} +${String(extraActions)}`
        : describeAction(firstAction, names);

  return {
    trigger,
    conditions: checks === 0 ? null : `${String(checks)} condition${checks === 1 ? '' : 's'}`,
    actions,
  };
}

/**
 * Reads the stored document, or gives up on it.
 *
 * @param definition - Whatever the column held.
 * @param names - Where names come from.
 * @returns The summary, or null when the document is not one this build can read.
 */
export function summaryOf(
  definition: unknown,
  names: BlockNames = NO_NAMES,
): AutomationSummary | null {
  // Legacy rows may still hold `{ triggers: [...], conditions, actions }`; the schema's own
  // migration lifts them, so the list reads them exactly as a save would.
  const document: unknown = migrateDefinition(definition);

  if (document === null || typeof document !== 'object') {
    return null;
  }

  const {
    triggers,
    if: ifTree,
    then,
  } = document as { readonly triggers?: unknown; readonly if?: unknown; readonly then?: unknown };

  if (triggers === undefined || triggers === null || !Array.isArray(then)) {
    return null;
  }

  // Not parsed: a leaf this build does not know still reads as its kind, rather than the whole
  // row reading as nothing.
  return describeAutomation(
    {
      triggers: triggers as AutomationDefinition['triggers'],
      if: ifTree as AutomationDefinition['if'],
      then: then as AutomationDefinition['then'],
    },
    names,
  );
}

/**
 * The chain a row shows, as one line of words, for the search.
 *
 * @param definition - Whatever the column held.
 * @returns "When the door opens → 2 conditions → Turn on the porch light", or empty.
 */
export function chainText(definition: unknown): string {
  const summary = summaryOf(definition);

  return summary === null
    ? ''
    : [summary.trigger, summary.conditions, summary.actions].filter(Boolean).join(' ');
}
