/**
 * The automation being written, before it is a document.
 *
 * A form holds half-finished things: a trigger whose entity has not been chosen, a threshold
 * still being typed. The stored format holds none of those — it is validated, and a draft that
 * had to stay valid could not be edited at all. So the draft is the loose version, and turning
 * it into a document is a step that can fail and say why.
 *
 * The saved document is `{ triggers, if, then }` with AND/OR trees. The editor holds flat lists
 * of cards with a join (AND or OR) between each pair; those flatten into the document with AND
 * binding tighter than OR. Nested action templates live inside `actions` as the format defines
 * them, so a parallel or an if/else round-trips without an opaque wrapper.
 *
 * Here rather than in the component because it is the rules of the thing rather than the drawing
 * of it (RULES.md 15.1), and because a reducer is the part worth testing.
 */
import { type z } from 'zod';

import {
  ACTION_TYPES,
  automationDefinitionSchema,
  booleanTreeFromCondition,
  conditionFromBooleanTree,
  CONDITION_TYPES,
  flattenTriggers,
  isBooleanTreeOp,
  isTriggerTreeOp,
  NESTED_ACTION_TYPES,
  TRIGGER_TYPES,
  triggerTreeSchema,
  type AutomationAction,
  type AutomationCondition,
  type AutomationCreate,
  type AutomationDefinition,
  type AutomationMode,
  type AutomationTrigger,
  type AutomationView,
  type BooleanTree,
  type ConditionLeaf,
  type EntityId,
  type TriggerTree,
} from '@nebulahome/contracts';

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

/** How two neighbouring cards combine when the flat list becomes a tree. */
export type BooleanJoin = 'and' | 'or';

/** The kinds of trigger this editor can write. All of them. */
export const EDITABLE_TRIGGERS = TRIGGER_TYPES;

/**
 * The kinds of condition the If picker offers: every check, and the two groups - ALL OF and ANY
 * OF - that hold others. NONE OF is ANY OF with NOT on.
 */
export const IF_ADDABLE_CONDITIONS = [
  'state',
  'numeric',
  'time_window',
  'day_of_week',
  'area_occupancy',
  'expression',
  'group_and',
  'group_or',
] as const;

/** The kinds of condition this editor can draw fields for: the leaves, not the ones that compose. */
export const EDITABLE_CONDITIONS = CONDITION_TYPES.filter(
  (type) => type !== 'and' && type !== 'or' && type !== 'not',
);

/** The kinds of action this editor can write, including nested templates and stop. */
export const EDITABLE_ACTIONS = ACTION_TYPES;

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

  /** What wakes it — one card each. */
  readonly triggers: readonly AutomationTrigger[];

  /**
   * The join between consecutive triggers.
   *
   * Length is `triggers.length - 1` when there are two or more. Default for a new gap is OR.
   */
  readonly triggerJoins: readonly BooleanJoin[];

  /** What has to hold — one card each. A card may wrap a leaf in `not`. */
  readonly conditions: readonly AutomationCondition[];

  /**
   * The join between consecutive conditions.
   *
   * Length is `conditions.length - 1` when there are two or more. Default for a new gap is AND.
   */
  readonly conditionJoins: readonly BooleanJoin[];

  /** What it does — the Then sequence, including nested templates. */
  readonly actions: readonly AutomationAction[];

  /**
   * The stored trigger tree, kept whole when the cards cannot say it - an AND of ORs, say.
   *
   * Cards with joins can say an OR of AND-groups and nothing denser; a denser tree opens as its
   * leaves under OR, which is not what it means. It is written back as it was unless the
   * triggers are edited, so opening and saving an automation never changes what wakes it.
   */
  readonly keptTriggers?: KeptTriggers | undefined;
};

/** A trigger tree the cards cannot say, with the cards and joins it was opened as. */
export type KeptTriggers = {
  /** The tree as it was stored. */
  readonly tree: TriggerTree;

  /** The cards it was opened as; the draft still holding these is the draft unchanged. */
  readonly triggers: readonly AutomationTrigger[];

  /** The joins it was opened with. */
  readonly joins: readonly BooleanJoin[];
};

/**
 * Whether a trigger tree says no more than cards with AND and OR joins can.
 *
 * Joins bind AND tighter than OR, so they say an OR of AND-groups of leaves. An OR nested in an
 * OR of leaves is the same OR; anything else - an OR inside an AND, a group inside a group -
 * is not something a row of cards can hold.
 *
 * @param tree - The stored tree.
 * @returns True when the cards say exactly what the tree does.
 */
