/**
 * The automation being written, before it is a document.
 *
 * A form holds half-finished things: a trigger whose entity has not been chosen, a threshold
 * still being typed. The stored format holds none of those — it is validated, and a draft that
 * had to stay valid could not be edited at all. So the draft is the loose version, and turning
 * it into a document is a step that can fail and say why.
 *
 * Here rather than in the component because it is the rules of the thing rather than the drawing
 * of it (RULES.md 15.1), and because a reducer is the part worth testing.
 *
 * **What this editor does not compose.** `and` / `or` / `not` conditions and `parallel` actions
 * nest, and an editor for nesting is a different piece of work — the mockup that designed this
 * screen left them out too. They are not dropped, though: an automation that already has them
 * keeps them, shown as a block this build will not take apart. Losing somebody's work because
 * the editor could not draw it would be the worst thing this file could do.
 */
import { type z } from 'zod';

import {
  ACTION_TYPES,
  automationDefinitionSchema,
  CONDITION_TYPES,
  TRIGGER_TYPES,
  type AutomationAction,
  type AutomationCondition,
  type AutomationCreate,
  type AutomationDefinition,
  type AutomationMode,
  type AutomationTrigger,
  type AutomationView,
  type EntityId,
} from '@nebula-home/contracts';

/**
 * A half-written entity address.
 *
 * `EntityId` is branded, and the brand is exactly the claim that a string has been checked. A
 * draft holds addresses that have not been: an empty field, three characters of one somebody is
 * still typing. This is the single place that says "not yet", and the schema restores the claim
 * on save - which is the only moment it can honestly be made.
 *
 * @param value - What has been typed so far.
 * @returns The same string, in the shape the format's types expect.
 */
export function partialEntityId(value: string): EntityId {
  return value as EntityId;
}

/** The kinds of trigger this editor can write. All of them. */
export const EDITABLE_TRIGGERS = TRIGGER_TYPES;

/** The kinds of condition this editor can write: the leaves, not the ones that compose. */
export const EDITABLE_CONDITIONS = CONDITION_TYPES.filter(
  (type) => type !== 'and' && type !== 'or' && type !== 'not',
);

/** The kinds of action this editor can write: the ones that do not hold other actions. */
export const EDITABLE_ACTIONS = ACTION_TYPES.filter((type) => type !== 'parallel');

/** An automation as a form holds it. */
export type AutomationDraft = {
  /** The identifier other things refer to. */
  readonly key: string;

  /** What it is called. */
  readonly name: string;

  /** What it is for. */
  readonly description: string;

  /** What happens when it is triggered while already running. */
  readonly mode: AutomationMode;

  /** How long one run may take, in seconds — which is how the field asks for it. */
  readonly maxRuntimeSeconds: number;

  /** Whether it is on. */
  readonly isEnabled: boolean;

  /** What wakes it. */
  readonly triggers: readonly AutomationTrigger[];

  /** What has to hold. */
  readonly conditions: readonly AutomationCondition[];

  /** What it does. */
  readonly actions: readonly AutomationAction[];
};

/**
 * Turns a name into the key it suggests.
 *
 * Suggested rather than imposed: the key is offered while the name is being typed and stops
 * following it the moment somebody edits the key themselves, because a key that keeps changing
 * under an author is worse than one they have to think about once.
 *
 * @param name - What it is called.
 * @returns A key, or an empty string when the name has nothing usable in it.
 */
export function toKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/gu, '')
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '')
    .slice(0, 63);
}

/**
 * A draft with nothing in it yet.
 *
 * @returns The empty draft.
 */
export function emptyDraft(): AutomationDraft {
  return {
    key: '',
    name: '',
    description: '',
    mode: 'single',
    maxRuntimeSeconds: 300,
    isEnabled: true,
    triggers: [],
    conditions: [],
    actions: [],
  };
}

