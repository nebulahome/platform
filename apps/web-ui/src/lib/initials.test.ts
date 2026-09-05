/**
 * The letters that stand in for a face.
 *
 * The cases that matter are the ones nobody thinks of when writing the function: a person
 * with one name, a name typed with stray spaces, a hyphen where a space would be, and no name
 * at all - which is what an avatar renders before the session has loaded.
 */
import { describe, expect, it } from 'vitest';

import { toInitials } from '@/lib/initials';

describe('toInitials', () => {
  it.each([
    ['Mattia Carli', 'MC'],
    ['Mattia', 'M'],
    ['  ada   lovelace  ', 'AL'],
    ['Jean-Luc Picard', 'JP'],
    ['', '?'],
  ])('turns %j into %j', (input, expected) => {
    expect(toInitials(input)).toBe(expected);
  });

  it('uses the first and last word, not the first two', () => {
    expect(toInitials('Ada King Lovelace')).toBe('AL');
  });
});