export function isCardExpressible(tree: TriggerTree): boolean {
  if (!isTriggerTreeOp(tree)) {
    return true;
  }

  /**
   * Whether every item of a node is a leaf.
   *
   * @param items - The node's items.
   * @returns True when none of them is a node.
   */
  const allLeaves = (items: readonly TriggerTree[]): boolean =>
    items.every((item) => !isTriggerTreeOp(item));

  if (tree.op === 'and') {
    return allLeaves(tree.items);
  }

  return tree.items.every((child) => !isTriggerTreeOp(child) || allLeaves(child.items));
}

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
    triggerJoins: [],
    conditions: [],
    conditionJoins: [],
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
  const definition = automation.definition as Partial<AutomationDefinition> & {
    readonly conditions?: unknown;
    readonly actions?: unknown;
  };

  const triggers = flatTriggersFromDefinition(definition);
  const conditions = flatConditionsFromDefinition(definition);
  const stored: unknown = definition.triggers;
  const tree = triggerTreeSchema.safeParse(stored);
  const isKept = !Array.isArray(stored) && tree.success && !isCardExpressible(tree.data);

  return {
    key: automation.key,
    name: automation.name,
    description: automation.description,
    mode: automation.mode,
    maxRuntimeMs: automation.maxRuntimeMs,
    isEnabled: automation.isEnabled,
    triggers: triggers.items,
    triggerJoins: triggers.joins,
    conditions: conditions.items,
    conditionJoins: conditions.joins,
    actions: actionsFromDefinition(definition),
    ...(isKept
      ? { keptTriggers: { tree: tree.data, triggers: triggers.items, joins: triggers.joins } }
      : {}),
  };
}

/**
 * The trigger tree a draft saves: the one it was opened with, when the cards could not say it
 * and have not been touched, and otherwise the one the cards say.
 *
 * Compared by identity: a draft is replaced, never changed, so cards still the very list they
 * were opened as have not been edited.
 *
 * @param draft - The draft.
 * @returns The tree to save.
 */
export function triggersToSave(draft: AutomationDraft): TriggerTree {
  if (draft.keptTriggers !== undefined && isKeepingTriggers(draft)) {
    return draft.keptTriggers.tree;
  }

  return triggerTreeFromFlat(draft.triggers, draft.triggerJoins);
}

/**
 * Whether a draft still holds a stored trigger tree the cards cannot say, untouched.
 *
 * @param draft - The draft.
 * @returns True when saving now would write the stored tree back as it was.
 */
export function isKeepingTriggers(draft: AutomationDraft): boolean {
  const kept = draft.keptTriggers;

  return kept?.triggers === draft.triggers && kept.joins === draft.triggerJoins;
}

/**
 * Reads triggers into the flat list and joins the editor edits.
 *
 * @param definition - Whatever the column held.
 * @param definition.triggers - A tree, a legacy flat list, or anything else.
 * @returns Leaf triggers and the joins between them.
 */
function flatTriggersFromDefinition(definition: { readonly triggers?: unknown }): {
  readonly items: AutomationTrigger[];
  readonly joins: BooleanJoin[];
} {
  const { triggers } = definition;

  if (Array.isArray(triggers)) {
    return flatFromTriggerLeaves(triggers as AutomationTrigger[], 'or');
  }

  if (triggers === undefined || triggers === null || typeof triggers !== 'object') {
    return { items: [], joins: [] };
  }

  // Not parsed: a leaf this build does not know still opens as a card, and the save
  // checks it against the schema and names it, rather than the card vanishing.
  return flatFromTriggerTree(triggers as TriggerTree);
}

/**
 * Turns a stored trigger tree into a flat card list.
 *
 * A top-level OR of leaves (or of AND-groups of leaves) becomes that sequence with joins. Anything
 * denser flattens to leaves under OR so the form still opens.
 *
 * @param tree - The stored tree.
 * @returns Flat triggers and joins.
 */
