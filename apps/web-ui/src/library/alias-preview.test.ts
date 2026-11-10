/**
 * The edit preview: a formula or a rule worked out over the inputs' readings, stepped together.
 */
import { describe, expect, it } from 'vitest';

import { combinedSeries, formulaSeries, type PreviewInput } from './alias-preview';

/**
 * An input's readings at given minutes.
 *
 * @param entityId - The input.
 * @param readings - Minute and value pairs.
 * @returns The input.
 */
function input(entityId: string, readings: readonly (readonly [number, number])[]): PreviewInput {
  return {
    entityId,
    points: readings.map(([minute, value]) => ({ time: new Date(minute * 60_000), value })),
  };
}

const KITCHEN = input('sensor.kitchen', [
  [0, 20],
  [10, 22],
]);
const HALL = input('sensor.hall', [
  [5, 18],
  [15, 16],
]);

describe('formulaSeries', () => {
  it('works the formula out once every input has reported', () => {
    expect(formulaSeries('avg(sensor.kitchen, sensor.hall)', [KITCHEN, HALL])).toEqual([
      { at: 5 * 60_000, value: 19 },
      { at: 10 * 60_000, value: 20 },
      { at: 15 * 60_000, value: 19 },
    ]);
  });

  it('draws nothing for a formula that makes no number', () => {
    expect(formulaSeries('sensor.kitchen > 21', [KITCHEN])).toEqual([]);
  });
});

describe('combinedSeries', () => {
  it('combines the inputs by the rule', () => {
    expect(combinedSeries('max', [KITCHEN, HALL]).map((point) => point.value)).toEqual([
      20, 22, 22,
    ]);
    expect(combinedSeries('sum', [KITCHEN, HALL]).at(-1)?.value).toBe(38);
    expect(combinedSeries('any', [KITCHEN, HALL])).toEqual([]);
  });
});
