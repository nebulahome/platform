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

import { collator } from '@/i18n/formatters';
import { defineMessage, type Message, text } from '@/i18n/messages';
import { chainText } from '@/lib/describe-automation';
import { matchesQuery } from '@/lib/search-text';
import { nonDefault, type ListCodec } from '@/lib/use-list-state';
import type { SortDirection } from '@/lib/use-paging';

/**
 * How an automation stands, as the Status facet ticks it: on or off, and how its runs went. The
 * two pairs overlap - an enabled rule may never have run - so one rule can stand two ways.
 */
export const AUTOMATION_STANDINGS = ['enabled', 'off', 'never', 'failed'] as const;

/** One standing. */
export type AutomationStanding = (typeof AUTOMATION_STANDINGS)[number];

/** How concurrent runs are handled. */
export type AutomationMode = AutomationView['mode'];

/** What the header has been set to. */
export type AutomationFilter = {
  /** What was typed; every word must be found in the name, the key, the description or the chain. */
  readonly search: string;

  /** Only automations standing so: any of them. None means any standing. */
  readonly statuses: readonly AutomationStanding[];

  /** How concurrent runs are handled. Blank means any. */
  readonly mode: AutomationMode | '';

  /** A trigger kind the definition must include. Blank means any. */
  readonly triggerType: TriggerType | '';

  /** Only automations naming an entity the house does not have. */
  readonly isMissing: boolean;
};

/** Nothing set: every automation shows. */
export const OPEN_AUTOMATION_FILTER: AutomationFilter = {
  search: '',
  statuses: [],
  mode: '',
  triggerType: '',
  isMissing: false,
};

/**
 * Whether an automation stands one way.
 *
 * @param automation - The automation.
 * @param standing - The standing.
 * @returns True when it stands so.
 */
export function isStanding(automation: AutomationView, standing: AutomationStanding): boolean {
  switch (standing) {
    case 'enabled':
      return automation.isEnabled;
    case 'off':
      return !automation.isEnabled;
    // The run on record, as the row and the Last run order read it - not `lastTriggeredAt`.
    case 'never':
      return automation.lastRun === null;
    case 'failed':
      return automation.lastRun?.result === 'failed' || automation.lastRun?.result === 'timeout';
  }
}

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
  return (
    (filter.statuses.length === 0 ||
      filter.statuses.some((standing) => isStanding(automation, standing))) &&
    (filter.mode === '' || automation.mode === filter.mode) &&
    (filter.triggerType === '' ||
      triggerTypesOf(automation.definition).includes(filter.triggerType)) &&
    (!filter.isMissing || automation.missingEntities.length > 0) &&
    // The chain is what the row shows and how a rule is remembered - "the one that turns on the
    // porch light" - so the search reads it too.
    matchesQuery(
      [automation.name, automation.key, automation.description, chainText(automation.definition)],
      filter.search,
    )
  );
}

/**
 * How many automations stand each way, for the counts beside the Status boxes.
 *
 * @param automations - The automations.
 * @returns The count of each standing.
 */
export function countAutomationStandings(
  automations: readonly AutomationView[],
): Readonly<Record<AutomationStanding, number>> {
  return {
    enabled: automations.filter((each) => isStanding(each, 'enabled')).length,
    off: automations.filter((each) => isStanding(each, 'off')).length,
    never: automations.filter((each) => isStanding(each, 'never')).length,
    failed: automations.filter((each) => isStanding(each, 'failed')).length,
  };
}

/** The choices the loaded automations give the Mode and Trigger facets. */
export type AutomationChoices = {
  /** The modes in use, in the schema's order. */
  readonly modes: readonly AutomationMode[];

  /** The trigger kinds in use, in the schema's order. */
  readonly triggers: readonly TriggerType[];
};

/**
 * The modes and trigger kinds the automations use, so the sheet offers only those.
 *
 * @param automations - The automations.
 * @returns The choices.
 */
