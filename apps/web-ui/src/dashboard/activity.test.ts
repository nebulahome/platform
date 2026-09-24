import { describe, expect, it } from 'vitest';

import { activityShares } from '@/dashboard/activity';

const HOUR = 3_600_000;

describe('activityShares', () => {
  it('measures how much of each slice was active', () => {
    const shares = activityShares(
      [
        { from: 0, to: HOUR / 2, isActive: true },
        { from: HOUR / 2, to: 2.5 * HOUR, isActive: false },
        { from: 2.5 * HOUR, to: 4 * HOUR, isActive: true },
      ],
      { from: 0, to: 4 * HOUR },
      4,
    );

    expect(shares).toEqual([0.5, 0, 0.5, 1]);
  });

  it('ignores what lies outside the window', () => {
    const shares = activityShares(
      [{ from: -HOUR, to: HOUR / 4, isActive: true }],
      { from: 0, to: HOUR },
      1,
    );

    expect(shares).toEqual([0.25]);
  });
});
