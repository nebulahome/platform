/**
 * The figures over an entity's history: a reading's lowest counting each bucket's own lowest, a
 * switch's time on, and how often it turned on inside the window.
 */
import { describe, expect, it } from 'vitest';

import { activeStats, durationText, numericStats } from './history-stats';

describe('history figures', () => {
  it('takes a bucket’s own lowest and highest, not only its average', () => {
    expect(
      numericStats([
        { time: new Date(0), value: 19, min: 18.6, max: 19.4 },
        { time: new Date(1), value: 21, min: 20, max: 22.5 },
      ]),
    ).toEqual({ now: 21, low: 18.6, average: 20, high: 22.5 });
    expect(numericStats([])).toBeNull();
  });

  it('adds up the time on, and counts only the turns on inside the window', () => {
    const stats = activeStats([
      { from: 0, to: 60_000, label: 'On', isActive: true, isAvailable: true },
      { from: 60_000, to: 120_000, label: 'Off', isActive: false, isAvailable: true },
      { from: 120_000, to: 300_000, label: 'On', isActive: true, isAvailable: true },
    ]);

    expect(stats).toEqual({
      activeMs: 240_000,
      turnedOn: 1,
      lastOnAt: 120_000,
      longestMs: 180_000,
    });
  });

  it('says a stretch in short words', () => {
    expect(durationText(40_000)).toBe('40 s');
    expect(durationText(18 * 60_000)).toBe('18 min');
    expect(durationText((5 * 60 + 40) * 60_000)).toBe('5 h 40 min');
  });
});
