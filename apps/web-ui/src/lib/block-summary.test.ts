import { afterEach, describe, expect, it } from 'vitest';

import { entityIdSchema } from '@nebulahome/contracts';

import { dateTimeFormat } from '@/i18n/formatters';
import { applyLanguage } from '@/i18n/language';

import {
  actionSummary,
  commandPhrase,
  conditionSummary,
  daysPhrase,
  monthsPhrase,
  triggerSummary,
  type BlockNames,
} from './block-summary';
import { runMoment } from './format-time';

const lux = entityIdSchema.parse('sensor.living_room_lux');
const motion = entityIdSchema.parse('binary_sensor.living_room_motion');

/** A house that names two entities. */
const NAMES: BlockNames = {
  entity: (entityId) => ({ [lux]: 'Living room lux', [motion]: 'Living room motion' })[entityId],
  stateWord: (entityId, token) => (entityId === motion && token === 'on' ? 'Detected' : undefined),
};

describe('the sentence a closed block reads', () => {
  it('says what a trigger waits for, with the names of the house', () => {
    expect(
      triggerSummary(
        { type: 'entity', entityId: motion, change: { kind: 'state', to: 'on' } },
        NAMES,
      ),
    ).toBe('Living room motion turns on');
    expect(
      triggerSummary(
        {
          type: 'entity',
          entityId: lux,
          change: { kind: 'numeric', operator: 'lt', value: 50 },
          forMs: 120_000,
        },
        NAMES,
      ),
    ).toBe('Living room lux drops below 50 for 2 min');
    expect(triggerSummary({ type: 'sun', event: 'sunrise', offsetMinutes: 20 })).toBe(
      'Sunrise, 20 min after',
    );
    expect(triggerSummary({ type: 'sun', event: 'golden_hour_start', period: 'evening' })).toBe(
      'Golden hour started (evening)',
    );
    expect(
      triggerSummary({
        type: 'sun',
        event: 'elevation_crossed',
        elevation: -4,
        direction: 'setting',
      }),
    ).toBe('Sun crosses -4° setting');
    expect(triggerSummary({ type: 'time', at: { kind: 'clock', time: '07:00' } })).toBe(
      'Every day at 07:00',
    );
    expect(
      triggerSummary({
        type: 'time',
        at: { kind: 'clock', time: '07:30:15', weekdays: ['saturday', 'sunday'], months: ['june'] },
      }),
    ).toBe('Weekends at 07:30:15 in June');
  });

  it('says what a condition checks, negated the way a person would say it', () => {
    expect(
      conditionSummary(
        { type: 'entity', entityId: motion, match: { kind: 'state', states: ['on'] } },
        NAMES,
      ),
    ).toBe('Living room motion is detected');
    expect(
      conditionSummary(
        {
          type: 'entity',
          entityId: lux,
          isNot: true,
          match: { kind: 'numeric', operator: 'lt', value: 50 },
        },
        NAMES,
      ),
    ).toBe('Living room lux not below 50');
    expect(conditionSummary({ type: 'time', from: '22:00', to: '06:30' })).toBe(
      '22:00 → 06:30 (crosses midnight)',
    );
    expect(conditionSummary({ type: 'time', from: '18:00' })).toBe('From 18:00');
    expect(
      conditionSummary({ type: 'time', days: ['saturday', 'sunday'], isNot: true }, NAMES),
    ).toBe('Not on Saturday or Sunday');
    expect(conditionSummary({ type: 'sun', phase: 'above', elevation: 10 })).toBe('Sun above 10°');
    expect(conditionSummary({ type: 'sun', phase: 'night', isNot: true })).toBe('Not night');
  });

  it('counts what a group holds, and says AND and OR in words', () => {
    const leaf = { type: 'time', from: '08:00' } as const;

    expect(conditionSummary({ type: 'and', conditions: [leaf, leaf] })).toBe('All of 2 conditions');
    expect(conditionSummary({ type: 'or', conditions: [leaf], isNot: true })).toBe(
      'None of 1 condition',
    );
  });

  it('says what an action does', () => {
    expect(
      actionSummary(
        {
          type: 'if',
          conditions: [
            {
              type: 'entity',
              entityId: lux,
              match: { kind: 'numeric', operator: 'lt', value: 50 },
            },
          ],
          then: [{ type: 'stop' }],
          else: [],
        },
        NAMES,
      ),
    ).toBe('If Living room lux below 50 · 1 then · 0 else');
    expect(actionSummary({ type: 'if', conditions: [], then: [] })).toBe(
      'Always · 0 then · no else',
    );
    expect(actionSummary({ type: 'while', conditions: [], actions: [] })).toBe(
      'While … - add a condition',
    );
    expect(actionSummary({ type: 'parallel', branches: [[{ type: 'stop' }], []] })).toBe(
      '2 branches · 1 block',
    );
    expect(actionSummary({ type: 'wait_duration', durationMs: 600_000 })).toBe('10 min');
  });

  it('writes a colour as HEX and a white in kelvin', () => {
    expect(commandPhrase({ command: 'set_color', hue: 0, saturation: 100 })).toBe('colour #FF0000');
    expect(commandPhrase({ command: 'set_color_temp', mireds: 370 })).toBe('white 2700 K');
    expect(commandPhrase({ command: 'turn_on', transitionMs: 2_000 })).toBe('turn on over 2 s');
  });

  it('names days and months in as few words as say them', () => {
    expect(daysPhrase(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])).toBe('Weekdays');
    expect(daysPhrase(['monday', 'wednesday', 'friday'])).toBe('Mon, Wed, Fri');
    expect(monthsPhrase(['june', 'july', 'august'])).toBe('Jun–Aug');
    expect(monthsPhrase(['january', 'march'])).toBe('Jan, Mar');
    expect(monthsPhrase([])).toBe('');
  });
});

describe('the sentences in Italian', () => {
  afterEach(async () => {
    await applyLanguage('en');
  });

  it('says them in the order Italian puts its words, with Italian days and months', async () => {
    await applyLanguage('it');

    expect(
      triggerSummary(
        { type: 'entity', entityId: motion, change: { kind: 'state', to: 'on' } },
        NAMES,
      ),
    ).toBe('Living room motion si accende');
    expect(triggerSummary({ type: 'sun', event: 'sunrise', offsetMinutes: 20 })).toBe(
      'Alba, 20 min dopo',
    );
    expect(conditionSummary({ type: 'sun', phase: 'night', isNot: true })).toBe('Non notte');
    expect(daysPhrase(['monday', 'wednesday', 'friday'])).toBe('Lun, Mer, Ven');
    expect(monthsPhrase(['june', 'july', 'august'])).toBe('Giu–Ago');
    expect(actionSummary({ type: 'if', conditions: [], then: [] })).toBe(
      'Sempre · 0 allora · nessun altrimenti',
    );
  });
});

describe('runMoment', () => {
  const now = new Date(2026, 9, 9, 18, 0);

  it('gives the time today, yesterday, a weekday, then a date', () => {
    expect(runMoment(new Date(2026, 9, 9, 8, 14), now)).toMatch(/08[:.]14/u);
    expect(runMoment(new Date(2026, 9, 8, 23, 0), now)).toBe('yesterday');
    expect(runMoment(new Date(2026, 9, 5, 12, 0), now)).toBe('Monday');
    // A date in the reader's language and region: "Sep 3" in jsdom's American English.
    expect(runMoment(new Date(2026, 8, 3, 12, 0), now)).toBe(
      dateTimeFormat({ day: 'numeric', month: 'short' }).format(new Date(2026, 8, 3, 12, 0)),
    );
  });
});
