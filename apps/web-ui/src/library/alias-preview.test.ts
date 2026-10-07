import { describe, expect, it } from 'vitest';

import { previewRange, previewSeries } from '@/library/alias-preview';

/**
 * A reading at an hour of the day.
 *
 * @param hour - The hour.
 * @param value - The reading.
 * @returns The point.
 */
function at(hour: number, value: number) {
  return { time: new Date(Date.UTC(2026, 9, 7, hour)), value };
}

describe('previewSeries', () => {
  it('works the formula out with the latest reading of every source', () => {
    const series = previewSeries('(t1 + t2) / 2', [
      { variableName: 't1', points: [at(1, 20), at(2, 22), at(3, 24)] },
      { variableName: 't2', points: [at(2, 18), at(4, 20)] },
    ]);

    // Nothing at 01:00: t2 had not reported yet. At 04:00 t1 still reads 24.
    expect(series.map((point) => point.value)).toEqual([20, 21, 22]);
    expect(series[0]?.at).toBe(Date.UTC(2026, 9, 7, 2));
  });

  it('draws nothing for a formula that does not give a number', () => {
    expect(previewSeries('t1 > 20', [{ variableName: 't1', points: [at(1, 21)] }])).toEqual([]);
  });

  it('draws nothing while a source has no history', () => {
    expect(
      previewSeries('t1 + t2', [
        { variableName: 't1', points: [at(1, 21)] },
        { variableName: 't2', points: [] },
      ]),
    ).toEqual([]);
  });
});

describe('previewRange', () => {
  it('says the lowest and highest point, and nothing for an empty preview', () => {
    expect(
      previewRange([
        { at: 1, value: 3 },
        { at: 2, value: -1 },
      ]),
    ).toEqual({ min: -1, max: 3 });
    expect(previewRange([])).toBeNull();
  });
});