/**
 * Reads an automation back into a draft.
 *
 * The definition is whatever the column held, which for a row written before the schema existed
 * can be anything. Anything unreadable becomes an empty list rather than an exception: an editor
 * that refuses to open is a worse answer than one that opens with what it could understand.
 *
 * @param automation - The stored automation.
 * @returns The draft to edit.
 */
export function draftFrom(automation: AutomationView): AutomationDraft {
  const definition = automation.definition as Partial<AutomationDefinition>;

  return {
    key: automation.key,
    name: automation.name,
    description: automation.description,
    mode: automation.mode,
    maxRuntimeSeconds: Math.round(automation.maxRuntimeMs / 1000),
    isEnabled: automation.isEnabled,
    triggers: Array.isArray(definition.triggers) ? definition.triggers : [],
    conditions: Array.isArray(definition.conditions) ? definition.conditions : [],
    actions: Array.isArray(definition.actions) ? definition.actions : [],
  };
}

/**
 * A trigger of the chosen kind, with nothing filled in.
 *
 * The empty values are deliberately the ones the schema will refuse — an empty entity address
 * is not an address — so that a block somebody added and did not finish is caught on save
 * rather than written as a rule that can never fire.
 *
 * @param type - Which kind.
 * @returns The blank trigger.
 */
export function blankTrigger(type: string): AutomationTrigger {
  switch (type) {
    case 'state': {
      return { type: 'state', entityId: partialEntityId(''), to: '' };
    }

    case 'numeric_state': {
      return { type: 'numeric_state', entityId: partialEntityId(''), operator: 'gt', value: 0 };
    }

    case 'time': {
      return { type: 'time', at: { kind: 'clock', time: '08:00' } };
    }

    case 'event': {
      return { type: 'event', event: '', match: {} };
    }

    default: {
      return { type: 'manual' };
    }
  }
}

/**
 * A condition of the chosen kind, with nothing filled in.
 *
 * @param type - Which kind.
 * @returns The blank condition.
 */
export function blankCondition(type: string): AutomationCondition {
  switch (type) {
    case 'numeric': {
      return { type: 'numeric', entityId: '', operator: 'gt', value: 0 };
    }

    case 'time_window': {
      return { type: 'time_window', from: '22:00', to: '06:00' };
    }

    case 'day_of_week': {
      return { type: 'day_of_week', days: ['monday'] };
    }

    case 'area_occupancy': {
      return { type: 'area_occupancy', areaKey: '', isOccupied: true };
    }

    case 'expression': {
      return { type: 'expression', expression: '' };
    }

    default: {
      return { type: 'state', entityId: '', state: '' };
    }
  }
}

/**
 * An action of the chosen kind, with nothing filled in.
 *
 * @param type - Which kind.
 * @returns The blank action.
 */
export function blankAction(type: string): AutomationAction {
  switch (type) {
    case 'scene': {
      return { type: 'scene', sceneKey: '' };
    }

    case 'automation': {
      return { type: 'automation', automationKey: '' };
    }

    case 'wait_duration': {
      return { type: 'wait_duration', durationMs: 5_000 };
    }

    case 'wait_for': {
      return {
        type: 'wait_for',
        condition: { type: 'state', entityId: partialEntityId(''), state: '' },
        timeoutMs: 60_000,
      };
    }

    case 'notify': {
      return { type: 'notify', channel: 'push', message: '' };
    }

    case 'package_service': {
      return { type: 'package_service', packageId: '', service: '', params: {} };
    }

    default: {
      return { type: 'command', entityId: '', capability: 'on_off', params: {} };
    }
  }
}

/**
 * Whether a condition is one this editor draws fields for.
 *
 * @param condition - The condition to look at.
 * @returns Whether its fields can be drawn.
 */
export function isEditableCondition(condition: AutomationCondition): boolean {
  return condition.type !== 'and' && condition.type !== 'or' && condition.type !== 'not';
}

/**
 * Whether an action is one this editor draws fields for.
 *
 * @param action - The action to look at.
 * @returns Whether its fields can be drawn.
 */
