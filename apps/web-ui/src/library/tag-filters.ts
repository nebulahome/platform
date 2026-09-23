/**
 * What the tags page narrows its list by, and how one tag is judged against it.
 *
 * Pure, like the device and vendor filters, so the page's behaviour is testable without a page.
 */
import type { TagColor, TagView } from '@nebula-home/contracts';

/** What carries a tag: anything, devices, entities, or nothing yet. */
export const TAG_USAGES = ['any', 'devices', 'entities', 'unused'] as const;

/** What carries a tag. */
export type TagUsage = (typeof TAG_USAGES)[number];

/** What the header has been set to. */
export type TagFilter = {
  /** What was typed in the search; matched against the name. */
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

/**
 * Whether one tag belongs in the list under a filter.
 *
 * @param tag - The tag.
 * @param filter - What the header has been set to.
 * @returns True when every part of the filter admits it.
 */
export function matchesTagFilter(tag: TagView, filter: TagFilter): boolean {
  if (filter.color !== '' && tag.color !== filter.color) {
    return false;
  }

  if (filter.usage === 'devices' && tag.deviceCount === 0) {
    return false;
  }

  if (filter.usage === 'entities' && tag.entityCount === 0) {
    return false;
  }

  if (filter.usage === 'unused' && tag.deviceCount + tag.entityCount > 0) {
    return false;
  }

  const needle = filter.search.trim().toLowerCase();

  return needle === '' || tag.name.toLowerCase().includes(needle);
}