export function automationChoices(automations: readonly AutomationView[]): AutomationChoices {
  const used = new Set(automations.flatMap((each) => triggerTypesOf(each.definition)));

  return {
    modes: AUTOMATION_MODES.filter((mode) => automations.some((each) => each.mode === mode)),
    triggers: TRIGGER_TYPES.filter((type) => used.has(type)),
  };
}

/** What each mode is called, in the sheet and on the row alike. */
const MODE_LABELS: Readonly<Record<AutomationView['mode'], Message>> = {
  single: defineMessage('automations.modes.single', 'Single'),
  restart: defineMessage('automations.modes.restart', 'Restart'),
  queued: defineMessage('automations.modes.queued', 'Queued'),
  parallel: defineMessage('automations.modes.parallel', 'Parallel'),
};

/**
 * What a mode is called.
 *
 * @param mode - The mode.
 * @returns Its name, in the reader's language.
 */
export function modeLabel(mode: AutomationView['mode']): string {
  return text(MODE_LABELS[mode]);
}

/** The columns the table sorts by; the first is the order it opens in. */
export const AUTOMATION_SORTS = ['name', 'mode', 'run', 'enabled'] as const;

/** One column the table sorts by. */
export type AutomationSort = (typeof AUTOMATION_SORTS)[number];

/**
 * Puts automations in the order of a column. One that never ran goes last on Last run, whichever
 * way it sorts; ties go by name.
 *
 * Ascending is what the first click gives: modes by name, Last run the most recent first, Enabled
 * the ones on first.
 *
 * @param automations - The automations.
 * @param sort - The column.
 * @param direction - Which way.
 * @returns A sorted copy.
 */
export function sortAutomations(
  automations: readonly AutomationView[],
  sort: AutomationSort,
  direction: SortDirection,
): AutomationView[] {
  const names = collator();
  const sign = direction === 'asc' ? 1 : -1;

  return [...automations].sort((left, right) => {
    const byName = names.compare(left.name, right.name);

    switch (sort) {
      case 'name':
        return sign * byName;
      case 'mode':
        return sign * names.compare(modeLabel(left.mode), modeLabel(right.mode)) || byName;
      case 'run':
        return (
          Number(left.lastRun === null) - Number(right.lastRun === null) ||
          sign * ((right.lastRun?.time.getTime() ?? 0) - (left.lastRun?.time.getTime() ?? 0)) ||
          byName
        );
      case 'enabled':
        return sign * (Number(right.isEnabled) - Number(left.isEnabled)) || byName;
    }
  });
}

/** How the filter lives in the address. */
export const AUTOMATION_FILTER_CODEC: ListCodec<AutomationFilter> = {
  keys: ['q', 'status', 'mode', 'trigger', 'missing'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    statuses: (params.get('status') ?? '')
      .split(',')
      .flatMap((value) => AUTOMATION_STANDINGS.filter((standing) => standing === value)),
    mode: toAutomationMode(params.get('mode') ?? ''),
    triggerType: toAutomationTriggerType(params.get('trigger') ?? ''),
    isMissing: params.get('missing') === '1',
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
      status: [filter.statuses.join(','), ''],
      mode: [filter.mode, ''],
      trigger: [filter.triggerType, ''],
      missing: [filter.isMissing ? '1' : '', ''],
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
    Number(filter.statuses.length > 0) +
    Number(filter.mode !== '') +
    Number(filter.triggerType !== '') +
    Number(filter.isMissing)
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
 * Narrows a string back to a mode.
 *
 * @param value - What the select or the address held.
 * @returns The mode, or blank for something that is not one.
 */
export function toAutomationMode(value: string): AutomationMode | '' {
  return AUTOMATION_MODES.find((mode) => mode === value) ?? '';
}

/**
 * Narrows a string back to a trigger kind.
 *
 * @param value - What the select or the address held.
 * @returns The kind, or blank for something that is not one.
 */
export function toAutomationTriggerType(value: string): TriggerType | '' {
  return TRIGGER_TYPES.find((type) => type === value) ?? '';
}
