import { describe, expect, it } from 'vitest';

import type { QuietTime } from './backup.js';
import { quietTimeAttributes, quietTimeFromState } from './quiet-time.js';

const LEARNED: QuietTime = {
  state: 'ready',
  time: '03:15',
  quietFrom: '01:00',
  quietTo: '05:30',
  daysOfData: 12,
  daysNeeded: 3,
  profile: [1, null, 2],
  reason: null,
  timezone: 'Europe/Rome',
};

describe('quiet time entity', () => {
  it('reads back what was reported', () => {
    const state = { sensor_text: { value: LEARNED.time } };

    expect(quietTimeFromState(state, quietTimeAttributes(LEARNED))).toEqual(LEARNED);
  });

  it('keeps the time out of the attributes', () => {
    expect(quietTimeAttributes(LEARNED)).not.toHaveProperty('time');
  });

  it('refuses a state that is not a time', () => {
    expect(quietTimeFromState({ sensor_text: { value: 'soon' } }, {})).toBeNull();
    expect(quietTimeFromState(null, null)).toBeNull();
  });
});
