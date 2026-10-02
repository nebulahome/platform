import { describe, expect, it } from 'vitest';

import type { TagView } from '@nebulahome/contracts';

import { isNarrowingTags, matchesTagFilter, OPEN_TAG_FILTER } from './tag-filters';

/** A tag on two devices and no entity. */
const EXTERIOR: TagView = {
  id: 'a',
  key: 'exterior',
  name: 'Exterior',
  color: 'green',
  icon: null,
  deviceCount: 2,
  entityCount: 0,
};

/** A tag on nothing. */
const SPARE: TagView = {
  id: 'b',
  key: 'spare',
  name: 'Spare',
  color: 'pink',
  icon: null,
  deviceCount: 0,
  entityCount: 0,
};

describe('matchesTagFilter', () => {
  it('admits everything when nothing is set', () => {
    expect(matchesTagFilter(EXTERIOR, OPEN_TAG_FILTER)).toBe(true);
    expect(matchesTagFilter(SPARE, OPEN_TAG_FILTER)).toBe(true);
  });

  it('searches the name, ignoring case and the space around what was typed', () => {
    expect(matchesTagFilter(EXTERIOR, { ...OPEN_TAG_FILTER, search: ' EXT ' })).toBe(true);
    expect(matchesTagFilter(SPARE, { ...OPEN_TAG_FILTER, search: 'ext' })).toBe(false);
  });

  it('narrows by colour', () => {
    expect(matchesTagFilter(EXTERIOR, { ...OPEN_TAG_FILTER, color: 'green' })).toBe(true);
    expect(matchesTagFilter(SPARE, { ...OPEN_TAG_FILTER, color: 'green' })).toBe(false);
  });

  it('narrows by what carries the tag: devices, entities, or nothing at all', () => {
    expect(matchesTagFilter(EXTERIOR, { ...OPEN_TAG_FILTER, usage: 'devices' })).toBe(true);
    expect(matchesTagFilter(EXTERIOR, { ...OPEN_TAG_FILTER, usage: 'entities' })).toBe(false);
    expect(matchesTagFilter(EXTERIOR, { ...OPEN_TAG_FILTER, usage: 'unused' })).toBe(false);
    expect(matchesTagFilter(SPARE, { ...OPEN_TAG_FILTER, usage: 'unused' })).toBe(true);
  });
});

describe('isNarrowingTags', () => {
  it('says whether a facet is set, search aside', () => {
    expect(isNarrowingTags(OPEN_TAG_FILTER)).toBe(false);
    expect(isNarrowingTags({ ...OPEN_TAG_FILTER, search: 'x' })).toBe(false);
    expect(isNarrowingTags({ ...OPEN_TAG_FILTER, color: 'teal' })).toBe(true);
    expect(isNarrowingTags({ ...OPEN_TAG_FILTER, usage: 'unused' })).toBe(true);
  });
});
