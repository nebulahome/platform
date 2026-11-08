/**
 * A band draws one block for each stretch of the same state: a lamp dimmed while on is still one
 * stretch of on, not two blocks side by side. A reading's line breaks where it went quiet for far
 * longer than it usually does.
 */
import { describe, expect, it } from 'vitest';

import type { StateSegment } from '@/library/history-series';
import { gapsOf, runsOf } from '@/routes/library/entity/sheet/charts';

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

describe('the gaps of a reading', () => {
  const minute = 60_000;
  const window = { from: 0, to: 6 * 60 * minute };

  it('breaks where nothing was read for far longer than usual', () => {
    const points = [0, 1, 2, 3, 40, 41, 42, 100, 101].map((at) => ({ at: at * minute, value: at }));

    expect(gapsOf(points, window)).toEqual([
      { from: 3 * minute, to: 40 * minute },
      { from: 42 * minute, to: 100 * minute },
    ]);
  });

  it('keeps a reading that came as often as it does whole, and one too short to say', () => {
    const steady = [0, 10, 20, 30, 40].map((at) => ({ at: at * minute, value: 1 }));

    expect(gapsOf(steady, window)).toEqual([]);
    expect(gapsOf([{ at: 0, value: 1 }], window)).toEqual([]);
  });

  it('does not call a moment a gap on a long window', () => {
    const month = { from: 0, to: 30 * 24 * 60 * minute };
    // Hourly, with three hours missing: less than a sixtieth of the month.
    const points = [0, 1, 2, 5, 6].map((hour) => ({ at: hour * 60 * minute, value: hour }));

    expect(gapsOf(points, month)).toEqual([]);
  });
});
