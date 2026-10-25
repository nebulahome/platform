/**
 * The automation being written, before it is a document.
 *
 * A form holds half-finished things: a trigger whose entity has not been chosen, a threshold
 * still being typed. The stored format holds none of those — it is validated, and a draft that
 * had to stay valid could not be edited at all. So the draft is the loose version, and turning
 * it into a document is a step that can fail and say why.
 *
 * The draft has the document's own shape - a list of triggers, a list of conditions (AND/OR
 * groups and NOT on any block), the actions with whatever they hold - so a block is the same
 * object in the editor and in the saved document, and a block dragged from one list to another
 * is moved rather than translated. A document of an older shape is read through the format's own
 * migration first.
 *
 * Here rather than in the component because it is the rules of the thing rather than the drawing
 * of it (RULES.md 15.1), and because a reducer is the part worth testing.
 */
import { type z } from 'zod';

import {
  automationDefinitionSchema,
  migrateDefinition,
  type AutomationAction,
  type AutomationCreate,
  type AutomationMode,
  type AutomationTrigger,
  type AutomationView,
  type ConditionNode,
  type EntityId,
} from '@nebulahome/contracts';

import { defineMessage, type Message, text, translate } from '@/i18n/messages';

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

  /** How long one run may take. */
  readonly maxRuntimeMs: number;

  /** Whether it is on. */
  readonly isEnabled: boolean;

  /** What wakes it: any one of these. */
  readonly triggers: readonly AutomationTrigger[];

  /** What has to hold first: all of these. */
  readonly if: readonly ConditionNode[];

  /** What it does, in order. */
  readonly then: readonly AutomationAction[];
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
    maxRuntimeMs: 300_000,
    isEnabled: true,
    triggers: [],
    if: [],
    then: [],
  };
}

/**
 * A list out of whatever a document held there.
 *
 * @param value - The document's value.
 * @returns The list, or an empty one when it is not one.
 */
function listOf<TItem>(value: unknown): TItem[] {
  return Array.isArray(value) ? (value as TItem[]) : [];
}

/**
 * Reads an automation back into a draft.
 *
 * The definition is whatever the column held, rewritten into the current shape by the format's
 * migration. Not parsed beyond that: a block this build no longer has - a check that was removed -
 * still opens as a card, which says so and is named by the save, rather than vanishing. An editor
 * that refuses to open is a worse answer than one that opens with what it could understand.
 *
 * The document is copied first, so every block is an object of its own: the editor tells blocks
 * apart by identity, and a document holding the same object twice would confuse it.
 *
 * @param automation - The stored automation, or one brought in from a file.
 * @returns The draft to edit.
 */
export function draftFrom(
  automation: Pick<
    AutomationView,
    'key' | 'name' | 'description' | 'mode' | 'maxRuntimeMs' | 'isEnabled' | 'definition'
  >,
): AutomationDraft {
  const migrated = migrateDefinition(structuredClone(automation.definition));
  const document = (migrated !== null && typeof migrated === 'object' ? migrated : {}) as Readonly<
    Record<string, unknown>
  >;

  return {
    key: automation.key,
    name: automation.name,
    description: automation.description,
    mode: automation.mode,
    maxRuntimeMs: automation.maxRuntimeMs,
    isEnabled: automation.isEnabled,
    triggers: listOf<AutomationTrigger>(document['triggers']),
    if: listOf<ConditionNode>(document['if']),
    then: listOf<AutomationAction>(document['then']),
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
    case 'entity': {
      return { type: 'entity', entityId: partialEntityId(''), change: { kind: 'state' } };
    }
    case 'entity_numeric': {
      return {
        type: 'entity',
        entityId: partialEntityId(''),
        change: { kind: 'numeric', operator: 'gt', value: 0 },
      };
    }
    case 'time': {
      return { type: 'time', at: { kind: 'clock', time: '08:00' } };
    }
    case 'sun': {
      return { type: 'sun', event: 'sunset' };
    }
    case 'quiet': {
      return { type: 'quiet' };
    }
    case 'event': {
      return { type: 'event', event: '' };
    }
    case 'webhook': {
      return { type: 'webhook', hookId: newHookId(), method: 'POST', reach: 'local' };
    }
    default: {
      return { type: 'manual' };
    }
  }
}

/**
 * A new webhook id: 128 random bits, which is what makes the address hard to guess.
 *
 * @returns 32 hexadecimal digits.
 */
export function newHookId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * A condition of the chosen kind, with nothing filled in. A group starts empty: the dashed Add
 * inside it is where its conditions come from.
 *
 * @param type - Which kind.
 * @returns The blank condition.
 */
