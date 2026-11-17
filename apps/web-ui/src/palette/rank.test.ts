import { describe, expect, it } from 'vitest';

import { queryWords } from '@/lib/search-text';
import type { PaletteItem } from '@/palette/palette-types';
import { groupResults, rankItems, ROWS_PER_GROUP, scoreItem } from '@/palette/rank';
import { makeItem } from '@/palette/sources/make-item';

/**
 * An item with only what ranking reads.
 *
 * @param title - Its title.
 * @param more - What else differs.
 * @returns The item.
 */
function anItem(title: string, more: Partial<Parameters<typeof makeItem>[0]> = {}): PaletteItem {
  return makeItem({
    group: 'entities',
    refId: title,
    title,
    secondary: '',
    icon: { kind: 'ui', id: 'zap' },
    primary: { hint: 'Open', command: { type: 'go', to: '/' } },
    ...more,
  });
}

/**
 * The titles found for a query, best first.
 *
 * @param items - The items.
 * @param query - As typed.
 * @returns Their titles.
 */
function found(items: readonly PaletteItem[], query: string): string[] {
  return rankItems(items, queryWords(query), new Set()).map(({ item }) => item.title);
}

describe('scoreItem', () => {
  it('puts an exact name over a prefix, a word prefix, a contained match and a field match', () => {
    const items = [
      anItem('Garden lights', { secondary: 'light strip' }),
      anItem('Spotlight'),
      anItem('Island light'),
      anItem('Light level'),
      anItem('Light'),
      anItem('Porch', { fields: ['light'] }),
    ];

    expect(found(items, 'light')).toEqual([
      'Light',
      'Light level',
      'Garden lights',
      'Island light',
      'Spotlight',
      'Porch',
    ]);
  });

  it('ignores accents and case, and takes the words in any order', () => {
    const item = anItem('Luce del soggiorno');

    expect(scoreItem(item, queryWords('SÒGGIORNO luce'))).toBeGreaterThan(0);
  });

  it('finds an item by an alias', () => {
    expect(found([anItem('Island lights', { fields: ['bancone'] })], 'bancone')).toEqual([
      'Island lights',
    ]);
  });

  it('leaves out an item a word is not found in', () => {
    expect(scoreItem(anItem('Island lights'), queryWords('island garage'))).toBeLessThan(0);
  });

  it('finds an id only whole, and puts it first', () => {
    const uuid = '0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7e0';
    const items = [anItem(uuid), anItem('Evening lights', { exactIds: [uuid] })];

    expect(found(items, uuid)[0]).toBe('Evening lights');
    expect(found([anItem('Evening lights', { exactIds: [uuid] })], '7d1e')).toEqual([]);
  });

  it('offers a verb row only when the query starts with its verb', () => {
    const items = [
      anItem('Add device · Shelly', { requiresVerb: true }),
      anItem('Aggiungi dispositivo · Shelly', { requiresVerb: true }),
    ];

    expect(found(items, 'add shelly')).toEqual(['Add device · Shelly']);
    expect(found(items, 'aggiungi shelly')).toEqual(['Aggiungi dispositivo · Shelly']);
    expect(found(items, 'shelly')).toEqual([]);
  });

  it('puts a recent item first in a tie, and one that is off last', () => {
    const items = [
      anItem('Lights off', { isDimmed: true }),
      anItem('Lights on'),
      anItem('Lights dim'),
    ];
    const ranked = rankItems(items, queryWords('lights'), new Set([items[2]?.id ?? '']));

    expect(ranked.map(({ item }) => item.title)).toEqual(['Lights dim', 'Lights on', 'Lights off']);
  });
});

describe('groupResults', () => {
  it('orders the groups by their best row, a tie by the fixed order of the kinds', () => {
    const items = [
      anItem('Hallway light', { group: 'entities' }),
      anItem('Light', { group: 'scenes' }),
      anItem('Hallway lamp', { group: 'devices' }),
    ];
    const sections = groupResults(rankItems(items, queryWords('ha'), new Set()), null);

    expect(sections.map((section) => section.id)).toEqual(['entities', 'devices']);
    expect(groupResults(rankItems(items, queryWords('light'), new Set()), null)[0]?.id).toBe(
      'scenes',
    );
  });

  it('cuts a group to a few rows until it is asked for in full', () => {
    const items = Array.from({ length: 12 }, (slot, index) => anItem(`Light ${String(index)}`));
    const ranked = rankItems(items, queryWords('light'), new Set());

    expect(groupResults(ranked, null)[0]?.items).toHaveLength(ROWS_PER_GROUP);
    expect(groupResults(ranked, null)[0]?.total).toBe(12);
    expect(groupResults(ranked, 'entities')[0]?.items).toHaveLength(12);
  });
});
