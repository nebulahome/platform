/**
 * What the aliases page narrows its list by, and how one alias is judged against it.
 *
 * Pure, like the device and tag filters, so the page's behaviour is testable without a page.
 */
import type { AliasView } from '@nebula-home/contracts';

/** Standing a filter may insist on. */
export const ALIAS_STATUSES = ['any', 'enabled', 'off', 'failing', 'unavailable'] as const;

/** Standing a filter may insist on. */
export type AliasStatus = (typeof ALIAS_STATUSES)[number];

/** What the header has been set to. */
export type AliasFilter = {
  /** What was typed; matched against the name, the entity id, and source entity names. */
  readonly search: string;

  /** One behavioural domain, or blank for any. */
  readonly domain: string;

  /** Standing the alias must have. */
  readonly status: AliasStatus;
};

/** Nothing set: every alias shows. */
export const OPEN_ALIAS_FILTER: AliasFilter = { search: '', domain: '', status: 'any' };

/**
 * Whether one alias belongs in the list under a filter.
 *
 * @param alias - The alias.
 * @param filter - What the header has been set to.
 * @param isAvailable - Whether the live or loaded entity is reachable.
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

  if (filter.status === 'enabled' && !alias.isEnabled) {
    return false;
  }

  if (filter.status === 'off' && alias.isEnabled) {
    return false;
  }

  if (filter.status === 'failing' && alias.lastError === null) {
    return false;
  }

  if (filter.status === 'unavailable' && isAvailable) {
    return false;
  }

  const needle = filter.search.trim().toLowerCase();

  if (needle === '') {
    return true;
  }

  const haystack = [
    alias.name,
    alias.entityId,
    ...alias.sources.map((source) => source.entityName),
  ];

  return haystack.some((part) => part.toLowerCase().includes(needle));
}