export function blankCondition(type: string): ConditionNode {
  switch (type) {
    case 'and':
    case 'or': {
      return { type, conditions: [] };
    }
    case 'time': {
      return { type: 'time', from: '08:00', to: '20:00' };
    }
    case 'days': {
      return { type: 'time', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] };
    }
    case 'entity_numeric': {
      return {
        type: 'entity',
        entityId: partialEntityId(''),
        match: { kind: 'numeric', operator: 'gt', value: 0 },
      };
    }
    case 'sun': {
      return { type: 'sun', phase: 'night' };
    }
    case 'expression': {
      return { type: 'expression', expression: '' };
    }
    default: {
      return {
        type: 'entity',
        entityId: partialEntityId(''),
        match: { kind: 'state', states: [] },
      };
    }
  }
}

/**
 * An action of the chosen kind, with nothing filled in.
 *
 * Control blocks start with empty bodies and no conditions, so the dashed Add is the only thing
 * inside until somebody picks one - nothing is chosen for them. The schema refuses what may not
 * be empty on save, and says where.
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
      return { type: 'wait_for', conditions: [], timeoutMs: 60_000 };
    }
    case 'wait_for_trigger': {
      return { type: 'wait_for_trigger', trigger: blankTrigger('entity'), timeoutMs: 60_000 };
    }
    case 'notify': {
      return { type: 'notify', channel: 'push', message: '' };
    }
    case 'package_service': {
      return { type: 'package_service', packageId: '', service: '', params: {} };
    }
    case 'http_request': {
      return {
        type: 'http_request',
        method: 'POST',
        url: '',
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        body: { kind: 'json', text: '' },
        timeoutMs: 10_000,
      };
    }
    case 'parallel': {
      return { type: 'parallel', branches: [[], []] };
    }
    case 'sequence': {
      return { type: 'sequence', actions: [] };
    }
    case 'switch': {
      return {
        type: 'switch',
        entityId: partialEntityId(''),
        cases: [{ value: '', actions: [] }],
        default: [],
      };
    }
    case 'while': {
      return { type: 'while', conditions: [], actions: [] };
    }
    case 'do_while': {
      return { type: 'do_while', conditions: [], actions: [] };
    }
    case 'if': {
      return { type: 'if', conditions: [], then: [], else: [] };
    }
    case 'for': {
      return { type: 'for', over: { kind: 'count', count: 1 }, actions: [] };
    }
    case 'stop': {
      return { type: 'stop' };
    }
    default: {
      // A command the capability takes, so the block is one choice of entity away from valid.
      return {
        type: 'command',
        entityId: '',
        capability: 'on_off',
        params: { command: 'turn_on' },
      };
    }
  }
}

/** What a draft becomes, or why it cannot. */
export type DraftResult =
  | { readonly ok: true; readonly body: AutomationCreate }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The lists a path can name, in the words the editor uses. */
const LIST_WORDS: Readonly<Record<string, Message>> = {
  then: defineMessage('library.automationDraft.then', 'Then'),
  else: defineMessage('library.automationDraft.else', 'Else'),
  actions: defineMessage('library.automationDraft.inside', 'Inside'),
  default: defineMessage('library.automationDraft.otherwise', 'Otherwise'),
  conditions: defineMessage('library.automationDraft.conditions', 'Conditions'),
  branches: defineMessage('library.automationDraft.branch', 'Branch'),
  cases: defineMessage('library.automationDraft.case', 'Case'),
};

/**
 * Where a problem is, in the words the form uses: "Then › block 3 › Else › block 1 › entityId".
 *
 * @param path - The path the schema reported.
 * @returns Where to look.
 */
export function describePath(path: readonly PropertyKey[]): string {
  const parts = path.map(String);
  const [group, ...rest] = parts;
  const words: string[] = [
    group === 'triggers'
      ? translate('library.automationDraft.when', 'When')
      : group === 'if'
        ? translate('library.automationDraft.if', 'If')
        : group === 'then'
          ? translate('library.automationDraft.then', 'Then')
          : '',
  ];
  const noun = group === 'triggers' ? 'trigger' : group === 'if' ? 'condition' : 'block';
  let current = noun;

  for (const [at, part] of rest.entries()) {
    if (/^\d+$/u.test(part)) {
      const previous = rest[at - 1];

      words.push(
        previous === 'branches' || previous === 'cases'
          ? String(Number(part) + 1)
          : `${current} ${String(Number(part) + 1)}`,
      );
      continue;
    }

    const listWord = LIST_WORDS[part];
    const word = listWord === undefined ? undefined : text(listWord);

    if (word === undefined) {
      words.push(part);
      continue;
    }

    current =
      part === 'conditions'
        ? translate('library.automationDraft.condition', 'condition')
        : translate('library.automationDraft.block', 'block');
    words.push(word);
  }

  return (
    words.filter((word) => word !== '').join(' › ') ||
    translate('library.automationDraft.rule', 'The rule')
  );
}

