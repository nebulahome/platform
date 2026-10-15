/**
 * What the automations page narrows its list by, and how one rule is judged against it.
 *
 * Pure, like the alias and device filters, so the page's behaviour is testable without a page.
 */
import {
  AUTOMATION_MODES,
  migrateDefinition,
  TRIGGER_TYPES,
  type AutomationTrigger,
  type AutomationView,
  type TriggerType,
} from '@nebulahome/contracts';

import { chainText } from '@/lib/describe-automation';
import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';

/** Standing a filter may insist on. */
export const AUTOMATION_STATUSES = ['any', 'enabled', 'off', 'never'] as const;

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
  /** What was typed; every word must be found in the name, the key, the description or the chain. */
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

  if (filter.status === 'never' && automation.lastTriggeredAt !== null) {
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

  // The chain is what the row shows and how a rule is remembered - "the one that turns on the
  // porch light" - so the search reads it too.
  return matchesQuery(
    [automation.name, automation.key, automation.description, chainText(automation.definition)],
    filter.search,
  );
}

/** What each mode is called, in the sheet and on the row alike. */
export const MODE_LABELS: Readonly<Record<AutomationView['mode'], string>> = Object.fromEntries(
  AUTOMATION_MODES.map((mode) => [mode, mode.charAt(0).toUpperCase() + mode.slice(1)]),
) as Record<AutomationView['mode'], string>;

/** How the filter lives in the address. */
export const AUTOMATION_FILTER_CODEC: ListCodec<AutomationFilter> = {
  keys: ['q', 'status', 'mode', 'trigger'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    status: readChoice(params, 'status', AUTOMATION_STATUSES, 'any'),
    mode: readChoice(params, 'mode', AUTOMATION_MODE_CHOICES, 'any'),
    triggerType: readChoice(params, 'trigger', AUTOMATION_TRIGGER_CHOICES, 'any'),
  }),

  /**
   * Writes what differs from an open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) =>
    nonDefault({
      q: [filter.search, ''],
      status: [filter.status, 'any'],
      mode: [filter.mode, 'any'],
      trigger: [filter.triggerType, 'any'],
    }),
};

/**
 * How many facets are set, for the Filter button's badge.
 *
 * @param filter - The filter.
 * @returns The count; the search has its own box.
 */
export function automationFacetCount(filter: AutomationFilter): number {
  return (
    Number(filter.status !== 'any') +
    Number(filter.mode !== 'any') +
    Number(filter.triggerType !== 'any')
  );
}

/**
 * Whether anything narrows the list.
 *
 * @param filter - The filter.
 * @returns True when the search or a facet is set.
 */
export function isAutomationNarrowing(filter: AutomationFilter): boolean {
  return filter.search.trim() !== '' || automationFacetCount(filter) > 0;
}

/**
 * The trigger kinds present in a stored definition.
 *
 * A document that cannot be read contributes no kinds, so a narrowed filter hides it rather than
 * throwing.
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
 * Reads the triggers from a stored document, through the format's migration so an older shape
 * reads like a current one.
 *
 * @param definition - Whatever the column held.
 * @returns The triggers, or null when the document is not one this build can read.
 */
function readTriggers(definition: unknown): AutomationTrigger[] | null {
  const document = migrateDefinition(definition);

  if (document === null || typeof document !== 'object') {
    return null;
  }

  const { triggers } = document as { readonly triggers?: unknown };

  return Array.isArray(triggers) ? triggers.filter(isTriggerLeaf) : null;
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
