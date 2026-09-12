/**
 * Turning a stored document into the line somebody reads.
 *
 * The cases here are the ones where a summary would otherwise mislead rather than merely read
 * badly: a rule with four triggers that claims to have one, a nested `and` counted as a single
 * check, and a solar trigger whose offset is dropped — which turns "half an hour before sunset"
 * into "at sunset" on a page somebody is using to decide whether the rule is the one misfiring.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type AutomationDefinition } from '@nebula-home/contracts';

import {
  countChecks,
  describeAction,
  describeAutomation,
  describeTrigger,
} from './describe-automation';

/**
 * An entity address, as the type system insists on having one.
 *
 * `entityId` is branded, so a string is not one until something has checked it. Parsing rather
 * than casting means a fixture with a typo fails here instead of describing something that could
 * never exist.
 *
 * @param value - The address.
 * @returns The same address, as an address.
 */
const entity = (value: string) => entityIdSchema.parse(value);

describe('describeTrigger', () => {
  it('reads an entity by its object rather than its address', () => {
    expect(
      describeTrigger({
        type: 'state',
        entityId: entity('binary_sensor.hallway_motion'),
        to: 'on',
      }),
    ).toBe('hallway motion becomes on');
  });

  it('says a state changed when no destination is named', () => {
    expect(describeTrigger({ type: 'state', entityId: entity('light.kitchen_ceiling') })).toBe(
      'kitchen ceiling changes',
    );
  });

  it('keeps a solar offset, which is the whole point of having one', () => {
    expect(
      describeTrigger({ type: 'time', at: { kind: 'solar', event: 'sunset', offsetMinutes: -30 } }),
    ).toBe('30 min before sunset');

    expect(
      describeTrigger({ type: 'time', at: { kind: 'solar', event: 'sunrise', offsetMinutes: 0 } }),
    ).toBe('at sunrise');
  });

  it('turns a comparison into a word', () => {
    expect(
      describeTrigger({
        type: 'numeric_state',
        entityId: entity('sensor.kitchen_temperature'),
        operator: 'gt',
        value: 22,
      }),
    ).toBe('kitchen temperature goes above 22');
  });
});

describe('describeAction', () => {
  it('names the capability and the thing', () => {
    expect(
      describeAction({
        type: 'command',
        entityId: entity('light.hallway_ceiling'),
        capability: 'on_off',
        params: {},
      }),
    ).toBe('on_off hallway ceiling');
  });

  it('reads a wait in seconds, because milliseconds are not how people say it', () => {
    expect(describeAction({ type: 'wait_duration', durationMs: 90_000 })).toBe('wait 90s');
  });

  it('counts what a parallel block holds', () => {
    expect(
      describeAction({
        type: 'parallel',
        actions: [
          { type: 'scene', sceneKey: 'good_night' },
          { type: 'notify', channel: 'push', message: 'done' },
        ],
      }),
    ).toBe('2 in parallel');
  });
});

describe('countChecks', () => {
  it('counts the leaves of a composed condition, not the node', () => {
    expect(
      countChecks({
        type: 'and',
        conditions: [
          { type: 'time_window', from: '22:00', to: '06:00' },
          {
            type: 'or',
            conditions: [
              { type: 'state', entityId: entity('person.mattia'), state: 'home' },
              { type: 'state', entityId: entity('person.giulia'), state: 'home' },
            ],
          },
        ],
      }),
    ).toBe(3);
  });

  it('sees through a negation', () => {
    expect(
      countChecks({
        type: 'not',
        condition: { type: 'state', entityId: entity('person.mattia'), state: 'home' },
      }),
    ).toBe(1);
  });
});

describe('describeAutomation', () => {
  /** A rule with more of everything than one line can hold. */
  const CROWDED: AutomationDefinition = {
    triggers: [
      { type: 'state', entityId: entity('binary_sensor.hallway_motion'), to: 'on' },
      { type: 'manual' },
      { type: 'time', at: { kind: 'clock', time: '18:00' } },
    ],
    conditions: [
      {
        type: 'and',
        conditions: [
          { type: 'time_window', from: '22:00', to: '06:00' },
          { type: 'day_of_week', days: ['saturday', 'sunday'] },
        ],
      },
    ],
    actions: [
      {
        type: 'command',
        entityId: entity('light.hallway_ceiling'),
        capability: 'on_off',
        params: {},
      },
      { type: 'wait_duration', durationMs: 5_000 },
    ],
  };

  it('says how much it is not showing', () => {
    const summary = describeAutomation(CROWDED);

    // The count matters more than the detail: somebody deciding whether to open a rule needs to
    // know there is more of it, and "+2" is that in two characters.
    expect(summary.trigger).toBe('hallway motion becomes on +2');
    expect(summary.actions).toBe('on_off hallway ceiling +1');
    expect(summary.conditions).toBe('2 conditions');
  });

  it('says nothing about conditions when there are none', () => {
    const summary = describeAutomation({ ...CROWDED, conditions: [] });

    // Null rather than "0 conditions": the row draws an arrow for each phrase it is given, and a
    // rule with no conditions should read as two steps, not three.
    expect(summary.conditions).toBeNull();
  });

  it('does not pluralise a single condition', () => {
    const summary = describeAutomation({
      ...CROWDED,
      conditions: [{ type: 'state', entityId: entity('person.mattia'), state: 'home' }],
    });

    expect(summary.conditions).toBe('1 condition');
  });

  it('survives a document with nothing in it', () => {
    const summary = describeAutomation({ triggers: [], conditions: [], actions: [] });

    expect(summary).toEqual({ trigger: 'no trigger', conditions: null, actions: 'no actions' });
  });
});
