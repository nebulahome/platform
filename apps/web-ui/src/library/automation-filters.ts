/**
 * What the automations page narrows its list by, and how one rule is judged against it.
 *
 * Pure, like the alias and device filters, so the page's behaviour is testable without a page.
 */
import {
  AUTOMATION_MODES,
  TRIGGER_TYPES,
  flattenTriggers,
  isTriggerTreeOp,
  type AutomationTrigger,
  type AutomationView,
  type TriggerType,
  type TriggerTree,
} from '@nebula-home/contracts';

/** Standing a filter may insist on. */
export const AUTOMATION_STATUSES = ['any', 'enabled', 'off'] as const;

/** Standing a filter may insist on. */
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

/** Modes a filter may insist on, including "any". */
export const AUTOMATION_MODE_CHOICES = ['any', ...AUTOMATION_MODES] as const;

/** Modes a filter may insist on, including "any". */
export type AutomationModeChoice = (typeof AUTOMATION_MODE_CHOICES)[number];

/** Trigger kinds a filter may insist on, including "any". */
export const AUTOMATION_TRIGGER_CHOICES = ['any', ...TRIGGER_TYPES] as const;

/** Trigger kinds a filter may insist on, including "any". */
export type AutomationTriggerChoice = (typeof AUTOMATION_TRIGGER_CHOICES)[number];

/** What the header has been set to. */
export type AutomationFilter = {
  /** What was typed; matched against the name, the key, and the description. */
  readonly search: string;

  /** Standing the automation must have. */
  readonly status: AutomationStatus;

  /** How concurrent runs are handled, or any. */
  readonly mode: AutomationModeChoice;

  /** A trigger kind the definition must include, or any. */
  readonly triggerType: AutomationTriggerChoice;
};

/** Nothing set: every automation shows. */
export const OPEN_AUTOMATION_FILTER: AutomationFilter = {
  search: '',
  status: 'any',
  mode: 'any',
  triggerType: 'any',
};

/**
 * Whether one automation belongs in the list under a filter.
 *
 * @param automation - The automation.
 * @param filter - What the header has been set to.
 * @returns True when every part of the filter admits it.
 */
export function matchesAutomationFilter(
  automation: AutomationView,
  filter: AutomationFilter,
): boolean {
  if (filter.status === 'enabled' && !automation.isEnabled) {
    return false;
  }

  if (filter.status === 'off' && automation.isEnabled) {
    return false;
  }

  if (filter.mode !== 'any' && automation.mode !== filter.mode) {
    return false;
  }

  if (filter.triggerType !== 'any') {
    const types = triggerTypesOf(automation.definition);

    if (!types.includes(filter.triggerType)) {
      return false;
    }
  }

  const needle = filter.search.trim().toLowerCase();

  if (needle === '') {
    return true;
  }

  const haystack = [automation.name, automation.key, automation.description];

  return haystack.some((part) => part.toLowerCase().includes(needle));
}

/**
 * The trigger kinds present in a stored definition.
 *
 * Accepts both the current `{ triggers }` tree and a legacy flat list. A document that cannot be
 * read contributes no kinds, so a narrowed filter hides it rather than throwing.
 *
 * @param definition - Whatever the column held.
 * @returns The kinds, in document order, without duplicates removed — the matcher only needs
 *   membership.
 */
export function triggerTypesOf(definition: unknown): readonly TriggerType[] {
  const triggers = readTriggers(definition);

  if (triggers === null) {
    return [];
  }

  return triggers.map((trigger) => trigger.type);
}

/**
 * Reads the trigger leaves from a stored document.
 *
 * @param definition - Whatever the column held.
 * @returns The leaves, or null when the document is not one this build can read.
 */
function readTriggers(definition: unknown): AutomationTrigger[] | null {
  if (definition === null || typeof definition !== 'object') {
    return null;
  }

  const document = definition as { readonly triggers?: unknown };
  const { triggers } = document;

  if (triggers === undefined || triggers === null) {
    return null;
  }

  if (Array.isArray(triggers)) {
    return triggers.filter(isTriggerLeaf);
  }

  if (typeof triggers !== 'object') {
    return null;
  }

  const tree = triggers as TriggerTree;

  try {
    if (isTriggerTreeOp(tree)) {
      return flattenTriggers(tree).filter(isTriggerLeaf);
    }

    return isTriggerLeaf(tree) ? [tree] : null;
  } catch {
    return null;
  }
}

/**
 * Whether a value looks like a leaf trigger this filter understands.
 *
 * @param value - A candidate leaf.
 * @returns True when it names a known trigger kind.
 */
function isTriggerLeaf(value: unknown): value is AutomationTrigger {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const type = (value as { readonly type?: unknown }).type;

  return typeof type === 'string' && (TRIGGER_TYPES as readonly string[]).includes(type);
}

/**
 * Narrows a string back to a standing choice.
 *
 * @param value - What the select or the address held.
 * @returns The choice, or `any` for something that is not one.
 */
export function toAutomationStatus(value: string): AutomationStatus {
  return AUTOMATION_STATUSES.find((status) => status === value) ?? 'any';
}

/**
 * Narrows a string back to a mode choice.
 *
 * @param value - What the select or the address held.
 * @returns The choice, or `any` for something that is not one.
 */
export function toAutomationMode(value: string): AutomationModeChoice {
  return AUTOMATION_MODE_CHOICES.find((mode) => mode === value) ?? 'any';
}

/**
 * Narrows a string back to a trigger-kind choice.
 *
 * @param value - What the select or the address held.
 * @returns The choice, or `any` for something that is not one.
 */
export function toAutomationTriggerType(value: string): AutomationTriggerChoice {
  return AUTOMATION_TRIGGER_CHOICES.find((type) => type === value) ?? 'any';
}
