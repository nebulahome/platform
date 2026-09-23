/**
 * Coloured formula tokens: variable words match source names and keep plain text for save.
 */
import { describe, expect, it } from 'vitest';

import { formulaSegments } from './alias-formula-field';

describe('formulaSegments', () => {
  it('paints matching variable words and leaves the rest plain', () => {
    const colors = new Map([
      ['t1', 'red' as const],
      ['t2', 'blue' as const],
    ]);

    expect(formulaSegments('(t1 + t2) / 3', colors)).toEqual([
      { text: '(', color: null },
      { text: 't1', color: 'red' },
      { text: ' + ', color: null },
      { text: 't2', color: 'blue' },
      { text: ') / 3', color: null },
    ]);
  });

  it('ignores names that are no longer sources', () => {
    const colors = new Map([['t1', 'red' as const]]);

    expect(formulaSegments('t1 + t2', colors)).toEqual([
      { text: 't1', color: 'red' },
      { text: ' + t2', color: null },
    ]);
  });
});
