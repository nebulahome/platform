import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { markMatch } from '@/lib/mark-match';

/**
 * The marked parts of a title, as rendered.
 *
 * @param title - The title.
 * @param words - What to mark.
 * @returns The text of each mark.
 */
function marksOf(title: string, words: readonly string[]): string[] {
  const { container } = render(<p>{markMatch(title, words, 'm')}</p>);

  return [...container.querySelectorAll('mark')].map((mark) => mark.textContent);
}

describe('markMatch', () => {
  it('marks each word where it is first found, ignoring accents and case', () => {
    expect(marksOf('Caffè in Kitchen', ['caffe', 'kitchen'])).toEqual(['Caffè', 'Kitchen']);
  });

  it('joins overlapping words into one mark', () => {
    expect(marksOf('Garden lights', ['light', 'lights'])).toEqual(['lights']);
  });

  it('leaves a title with no match, or only blank words, unmarked', () => {
    expect(marksOf('Hallway', ['kitchen', ''])).toEqual([]);
  });
});