export function flatFromTriggerTree(tree: TriggerTree): {
  readonly items: AutomationTrigger[];
  readonly joins: BooleanJoin[];
} {
  if (!isTriggerTreeOp(tree)) {
    return { items: [tree], joins: [] };
  }

  if (tree.op === 'or') {
    const items: AutomationTrigger[] = [];
    const joins: BooleanJoin[] = [];

    for (const child of tree.items) {
      if (!isTriggerTreeOp(child)) {
        if (items.length > 0) {
          joins.push('or');
        }

        items.push(child);
        continue;
      }

      if (child.op === 'and' && child.items.every((item) => !isTriggerTreeOp(item))) {
        for (const [inner, leaf] of child.items.entries()) {
          if (items.length > 0) {
            joins.push(inner === 0 ? 'or' : 'and');
          }

          items.push(leaf as AutomationTrigger);
        }

        continue;
      }

      for (const leaf of flattenTriggers(child)) {
        if (items.length > 0) {
          joins.push('or');
        }

        items.push(leaf);
      }
    }

    return { items, joins };
  }

  if (tree.items.every((item) => !isTriggerTreeOp(item))) {
    return flatFromTriggerLeaves(tree.items as AutomationTrigger[], 'and');
  }

  return flatFromTriggerLeaves(flattenTriggers(tree), 'or');
}

/**
 * Builds a flat list with a uniform join between every pair.
 *
 * @param leaves - Trigger cards.
 * @param join - The join between each pair.
 * @returns Flat triggers and joins.
 */
function flatFromTriggerLeaves(
  leaves: readonly AutomationTrigger[],
  join: BooleanJoin,
): { readonly items: AutomationTrigger[]; readonly joins: BooleanJoin[] } {
  if (leaves.length === 0) {
    return { items: [], joins: [] };
  }

  return {
    items: [...leaves],
    joins: Array.from({ length: leaves.length - 1 }, () => join),
  };
}

/**
 * Builds a trigger tree from flat cards and joins, with AND binding tighter than OR.
 *
 * @param triggers - Leaf triggers in card order.
 * @param joins - Join before each trigger after the first.
 * @returns A leaf, or an AND/OR tree.
 */
export function triggerTreeFromFlat(
  triggers: readonly AutomationTrigger[],
  joins: readonly BooleanJoin[],
): TriggerTree {
  const [first, ...rest] = triggers;

  if (first === undefined) {
    return { type: 'manual' };
  }

  // Every card after the first joins the one before it, OR where a join is missing: a card is
  // never dropped for want of a join.
  const groups: AutomationTrigger[][] = [[first]];

  for (const [index, next] of rest.entries()) {
    const current = groups.at(-1);

    if (joins[index] === 'and' && current !== undefined) {
      current.push(next);
    } else {
      groups.push([next]);
    }
  }

  const orItems: TriggerTree[] = groups.map((group) =>
    group.length === 1 && group[0] !== undefined ? group[0] : { op: 'and', items: group },
  );

  return orItems.length === 1 && orItems[0] !== undefined
    ? orItems[0]
    : { op: 'or', items: orItems };
}

/**
 * Reads `if` (or legacy `conditions`) into the flat list the editor edits.
 *
 * @param definition - Whatever the column held.
 * @returns Draft conditions and joins.
 */
function flatConditionsFromDefinition(
  definition: Partial<AutomationDefinition> & { readonly conditions?: unknown },
): { readonly items: AutomationCondition[]; readonly joins: BooleanJoin[] } {
  if (definition.if !== undefined) {
    return flatFromBooleanTree(definition.if);
  }

  if (Array.isArray(definition.conditions)) {
    return flatFromConditionList(definition.conditions as AutomationCondition[], 'and');
  }

  return { items: [], joins: [] };
}

/**
 * Turns a stored boolean tree into flat cards with joins and optional NOT wrappers.
 *
 * @param tree - The stored `if` (or a nested condition tree).
 * @returns Draft conditions and joins.
 */
export function flatFromBooleanTree(tree: BooleanTree): {
  readonly items: AutomationCondition[];
  readonly joins: BooleanJoin[];
} {
  if (!isBooleanTreeOp(tree)) {
    return { items: [tree], joins: [] };
  }

  if (tree.op === 'not') {
    return { items: [conditionFromBooleanTree(tree)], joins: [] };
  }

  if (tree.op === 'or') {
    const items: AutomationCondition[] = [];
    const joins: BooleanJoin[] = [];

    for (const child of tree.items) {
      if (!isBooleanTreeOp(child)) {
        if (items.length > 0) {
          joins.push('or');
        }

        items.push(child);
        continue;
      }

      if (child.op === 'not' && !isBooleanTreeOp(child.item)) {
        if (items.length > 0) {
          joins.push('or');
        }

        items.push(conditionFromBooleanTree(child));
        continue;
      }

      if (child.op === 'and') {
        for (const [inner, item] of child.items.entries()) {
          if (items.length > 0) {
            joins.push(inner === 0 ? 'or' : 'and');
          }

          items.push(conditionFromBooleanTree(item));
        }

        continue;
      }

      if (items.length > 0) {
        joins.push('or');
      }

      items.push(conditionFromBooleanTree(child));
    }

    return { items, joins };
  }

  return {
    items: tree.items.map(conditionFromBooleanTree),
    joins: Array.from({ length: tree.items.length - 1 }, () => 'and' as const),
  };
}

