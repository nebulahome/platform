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
} from '@nebula-home/contracts';

/** How one part of the chain reads. */
export type AutomationSummary = {
  /** What wakes it. */
  readonly trigger: string;

  /** What it checks first, or null when it checks nothing. */
  readonly conditions: string | null;

  /** What it does. */
  readonly actions: string;
};

/** How the six comparisons read in a sentence. */
const COMPARISONS: Readonly<Record<string, string>> = {
  lt: 'below',
  lte: 'at most',
  gt: 'above',
  gte: 'at least',
  eq: 'exactly',
  neq: 'not',
};

/**
 * The last segment of an entity address.
 *
 * `light.hallway_ceiling` is what an automation refers to and `hallway ceiling` is what a person
 * calls it. The registry holds the name somebody actually gave it; this is the fallback for a
 * summary that has the address and nothing else.
 *
 * @param entityId - The address.
 * @returns Something readable.
 */
function readable(entityId: string): string {
  const [, object] = entityId.split('.');

  return (object ?? entityId).replaceAll('_', ' ');
}

/**
 * Says what one trigger waits for.
 *
 * @param trigger - The trigger.
 * @returns One phrase.
 */
export function describeTrigger(trigger: AutomationTrigger): string {
  switch (trigger.type) {
    case 'state': {
      const target = readable(trigger.entityId);

      if (typeof trigger.to === 'string') {
        return `${target} becomes ${trigger.to}`;
      }

      return `${target} changes`;
    }

    case 'numeric_state': {
      return `${readable(trigger.entityId)} goes ${COMPARISONS[trigger.operator] ?? trigger.operator} ${String(trigger.value)}`;
    }

    case 'time': {
      if (trigger.at.kind === 'clock') {
        return `at ${trigger.at.time}`;
      }

      if (trigger.at.kind === 'cron') {
        return `on a schedule`;
      }

      const { event, offsetMinutes } = trigger.at;

      if (offsetMinutes === 0) {
        return `at ${event}`;
      }

      const minutes = Math.abs(offsetMinutes);

      return `${String(minutes)} min ${offsetMinutes < 0 ? 'before' : 'after'} ${event}`;
    }

    case 'event': {
      return trigger.entityId === null || trigger.entityId === undefined
        ? trigger.event
        : `${trigger.event} from ${readable(trigger.entityId)}`;
    }

    default: {
      return 'run by hand';
    }
  }
}

/**
 * Says what one action does.
 *
 * @param action - The action.
 * @returns One phrase.
 */
export function describeAction(action: AutomationAction): string {
  switch (action.type) {
    case 'command': {
      return `${action.capability} ${readable(action.entityId)}`;
    }

    case 'scene': {
      return `apply ${action.sceneKey.replaceAll('_', ' ')}`;
    }

    case 'automation': {
      return `run ${action.automationKey.replaceAll('_', ' ')}`;
    }

    case 'wait_duration': {
      return `wait ${String(Math.round(action.durationMs / 1000))}s`;
    }

    case 'wait_for': {
      return 'wait for a condition';
    }

    case 'notify': {
      return `notify ${action.channel}`;
    }

    case 'package_service': {
      return `${action.packageId} · ${action.service}`;
    }

    default: {
      return `${String(action.actions.length)} in parallel`;
    }
  }
}

/**
 * Counts a condition, including the ones inside it.
 *
 * A composed condition is one node and several checks, and "1 condition" for a three-way `and`
 * understates what somebody is about to open.
 *
 * @param condition - The condition.
 * @returns How many leaf checks it makes.
 */
export function countChecks(condition: AutomationCondition): number {
  if (condition.type === 'and' || condition.type === 'or') {
    return condition.conditions.reduce((total, inner) => total + countChecks(inner), 0);
  }

  if (condition.type === 'not') {
    return countChecks(condition.condition);
  }

  return 1;
}

/**
 * Says what the whole rule does.
 *
 * @param definition - The stored document.
 * @returns The three phrases the list shows.
 */
export function describeAutomation(definition: AutomationDefinition): AutomationSummary {
  const [firstTrigger] = definition.triggers;
  const extraTriggers = definition.triggers.length - 1;

  const trigger =
    firstTrigger === undefined
      ? 'no trigger'
      : extraTriggers > 0
        ? `${describeTrigger(firstTrigger)} +${String(extraTriggers)}`
        : describeTrigger(firstTrigger);

  const checks = definition.conditions.reduce((total, one) => total + countChecks(one), 0);

  const [firstAction] = definition.actions;
  const extraActions = definition.actions.length - 1;

  const actions =
    firstAction === undefined
      ? 'no actions'
      : extraActions > 0
        ? `${describeAction(firstAction)} +${String(extraActions)}`
        : describeAction(firstAction);

  return {
    trigger,
    conditions: checks === 0 ? null : `${String(checks)} condition${checks === 1 ? '' : 's'}`,
    actions,
  };
}