export function isEditableAction(action: AutomationAction): boolean {
  return action.type !== 'parallel';
}

/** What a draft becomes, or why it cannot. */
export type DraftResult =
  | { readonly ok: true; readonly body: AutomationCreate }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Where a problem is, in the words the form uses.
 *
 * `actions › 0 › sceneKey` becomes `Then › action 1 › scene`, because the person looking at the
 * message is looking at a screen that says Then, and counts its blocks from one.
 *
 * @param path - The path the schema reported.
 * @returns Where to look.
 */
function describePath(path: readonly PropertyKey[]): string {
  const GROUPS: Readonly<Record<string, string>> = {
    triggers: 'When › trigger',
    conditions: 'If › condition',
    actions: 'Then › action',
  };

  const [group, index, ...rest] = path;
  const heading = GROUPS[String(group)];

  if (heading === undefined || typeof index !== 'number') {
    return path.map(String).join(' › ') || 'The rule';
  }

  return [`${heading} ${String(index + 1)}`, ...rest.map(String)].join(' › ');
}

/**
 * What is wrong with a field, said the way a person would say it.
 *
 * Zod's own messages are written for whoever is holding the schema. "Too small: expected string
 * to have >=1 characters" is exactly right and is not a sentence to put in front of somebody who
 * has left a box empty.
 *
 * @param issue - What the schema found.
 * @returns The sentence to show.
 */
function describeIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === 'too_small' && issue.origin === 'string' && Number(issue.minimum) <= 1) {
    return 'needs a value';
  }

  if (issue.code === 'too_small' && issue.origin === 'array') {
    return 'needs at least one';
  }

  if (issue.code === 'invalid_type') {
    return 'has not been filled in';
  }

  return issue.message;
}

/**
 * Turns a draft into something the API will take.
 *
 * The definition goes through the same schema the server uses, so a form that would be refused
 * is refused here — while the person is still looking at it, with the path to the field that is
 * wrong rather than a sentence about the whole document.
 *
 * @param draft - What the form holds.
 * @returns The request, or the problems that stop it being one.
 */
export function toCreate(draft: AutomationDraft): DraftResult {
  const problems: string[] = [];

  if (draft.name.trim() === '') {
    problems.push('It needs a name.');
  }

  if (!/^[a-z][a-z0-9_]{1,62}$/u.test(draft.key)) {
    problems.push('The key must be lower case letters, digits and underscores.');
  }

  const definition = automationDefinitionSchema.safeParse({
    triggers: draft.triggers,
    conditions: draft.conditions,
    actions: draft.actions,
  });

  if (!definition.success) {
    for (const issue of definition.error.issues) {
      problems.push(`${describePath(issue.path)}: ${describeIssue(issue)}`);
    }
  }

  if (problems.length > 0 || !definition.success) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    body: {
      key: draft.key,
      name: draft.name.trim(),
      description: draft.description.trim(),
      definition: definition.data,
      mode: draft.mode,
      maxRuntimeMs: draft.maxRuntimeSeconds * 1000,
      isEnabled: draft.isEnabled,
    },
  };
}

/**
 * The same list without the entry at one position.
 *
 * Two slices rather than a filter, so there is no parameter for the item nobody looks at - and
 * so that removing the third of three identical blocks removes the third one rather than
 * whichever one an equality check found first.
 *
 * @param items - The list.
 * @param index - Which entry to drop.
 * @returns A new list.
 */
export function without<TItem>(items: readonly TItem[], index: number): readonly TItem[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

/**
 * The same list with one entry replaced.
 *
 * @param items - The list.
 * @param index - Which entry to replace.
 * @param item - What to put there.
 * @returns A new list.
 */
export function replaceAt<TItem>(
  items: readonly TItem[],
  index: number,
  item: TItem,
): readonly TItem[] {
  return [...items.slice(0, index), item, ...items.slice(index + 1)];
}