/**
 * What is wrong with a field, said the way a person would say it.
 *
 * @param issue - What the schema found.
 * @returns The sentence to show.
 */
function describeIssue(issue: z.core.$ZodIssue): string {
  const last = issue.path.at(-1);

  if (issue.code === 'too_small' && issue.origin === 'array') {
    return last === 'conditions'
      ? translate('library.automationDraft.addACondition', 'add a condition')
      : last === 'states'
        ? translate('library.automationDraft.chooseAState', 'choose a state')
        : translate('library.automationDraft.addABlock', 'add a block');
  }

  if (issue.code === 'too_small' && issue.origin === 'string' && Number(issue.minimum) <= 1) {
    return translate('library.automationDraft.needsAValue', 'needs a value');
  }

  if (issue.code === 'invalid_type') {
    return translate('library.automationDraft.hasNotBeenFilled', 'has not been filled in');
  }

  if (issue.code === 'invalid_union' && last === 'type') {
    return 'is not available any more: remove it';
  }

  return issue.message;
}

/**
 * Turns a draft into something the API will take.
 *
 * @param draft - What the form holds.
 * @returns The request, or the problems that stop it being one.
 */
export function toCreate(draft: AutomationDraft): DraftResult {
  const problems: string[] = [];

  if (draft.name.trim() === '') {
    problems.push(translate('library.automationDraft.itNeedsAName', 'It needs a name.'));
  }

  if (!/^[a-z][a-z0-9_]{1,62}$/u.test(draft.key)) {
    problems.push(
      translate(
        'library.automationDraft.keyMustBeLower',
        'The key must be lower case letters, digits and underscores.',
      ),
    );
  }

  if (draft.triggers.length === 0) {
    problems.push(translate('library.automationDraft.whenAddATrigger', 'When: add a trigger'));
  }

  if (draft.then.length === 0) {
    problems.push(translate('library.automationDraft.thenAddABlock', 'Then: add a block'));
  }

  const definition = automationDefinitionSchema.safeParse({
    triggers: draft.triggers,
    ...(draft.if.length === 0 ? {} : { if: draft.if }),
    then: draft.then,
  });

  if (!definition.success) {
    for (const issue of definition.error.issues) {
      const where = describePath(issue.path);

      // A list already said to be empty above, said once.
      if (!(
        issue.path.length === 1 &&
        (issue.path[0] === 'triggers' || issue.path[0] === 'then')
      )) {
        problems.push(`${where}: ${describeIssue(issue)}`);
      }
    }
  }

  if (problems.length > 0 || !definition.success) {
    return { ok: false, problems: [...new Set(problems)] };
  }

  return {
    ok: true,
    body: {
      key: draft.key,
      name: draft.name.trim(),
      description: draft.description.trim(),
      definition: definition.data,
      mode: draft.mode,
      maxRuntimeMs: draft.maxRuntimeMs,
      isEnabled: draft.isEnabled,
    },
  };
}

/** What every block carries besides what it does: its name, its switch, its NOT. */
const META_KEYS = ['name', 'isEnabled', 'isNot'] as const;

/**
 * A block as its fields rewrote it, with the name, the switch and the NOT it had kept.
 *
 * A field that rebuilds its block - a time switched from Simple to Advanced - knows nothing of
 * those; this is the one place every field edit passes through that puts them back. A rename or a
 * Turn on that takes one away does not pass through here.
 *
 * @param previous - The block as it was.
 * @param next - The block as the field wrote it.
 * @returns The block, its meta kept.
 */
export function keepMeta<TBlock extends object>(previous: object, next: TBlock): TBlock {
  const old = previous as Readonly<Record<string, unknown>>;
  const kept = Object.fromEntries(
    META_KEYS.filter((key) => key in old && !(key in next)).map((key) => [key, old[key]]),
  );

  return Object.keys(kept).length === 0 ? next : { ...next, ...kept };
}

/**
 * A block without one of its fields: an optional field put back to its absence, rather than
 * written as undefined, so the draft says what the document will.
 *
 * @param value - The block.
 * @param key - The field to drop.
 * @returns A copy without it.
 */
export function withoutKey<TValue extends object, TKey extends keyof TValue>(
  value: TValue,
  key: TKey,
): Omit<TValue, TKey> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<
    TValue,
    TKey
  >;
}

/**
 * The same list without the entry at one position.
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

/**
 * Inserts an item at a position, shifting the rest right.
 *
 * @param items - The list.
 * @param index - Where the new item lands.
 * @param item - What to insert.
 * @returns A new list.
 */
export function insertAt<TItem>(
  items: readonly TItem[],
  index: number,
  item: TItem,
): readonly TItem[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}
