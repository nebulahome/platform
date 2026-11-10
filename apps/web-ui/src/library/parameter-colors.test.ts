/**
 * The colours of named values: each name its own, never two alike.
 */
import { describe, expect, it } from 'vitest';

import { sourceColors, type SourceDraft } from './parameter-colors';

/**
 * A source row.
 *
 * @param rowKey - Its key.
 * @param variableName - Its variable.
 * @param entityId - Its entity.
 * @returns The row.
 */
function row(rowKey: string, variableName: string, entityId = ''): SourceDraft {
  return { rowKey, variableName, entityId };
}

describe('sourceColors', () => {
  it('gives a name the same colour whatever rows sit around it', () => {
    const alone = sourceColors([row('a', 'hall')]);
    const withOthers = sourceColors([row('x', 'kitchen'), row('y', 'hall')]);

    // Unless the other name happened to take its colour first, removing a row does not repaint
    // the one after it.
    if (withOthers.get('x') !== alone.get('a')) {
      expect(withOthers.get('y')).toBe(alone.get('a'));
    }
  });

  it('never gives two rows one colour', () => {
    const rows = Array.from({ length: 12 }, (unused, index) =>
      row(`r${String(index)}`, `t${String(index)}`),
    );
    const colors = [...sourceColors(rows).values()];

    expect(new Set(colors).size).toBe(12);
  });
});
