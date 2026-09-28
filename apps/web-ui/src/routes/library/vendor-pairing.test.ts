import { describe, expect, it } from 'vitest';

import { timeLeft } from '@/routes/library/vendor-pairing';

describe('timeLeft', () => {
  it('reads the time left as a clock does, rounding a started second up', () => {
    expect(timeLeft(222_000)).toBe('3:42');
    expect(timeLeft(59_001)).toBe('1:00');
    expect(timeLeft(9_000)).toBe('0:09');
  });

  it('stops at nothing once the time is up', () => {
    expect(timeLeft(-5000)).toBe('0:00');
  });
});