/**
 * Builds a flat list with a uniform join between every pair of draft conditions.
 *
 * @param conditions - Condition cards.
 * @param join - The join between each pair.
 * @returns Flat conditions and joins.
 */
function flatFromConditionList(
  conditions: readonly AutomationCondition[],
  join: BooleanJoin,
): { readonly items: AutomationCondition[]; readonly joins: BooleanJoin[] } {
  if (conditions.length === 0) {
    return { items: [], joins: [] };
  }

  return {
    items: [...conditions],
    joins: Array.from({ length: conditions.length - 1 }, () => join),
  };
}

/**
 * Builds an `if` tree from flat cards and joins, with AND binding tighter than OR.
 *
 * @param conditions - Draft conditions in card order.
 * @param joins - Join before each condition after the first.
 * @returns A boolean tree, or `undefined` when the list is empty.
 */
export function ifTreeFromFlat(
  conditions: readonly AutomationCondition[],
  joins: readonly BooleanJoin[],
): BooleanTree | undefined {
  const [first, ...rest] = conditions;

  if (first === undefined) {
    return undefined;
  }

  // Every card after the first joins the one before it, AND where a join is missing: a card
  // is never dropped for want of a join.
  const groups: BooleanTree[][] = [[booleanTreeFromCondition(first)]];

  for (const [index, next] of rest.entries()) {
    const leaf = booleanTreeFromCondition(next);
    const current = groups.at(-1);

    if (joins[index] !== 'or' && current !== undefined) {
      current.push(leaf);
    } else {
      groups.push([leaf]);
    }
  }

  const orItems: BooleanTree[] = groups.map((group) =>
    group.length === 1 && group[0] !== undefined ? group[0] : { op: 'and', items: group },
  );

  return orItems.length === 1 && orItems[0] !== undefined
    ? orItems[0]
    : { op: 'or', items: orItems };
}

/**
 * Reads `then` (or legacy `actions`) into the draft action list.
 *
 * @param definition - Whatever the column held.
 * @param definition.then - The action sequence, when the document has one.
 * @param definition.actions - The legacy name for the same list.
 * @returns Draft actions.
 */
