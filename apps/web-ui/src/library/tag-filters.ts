/**
 * What the tags page narrows its list by, and how one tag is judged against it.
 *
 * Pure, like the device and vendor filters, so the page's behaviour is testable without a page.
 */
import { TAG_COLORS, type TagColor, type TagView } from '@nebula-home/contracts';

import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';

/** What carries a tag: anything, devices, entities, or nothing yet. */
export const TAG_USAGES = ['any', 'devices', 'entities', 'unused'] as const;

/** What carries a tag. */
export type TagUsage = (typeof TAG_USAGES)[number];

/** What the header has been set to. */
export type TagFilter = {
  /** What was typed in the search; every word must be in the name or the key. */
  readonly search: string;

  /** One colour, or blank for any. */
  readonly color: TagColor | '';

  /** What the tag must be on. */
  readonly usage: TagUsage;
};

/** Nothing set: every tag shows. */
export const OPEN_TAG_FILTER: TagFilter = { search: '', color: '', usage: 'any' };

/**
 * Whether a facet is set - the search aside, which has its own box.
 *
 * @param filter - What the header has been set to.
 * @returns True when the filter button should say so.
 */
export function isNarrowingTags(filter: TagFilter): boolean {
  return filter.color !== '' || filter.usage !== 'any';
}

/** How the filter lives in the address. */
export const TAG_FILTER_CODEC: ListCodec<TagFilter> = {
  keys: ['q', 'color', 'on'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    color: readChoice<TagColor | ''>(params, 'color', ['', ...TAG_COLORS], ''),
    usage: readChoice(params, 'on', TAG_USAGES, 'any'),
  }),

  /**
   * Writes what differs from an open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) =>
    nonDefault({ q: [filter.search, ''], color: [filter.color, ''], on: [filter.usage, 'any'] }),
};

/** How many devices and entities carry a tag, as the page counted them. */
export type TagCarriers = {
  readonly devices: number;
  readonly entities: number;
};

/**
 * Whether one tag belongs in the list under a filter.
 *
 * @param tag - The tag.
 * @param filter - What the header has been set to.
 * @param carriers - What carries it, counted from the devices and entities the page shows; the
 * tag's own counts otherwise. The page's count is the fresher: the tag row the server counted can
 * be half a minute behind a device that was just tagged.
 * @returns True when every part of the filter admits it.
 */
export function matchesTagFilter(
  tag: TagView,
  filter: TagFilter,
  carriers: TagCarriers = { devices: tag.deviceCount, entities: tag.entityCount },
): boolean {
  if (filter.color !== '' && tag.color !== filter.color) {
    return false;
  }

  if (filter.usage === 'devices' && carriers.devices === 0) {
    return false;
  }

  if (filter.usage === 'entities' && carriers.entities === 0) {
    return false;
  }

  if (filter.usage === 'unused' && carriers.devices + carriers.entities > 0) {
    return false;
  }

  return matchesQuery([tag.name, tag.key], filter.search);
}
