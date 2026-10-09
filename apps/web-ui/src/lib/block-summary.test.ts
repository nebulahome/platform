import { describe, expect, it } from 'vitest';

import { entityIdSchema } from '@nebulahome/contracts';

import {
  actionSummary,
  conditionSummary,
  daysPhrase,
  triggerSummary,
  type BlockNames,
} from './block-summary';
import { runMoment } from './format-time';

const lux = entityIdSchema.parse('sensor.living_room_lux');
const motion = entityIdSchema.parse('binary_sensor.living_room_motion');

/** A house that names two entities and a room. */
const NAMES: BlockNames = {
  entity: (entityId) => ({ [lux]: 'Living room lux', [motion]: 'Living room motion' })[entityId],
  area: (areaKey) => (areaKey === 'living_room' ? 'Living room' : undefined),
  stateWord: (entityId, token) => (entityId === motion && token === 'on' ? 'Detected' : undefined),
};

describe('the sentence a closed block reads', () => {
  it('says what a trigger waits for, with the names of the house', () => {
    expect(triggerSummary({ type: 'state', entityId: motion, to: 'on' }, NAMES)).toBe(
      'Living room motion turns on',
    );
    expect(
      triggerSummary({ type: 'time', at: { kind: 'solar', event: 'sunrise', offsetMinutes: 20 } }),
    ).toBe('Sunrise, 20 min after');
    expect(triggerSummary({ type: 'time', at: { kind: 'clock', time: '07:00' } })).toBe(
      'Every day at 07:00',
    );
  });

  it('says what a check checks, negated the way a person would say it', () => {
    expect(conditionSummary({ type: 'state', entityId: motion, state: 'on' }, NAMES)).toBe(
      'Living room motion is detected',
    );
    expect(conditionSummary({ type: 'time_window', from: '22:00', to: '06:30' })).toBe(
      '22:00 → 06:30 (crosses midnight)',
    );
    expect(
      conditionSummary(
        { type: 'not', condition: { type: 'day_of_week', days: ['saturday', 'sunday'] } },
        NAMES,
      ),
    ).toBe('Not on Saturday or Sunday');
    expect(
      conditionSummary(
        {
          type: 'not',
          condition: { type: 'area_occupancy', areaKey: 'living_room', isOccupied: true },
        },
        NAMES,
      ),
    ).toBe('Nobody is in the Living room');
  });

  it('says what an action does', () => {
    expect(
      actionSummary(
        {
          type: 'if',
          condition: { type: 'numeric', entityId: lux, operator: 'lt', value: 50 },
          then: [{ type: 'stop' }],
          else: [],
        },
        NAMES,
      ),
    ).toBe('If Living room lux below 50 · 1 then · 0 else');
    expect(actionSummary({ type: 'wait_duration', durationMs: 600_000 })).toBe('10 min');
  });

  it('names days as few words as say them', () => {
    expect(daysPhrase(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])).toBe('Weekdays');
    expect(daysPhrase(['monday', 'wednesday', 'friday'])).toBe('Mon, Wed, Fri');
  });
});

describe('runMoment', () => {
  const now = new Date(2026, 9, 9, 18, 0);

  it('gives the time today, yesterday, a weekday, then a date', () => {
    expect(runMoment(new Date(2026, 9, 9, 8, 14), now)).toMatch(/08[:.]14/u);
    expect(runMoment(new Date(2026, 9, 8, 23, 0), now)).toBe('yesterday');
    expect(runMoment(new Date(2026, 9, 5, 12, 0), now)).toBe('Monday');
    expect(runMoment(new Date(2026, 8, 3, 12, 0), now)).toBe('3 Sept');
  });
});
