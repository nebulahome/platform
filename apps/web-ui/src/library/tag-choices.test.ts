import { describe, expect, it } from 'vitest';

import type { TagView } from '@nebulahome/contracts';

import { creatableTagName, filterTagChoices } from './tag-choices';

/**
 * A tag, for lists that vary one of them.
 *
 * @param id - Its id, and its name's stem.
 * @param name - What it is called.
 * @returns The tag.
 */
function tag(id: string, name: string): TagView {
  return { id, key: id, name, color: 'teal', icon: null, deviceCount: 0, entityCount: 0 };
}

const TAGS = [tag('a', 'Exterior'), tag('b', 'Energy monitored'), tag('c', 'Extra')];

describe('filterTagChoices', () => {
  it('offers every tag not already on the row when nothing is typed', () => {
    expect(filterTagChoices(TAGS, ['b'], '').map((each) => each.id)).toEqual(['a', 'c']);
  });

  it('narrows to the names containing what was typed, whatever the case', () => {
    expect(filterTagChoices(TAGS, [], 'ex').map((each) => each.id)).toEqual(['a', 'c']);
    expect(filterTagChoices(TAGS, [], 'MONIT').map((each) => each.id)).toEqual(['b']);
  });

  it('ignores the space around what was typed', () => {
    expect(filterTagChoices(TAGS, [], '  extra ').map((each) => each.id)).toEqual(['c']);
  });
});

describe('creatableTagName', () => {
  it('offers to make a tag from what was typed when no tag has that name', () => {
    expect(creatableTagName(TAGS, ' Garden ')).toBe('Garden');
  });

  it('offers nothing when a tag already has that name, whatever the case', () => {
    expect(creatableTagName(TAGS, 'exterior')).toBeNull();
    expect(creatableTagName(TAGS, 'EXTERIOR')).toBeNull();
  });

  it('offers nothing for a blank, or for a name longer than a tag may have', () => {
    expect(creatableTagName(TAGS, '   ')).toBeNull();
    expect(creatableTagName(TAGS, 'x'.repeat(65))).toBeNull();
    expect(creatableTagName(TAGS, 'x'.repeat(64))).toBe('x'.repeat(64));
  });
});
