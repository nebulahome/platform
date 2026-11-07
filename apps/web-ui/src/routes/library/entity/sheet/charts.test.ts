/**
 * A band draws one block for each stretch of the same state: a lamp dimmed while on is still one
 * stretch of on, not two blocks side by side.
 */
import { describe, expect, it } from 'vitest';

import type { StateSegment } from '@/library/history-series';
import { runsOf } from '@/routes/library/entity/sheet/charts';

/**
 * A segment of the band.
 *
 * @param from - When it began.
 * @param to - When it ended.
 * @param isActive - Whether it was on.
 * @param isAvailable - Whether the device answered.
 * @returns The segment.
 */
function segment(from: number, to: number, isActive: boolean, isAvailable = true): StateSegment {
  return { from, to, label: '', isActive, isAvailable };
}

describe('the stretches of a band', () => {
  it('joins segments in a row that read the same, and keeps the others apart', () => {
    expect(
      runsOf([
        segment(0, 10, true),
        segment(10, 20, true),
        segment(20, 30, false),
        segment(30, 40, false, false),
        segment(40, 50, true),
      ]),
    ).toEqual([
      { from: 0, to: 20, isActive: true, isAvailable: true },
      { from: 20, to: 30, isActive: false, isAvailable: true },
      { from: 30, to: 40, isActive: false, isAvailable: false },
      { from: 40, to: 50, isActive: true, isAvailable: true },
    ]);
  });
});
