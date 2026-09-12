/**
 * What an automation is allowed to say.
 *
 * This schema is the only thing standing between the `definition` column and whatever a client
 * sends, and until it existed there was nothing there at all. The cases below are the ones where
 * being wrong is expensive rather than merely wrong: a document that saves and then cannot be
 * executed, a recursion that never bottoms out, and a wait with no end - which is a run that
 * holds its slot forever under `single` mode and stops the automation working again.
 */
import { describe, expect, it } from 'vitest';

import {
  automationConditionSchema,
  automationDefinitionSchema,
  automationTriggerSchema,
} from './automation-definition.js';

/** The smallest document that means anything: one trigger, one action. */
const MINIMAL = {
  triggers: [{ type: 'state', entityId: 'binary_sensor.hallway_motion', to: 'on' }],
  actions: [
    { type: 'command', entityId: 'light.hallway_ceiling', capability: 'on_off', params: {} },
  ],
};

describe('automationDefinitionSchema', () => {
  it('accepts a trigger and an action, with no conditions', () => {
    const parsed = automationDefinitionSchema.parse(MINIMAL);

    // Conditions default to none rather than being required: "when this happens, do that" is a
    // complete thought and most automations in a house are exactly that.
    expect(parsed.conditions).toEqual([]);
  });

  it('refuses a document that can never fire', () => {
    expect(() => automationDefinitionSchema.parse({ ...MINIMAL, triggers: [] })).toThrow();
  });

  it('refuses a document that would do nothing', () => {
    expect(() => automationDefinitionSchema.parse({ ...MINIMAL, actions: [] })).toThrow();
  });

  it('carries conditions that nest', () => {
    const parsed = automationDefinitionSchema.parse({
      ...MINIMAL,
      conditions: [
        {
          type: 'and',
          conditions: [
            { type: 'time_window', from: '22:00', to: '06:30' },
            { type: 'not', condition: { type: 'state', entityId: 'person.mattia', state: 'home' } },
          ],
        },
      ],
    });

    expect(parsed.conditions).toHaveLength(1);
  });

  it('carries actions that nest', () => {
    const parsed = automationDefinitionSchema.parse({
      ...MINIMAL,
      actions: [
        {
          type: 'parallel',
          actions: [
            { type: 'scene', sceneKey: 'good_night' },
            { type: 'wait_duration', durationMs: 5_000 },
          ],
        },
      ],
    });

    expect(parsed.actions[0]?.type).toBe('parallel');
  });
});

describe('automationTriggerSchema', () => {
  it('takes a time of day, a cron expression or the sun', () => {
    expect(() =>
      automationTriggerSchema.parse({ type: 'time', at: { kind: 'clock', time: '07:15' } }),
    ).not.toThrow();

    expect(() =>
      automationTriggerSchema.parse({
        type: 'time',
        at: { kind: 'cron', expression: '0 7 * * 1-5' },
      }),
    ).not.toThrow();

    const solar = automationTriggerSchema.parse({
      type: 'time',
      at: { kind: 'solar', event: 'sunset' },
    });

    // No offset means the event itself, not an unset field the engine has to interpret.
    expect(solar).toMatchObject({ at: { offsetMinutes: 0 } });
  });

  it('refuses a time that is not one', () => {
    expect(() =>
      automationTriggerSchema.parse({ type: 'time', at: { kind: 'clock', time: '25:00' } }),
    ).toThrow();
  });

  it('refuses an entity address that is not one', () => {
    expect(() => automationTriggerSchema.parse({ type: 'state', entityId: 'hallway' })).toThrow();
  });

  it('accepts a manual trigger, which is how the UI runs one by hand', () => {
    expect(() => automationTriggerSchema.parse({ type: 'manual' })).not.toThrow();
  });
});

describe('automationConditionSchema', () => {
  it('needs at least one day when it names days', () => {
    expect(() => automationConditionSchema.parse({ type: 'day_of_week', days: [] })).toThrow();
  });

  it('needs at least one branch when it composes', () => {
    expect(() => automationConditionSchema.parse({ type: 'or', conditions: [] })).toThrow();
  });

  it('bounds a sandboxed expression', () => {
    expect(() =>
      automationConditionSchema.parse({ type: 'expression', expression: 'x'.repeat(2_001) }),
    ).toThrow();
  });
});

describe('waiting', () => {
  it('requires a timeout, so a run cannot wait forever', () => {
    expect(() =>
      automationDefinitionSchema.parse({
        ...MINIMAL,
        actions: [
          {
            type: 'wait_for',
            condition: { type: 'state', entityId: 'person.mattia', state: 'home' },
          },
        ],
      }),
    ).toThrow();
  });

  it('caps a wait at a week', () => {
    expect(() =>
      automationDefinitionSchema.parse({
        ...MINIMAL,
        actions: [{ type: 'wait_duration', durationMs: 604_800_001 }],
      }),
    ).toThrow();
  });
});
