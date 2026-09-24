/**
 * What the aliases page narrows its list by, and how one alias is judged against it.
 *
 * Pure, like the device and tag filters, so the page's behaviour is testable without a page.
 *
 * Whether an alias is switched on and whether something is wrong with it are two questions, and
 * the filter asks them apart: one dropdown that mixed them could not find an alias that is on
 * and failing, which is the one worth finding.
 */
import type { AliasView } from '@nebula-home/contracts';

import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';

/** Whether it is switched on. */
export const ALIAS_STATES = ['any', 'on', 'off'] as const;

/** Whether it is switched on. */
export type AliasState = (typeof ALIAS_STATES)[number];

/** What may be wrong with it. */
export const ALIAS_HEALTHS = ['any', 'failing', 'unavailable'] as const;

/** What may be wrong with it. */
export type AliasHealth = (typeof ALIAS_HEALTHS)[number];

/** What the header has been set to. */
export type AliasFilter = {
  /** What was typed; every word must be found in the alias or one of its sources. */
  readonly search: string;

  /** One behavioural domain, or blank for any. */
  readonly domain: string;

  /** Switched on, off, or either. */
  readonly state: AliasState;

  /** Failing to work its formula out, reading as unavailable, or either. */
  readonly health: AliasHealth;
};

/** Nothing set: every alias shows. */
export const OPEN_ALIAS_FILTER: AliasFilter = {
  search: '',
  domain: '',
  state: 'any',
  health: 'any',
};

/** How the filter lives in the address. */
export const ALIAS_FILTER_CODEC: ListCodec<AliasFilter> = {
  keys: ['q', 'domain', 'state', 'health'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    domain: params.get('domain') ?? '',
    state: readChoice(params, 'state', ALIAS_STATES, 'any'),
    health: readChoice(params, 'health', ALIAS_HEALTHS, 'any'),
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
      domain: [filter.domain, ''],
      state: [filter.state, 'any'],
      health: [filter.health, 'any'],
    }),
};

/**
 * How many facets are set, for the Filter button's badge.
 *
 * @param filter - The filter.
 * @returns The count; the search has its own box.
 */
export function aliasFacetCount(filter: AliasFilter): number {
  return (
    Number(filter.domain !== '') + Number(filter.state !== 'any') + Number(filter.health !== 'any')
  );
}

/**
 * Whether anything narrows the list.
 *
 * @param filter - The filter.
 * @returns True when the search or a facet is set.
 */
export function isAliasNarrowing(filter: AliasFilter): boolean {
  return filter.search.trim() !== '' || aliasFacetCount(filter) > 0;
}

/**
 * Whether one alias belongs in the list under a filter.
 *
 * @param alias - The alias.
 * @param filter - What the header has been set to.
 * @param isAvailable - Whether its entity is reachable; false when it has no entity at all.
 * @returns True when every part of the filter admits it.
 */
export function matchesAliasFilter(
  alias: AliasView,
  filter: AliasFilter,
  isAvailable: boolean,
): boolean {
  if (filter.domain !== '' && alias.domain !== filter.domain) {
    return false;
  }

  if (filter.state === 'on' && !alias.isEnabled) {
    return false;
  }

  if (filter.state === 'off' && alias.isEnabled) {
    return false;
  }

  if (filter.health === 'failing' && alias.lastError === null) {
    return false;
  }

  if (filter.health === 'unavailable' && isAvailable) {
    return false;
  }

  return matchesQuery(
    [
      alias.name,
      alias.entityId,
      alias.domain,
      ...alias.sources.flatMap((source) => [source.entityName, source.entityId, source.areaName]),
    ],
    filter.search,
  );
}

/**
 * The aliases in the order the list reads them: by the name a person gave each.
 *
 * The API answers by address, which put "Kitchen average" after "Attic humidity" only when their
 * addresses happened to agree.
 *
 * @param aliases - The aliases, in any order.
 * @returns A new list, by name.
 */
export function byAliasName(aliases: readonly AliasView[]): AliasView[] {
  return [...aliases].sort((left, right) => left.name.localeCompare(right.name));
}