function actionsFromDefinition(definition: {
  readonly then?: unknown;
  readonly actions?: unknown;
}): AutomationAction[] {
  // Not parsed, for the reason the triggers are not: an action this build does not know
  // opens as a card and is named by the save.
  if (Array.isArray(definition.then)) {
    return [...(definition.then as AutomationAction[])];
  }

  if (Array.isArray(definition.actions)) {
    return [...(definition.actions as AutomationAction[])];
  }

  return [];
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
    case 'group_and':
    case 'group_or': {
      return { type: type === 'group_and' ? 'and' : 'or', conditions: [blankCondition('state')] };
    }

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
 * An empty entity-state leaf, as nested condition trees start from.
 *
 * @returns A blank state leaf in document form.
 */
export function blankStateLeaf(): ConditionLeaf {
  return { type: 'state', entityId: partialEntityId(''), state: '' };
}

/**
 * An action of the chosen kind, with nothing filled in.
 *
 * Nested templates start with empty bodies so the dashed Add block is the only child until
 * somebody picks one. The schema refuses empty nested lists on save.
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
        condition: blankStateLeaf(),
        timeoutMs: 60_000,
      };
    }

    case 'wait_for_trigger': {
      return { type: 'wait_for_trigger', trigger: { type: 'manual' }, timeoutMs: 60_000 };
    }

    case 'notify': {
      return { type: 'notify', channel: 'push', message: '' };
    }

    case 'package_service': {
      return { type: 'package_service', packageId: '', service: '', params: {} };
    }

    case 'parallel': {
      return { type: 'parallel', actions: [] };
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
      return { type: 'while', condition: blankStateLeaf(), actions: [] };
    }

    case 'do_while': {
      return { type: 'do_while', condition: blankStateLeaf(), actions: [] };
    }

    case 'if': {
      return { type: 'if', condition: blankStateLeaf(), then: [], else: [] };
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

/**
 * Whether a condition is one this editor draws leaf fields for.
 *
 * @param condition - The condition to look at.
 * @returns Whether its fields can be drawn.
 */
export function isEditableCondition(condition: AutomationCondition): boolean {
  return condition.type !== 'and' && condition.type !== 'or' && condition.type !== 'not';
}

/**
 * Whether an action is a leaf this editor draws field rows for (not a nested template).
 *
 * @param action - The action to look at.
 * @returns Whether its leaf fields can be drawn.
 */
export function isEditableAction(action: AutomationAction): boolean {
  return !(NESTED_ACTION_TYPES as readonly string[]).includes(action.type);
}

/**
 * Whether a condition card is negated.
 *
 * @param condition - The draft condition.
 * @returns Whether NOT is on.
 */
export function isConditionNegated(condition: AutomationCondition): boolean {
  return condition.type === 'not';
}

/**
 * Turns NOT on or off for a condition card, wrapping or unwrapping a single leaf.
 *
 * @param condition - The card's condition.
 * @param negated - Whether NOT should be on.
 * @returns The condition as it should be stored on the card.
 */
export function withConditionNegated(
  condition: AutomationCondition,
  negated: boolean,
): AutomationCondition {
  if (negated) {
    return condition.type === 'not' ? condition : { type: 'not', condition };
  }

  return condition.type === 'not' ? condition.condition : condition;
}

/**
 * The leaf (or inner condition) a card shows fields for, stripping a single NOT wrapper.
 *
 * @param condition - The card's condition.
 * @returns What the fields edit.
 */
export function conditionWithoutNot(condition: AutomationCondition): AutomationCondition {
  return condition.type === 'not' ? condition.condition : condition;
}

/**
 * Pads joins to match a list length after an insert or remove.
 *
 * @param joins - Existing joins.
 * @param itemCount - How many items the list now has.
 * @param fill - Join to use for any new gaps.
 * @returns Joins of length `max(0, itemCount - 1)`.
 */
export function resizeJoins(
  joins: readonly BooleanJoin[],
  itemCount: number,
  fill: BooleanJoin,
): readonly BooleanJoin[] {
  const needed = Math.max(0, itemCount - 1);

  if (joins.length === needed) {
    return joins;
  }

  if (joins.length > needed) {
    return joins.slice(0, needed);
  }

  return [...joins, ...Array.from({ length: needed - joins.length }, () => fill)];
}

/** What a draft becomes, or why it cannot. */
export type DraftResult =
  | { readonly ok: true; readonly body: AutomationCreate }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Where a problem is, in the words the form uses.
 *
 * @param path - The path the schema reported.
 * @returns Where to look.
 */
function describePath(path: readonly PropertyKey[]): string {
  const parts = path.map(String);
  const [group, ...rest] = parts;

  if (group === 'then' || group === 'actions') {
    const [index, ...field] = rest;

    if (index !== undefined && /^\d+$/u.test(index)) {
      return [`Then › action ${String(Number(index) + 1)}`, ...field].join(' › ');
    }

    return ['Then', ...rest].join(' › ') || 'Then';
  }

  if (group === 'triggers') {
    if (rest[0] === 'items' && rest[1] !== undefined && /^\d+$/u.test(rest[1])) {
      return [`When › trigger ${String(Number(rest[1]) + 1)}`, ...rest.slice(2)].join(' › ');
    }

    return [`When › trigger 1`, ...rest].join(' › ');
  }

  if (group === 'if' || group === 'conditions') {
    if (rest[0] === 'items' && rest[1] !== undefined && /^\d+$/u.test(rest[1])) {
      return [`If › condition ${String(Number(rest[1]) + 1)}`, ...rest.slice(2)].join(' › ');
    }

    return [`If › condition 1`, ...rest].join(' › ');
  }

  return parts.join(' › ') || 'The rule';
}

/**
 * What is wrong with a field, said the way a person would say it.
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

  if (draft.triggers.length === 0) {
    problems.push('When › trigger 1: needs at least one');
  }

  if (draft.actions.length === 0) {
    problems.push('Then › action 1: needs at least one');
  }

  const ifTree = ifTreeFromFlat(draft.conditions, draft.conditionJoins);
  const definition = automationDefinitionSchema.safeParse({
    triggers: triggersToSave(draft),
    ...(ifTree === undefined ? {} : { if: ifTree }),
    then: draft.actions,
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
      maxRuntimeMs: draft.maxRuntimeMs,
      isEnabled: draft.isEnabled,
    },
  };
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
