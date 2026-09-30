import { describe, expect, it } from 'vitest';

import { pairingOf, timeLeft } from '@/routes/library/vendor-pairing';

describe('pairingOf', () => {
  it('reads pairing open from the sensor, and when it closes from its attribute', () => {
    expect(
      pairingOf({ sensor_text: { value: 'enabled' } }, { endsAt: '2026-09-30T20:04:14.000Z' }),
    ).toEqual({ isOpen: true, closesAt: Date.parse('2026-09-30T20:04:14.000Z') });
  });

  it('counts nothing down when the bridge did not say, or when pairing is shut', () => {
    expect(pairingOf({ sensor_text: { value: 'enabled' } }, {})).toEqual({
      isOpen: true,
      closesAt: null,
    });
    expect(
      pairingOf({ sensor_text: { value: 'disabled' } }, { endsAt: '2026-09-30T20:04:14.000Z' }),
    ).toEqual({ isOpen: false, closesAt: null });
    expect(pairingOf(null, null)).toEqual({ isOpen: false, closesAt: null });
  });
});

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
