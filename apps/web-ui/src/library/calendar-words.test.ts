import { describe, expect, it } from 'vitest';

import { dayOfEvent, daysOf, endOf, startOf, untilStart } from '@/library/calendar-words';

const ROME = 'Europe/Rome';

/** Thursday 3 December 2026, 18:42 in Rome. */
const NOW = Date.parse('2026-12-03T17:42:00Z');

/** Aunt Carla, Wednesday 2 to Saturday 5, all day. */
const GUEST = {
  isAllDay: true,
  startsOn: '2026-12-02',
  endsOn: '2026-12-05',
  startsAt: null,
  endsAt: null,
};

/** Yoga tonight, 19:30 to 20:45 in Rome. */
const YOGA = {
  isAllDay: false,
  startsOn: null,
  endsOn: null,
  startsAt: '2026-12-03T18:30:00Z',
  endsAt: '2026-12-03T19:45:00Z',
};

describe('an event as a calendar entity tells it', () => {
  it('starts an all-day event at the house’s midnight and ends it after its last day', () => {
    expect(new Date(startOf(GUEST, ROME)).toISOString()).toBe('2026-12-01T23:00:00.000Z');
    expect(new Date(endOf(GUEST, ROME)).toISOString()).toBe('2026-12-05T23:00:00.000Z');
  });

  it('says which of its days today is, for one that runs over several', () => {
    expect(dayOfEvent(GUEST, NOW, ROME)).toEqual({ day: 2, of: 4 });
    expect(dayOfEvent(YOGA, NOW, ROME)).toBeNull();
  });

  it('keeps a timed event that ends at midnight on its own day', () => {
    const late = { ...YOGA, startsAt: '2026-12-03T21:00:00Z', endsAt: '2026-12-03T23:00:00Z' };

    expect(daysOf(late, ROME)).toEqual({ first: '2026-12-03', last: '2026-12-03' });
  });

  it('counts down to a timed event within the day, never to an all-day one', () => {
    expect(untilStart(YOGA, NOW, ROME)).toBe('48 min');
    expect(untilStart(GUEST, NOW, ROME)).toBeNull();
  });
});
