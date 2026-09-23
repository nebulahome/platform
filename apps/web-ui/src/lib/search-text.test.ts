/**
 * The one rule every search box follows.
 */
import { describe, expect, it } from 'vitest';

import { foldForSearch, matchesQuery, queryWords } from '@/lib/search-text';

describe('foldForSearch', () => {
  it('ignores case and accents', () => {
    expect(foldForSearch('  Città ')).toBe('citta');
    expect(foldForSearch('ÉTAGE')).toBe('etage');
  });
});

describe('queryWords', () => {
  it('splits on any run of spaces and drops blanks', () => {
    expect(queryWords('  workshop   printer ')).toEqual(['workshop', 'printer']);
    expect(queryWords('   ')).toEqual([]);
  });
});

describe('matchesQuery', () => {
  const fields = ['Workshop printer', 'Bambu Lab', null, 'Città'];

  it('matches everything on a blank query', () => {
    expect(matchesQuery(fields, '  ')).toBe(true);
  });

  it('finds every word, in any order, in any field', () => {
    expect(matchesQuery(fields, 'printer workshop')).toBe(true);
    expect(matchesQuery(fields, 'bambu citta')).toBe(true);
    expect(matchesQuery(fields, 'printer garage')).toBe(false);
  });

  it('never matches a word across the end of one field and the start of the next', () => {
    expect(matchesQuery(['Garage', 'Relay'], 'gerel')).toBe(false);
    expect(matchesQuery(['Garage', 'Relay'], 'garage relay')).toBe(true);
  });
});
