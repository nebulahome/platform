/**
 * Turning a stored document into the line somebody reads.
 *
 * The cases here are the ones where a summary would otherwise mislead rather than merely read
 * badly: a rule with four triggers that claims to have one, a nested `and` counted as a single
 * check, and a solar trigger whose offset is dropped — which turns "half an hour before sunset"
 * into "at sunset" on a page somebody is using to decide whether the rule is the one misfiring.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type AutomationDefinition } from '@nebulahome/contracts';

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
  it('reads an entity by its object rather than its address, when it has no name', () => {
    expect(
      describeTrigger({
        type: 'state',
        entityId: entity('binary_sensor.hallway_motion'),
        to: 'on',
      }),
    ).toBe('Hallway motion turns on');
  });

  it('uses the name the house gives it', () => {
    expect(
      describeTrigger(
        {
          type: 'state',
          entityId: entity('binary_sensor.hallway_motion'),
          to: 'on',
          forMs: 120_000,
        },
        { entity: () => 'Front hall motion' },
      ),
    ).toBe('Front hall motion turns on for 2 min');
  });

  it('says a state changed when no destination is named', () => {
    expect(describeTrigger({ type: 'state', entityId: entity('light.kitchen_ceiling') })).toBe(
      'Kitchen ceiling changes',
    );
  });

  it('keeps a solar offset, which is the whole point of having one', () => {
    expect(
      describeTrigger({ type: 'time', at: { kind: 'solar', event: 'sunset', offsetMinutes: -30 } }),
    ).toBe('Sunset, 30 min before');

    expect(
      describeTrigger({ type: 'time', at: { kind: 'solar', event: 'sunrise', offsetMinutes: 0 } }),
    ).toBe('Sunrise');
  });

  it('turns a comparison into a word', () => {
    expect(
      describeTrigger({
        type: 'numeric_state',
        entityId: entity('sensor.kitchen_temperature'),
        operator: 'gt',
        value: 22,
      }),
    ).toBe('Kitchen temperature rises above 22');
  });
});

describe('describeAction', () => {
  it('names the thing and what it is told', () => {
    expect(
      describeAction({
        type: 'command',
        entityId: entity('light.hallway_ceiling'),
        capability: 'level',
        params: { command: 'set_level', level: 60, transitionMs: 2_000 },
      }),
    ).toBe('Hallway ceiling · level 60% over 2 s');
  });

  it('reads a wait the way people say one, not in milliseconds', () => {
    expect(describeAction({ type: 'wait_duration', durationMs: 90_000 })).toBe('1 min 30 s');
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
    ).toBe('2 branches side by side');
  });
});

describe('countChecks', () => {
  it('counts the leaves of a composed condition, not the node', () => {
    expect(
      countChecks({
        op: 'and',
        items: [
          { type: 'time_window', from: '22:00', to: '06:00' },
          {
            op: 'or',
            items: [
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
        op: 'not',
        item: { type: 'state', entityId: entity('person.mattia'), state: 'home' },
      }),
    ).toBe(1);
  });

  it('still counts a draft-style type:and tree', () => {
    expect(
      countChecks({
        type: 'and',
        conditions: [
          { type: 'time_window', from: '22:00', to: '06:00' },
          { type: 'day_of_week', days: ['saturday'] },
        ],
      }),
    ).toBe(2);
  });
});

describe('describeAutomation', () => {
  /** A rule with more of everything than one line can hold. */
  const CROWDED: AutomationDefinition = {
    triggers: {
      op: 'or',
      items: [
        { type: 'state', entityId: entity('binary_sensor.hallway_motion'), to: 'on' },
        { type: 'manual' },
        { type: 'time', at: { kind: 'clock', time: '18:00' } },
      ],
    },
    if: {
      op: 'and',
      items: [
        { type: 'time_window', from: '22:00', to: '06:00' },
        { type: 'day_of_week', days: ['saturday', 'sunday'] },
      ],
    },
    then: [
      {
        type: 'command',
        entityId: entity('light.hallway_ceiling'),
        capability: 'on_off',
        params: { command: 'turn_on' },
      },
      { type: 'wait_duration', durationMs: 5_000 },
    ],
  };

  it('says how much it is not showing', () => {
    const summary = describeAutomation(CROWDED);

    // The count matters more than the detail: somebody deciding whether to open a rule needs to
    // know there is more of it, and "+2" is that in two characters.
    expect(summary.trigger).toBe('Hallway motion turns on +2');
    expect(summary.actions).toBe('Hallway ceiling · turn on +1');
    expect(summary.conditions).toBe('2 conditions');
  });

  it('says nothing about conditions when there are none', () => {
    const summary = describeAutomation({ ...CROWDED, if: undefined });

    // Null rather than "0 conditions": the row draws an arrow for each phrase it is given, and a
    // rule with no conditions should read as two steps, not three.
    expect(summary.conditions).toBeNull();
  });

  it('does not pluralise a single condition', () => {
    const summary = describeAutomation({
      ...CROWDED,
      if: { type: 'state', entityId: entity('person.mattia'), state: 'home' },
    });

    expect(summary.conditions).toBe('1 condition');
  });

  it('survives a document with nothing in it', () => {
    const summary = describeAutomation({
      triggers: { op: 'or', items: [] },
      then: [],
    });

    expect(summary).toEqual({ trigger: 'no trigger', conditions: null, actions: 'no actions' });
  });
});
