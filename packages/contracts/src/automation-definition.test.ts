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
  booleanTreeSchema,
  entityIdsOfDefinition,
} from './automation-definition.js';

/** The smallest legacy document that means anything: one trigger, one action. */
const MINIMAL_LEGACY = {
  triggers: [{ type: 'state', entityId: 'binary_sensor.hallway_motion', to: 'on' }],
  actions: [
    {
      type: 'command',
      entityId: 'light.hallway_ceiling',
      capability: 'on_off',
      params: { command: 'turn_on' },
    },
  ],
};

/** The same rule in the saved shape. */
const MINIMAL = {
  triggers: { type: 'state', entityId: 'binary_sensor.hallway_motion', to: 'on' },
  then: [
    {
      type: 'command',
      entityId: 'light.hallway_ceiling',
      capability: 'on_off',
      params: { command: 'turn_on' },
    },
  ],
};

describe('automationDefinitionSchema', () => {
  it('accepts a trigger and an action, with no if', () => {
    const parsed = automationDefinitionSchema.parse(MINIMAL);

    // `if` is omitted rather than required: "when this happens, do that" is a complete thought.
    expect(parsed.if).toBeUndefined();
    expect(parsed.then).toHaveLength(1);
  });

  it('reads a legacy { triggers, conditions, actions } document', () => {
    const parsed = automationDefinitionSchema.parse({
      ...MINIMAL_LEGACY,
      conditions: [{ type: 'state', entityId: 'person.mattia', state: 'home' }],
    });

    // Flat triggers become a single leaf (OR of one); conditions become AND under `if`.
    expect(parsed.triggers).toEqual(MINIMAL.triggers);
    expect(parsed.if).toEqual({ type: 'state', entityId: 'person.mattia', state: 'home' });
    expect(parsed.then).toEqual(MINIMAL.then);
  });

  it('reads a flat legacy trigger list as OR', () => {
    const parsed = automationDefinitionSchema.parse({
      triggers: [
        { type: 'state', entityId: 'binary_sensor.hallway_motion', to: 'on' },
        { type: 'manual' },
      ],
      actions: MINIMAL_LEGACY.actions,
    });

    expect(parsed.triggers).toEqual({
      op: 'or',
      items: [
        { type: 'state', entityId: 'binary_sensor.hallway_motion', to: 'on' },
        { type: 'manual' },
      ],
    });
  });

  it('reads a flat legacy conditions list as AND under if', () => {
    const parsed = automationDefinitionSchema.parse({
      ...MINIMAL_LEGACY,
      conditions: [
        { type: 'time_window', from: '22:00', to: '06:30' },
        { type: 'state', entityId: 'person.mattia', state: 'home' },
      ],
    });

    expect(parsed.if).toEqual({
      op: 'and',
      items: [
        { type: 'time_window', from: '22:00', to: '06:30' },
        { type: 'state', entityId: 'person.mattia', state: 'home' },
      ],
    });
  });

  it('refuses a document that can never fire', () => {
    expect(() => automationDefinitionSchema.parse({ ...MINIMAL, triggers: [] })).toThrow();
  });

  it('refuses a document that would do nothing', () => {
    expect(() => automationDefinitionSchema.parse({ ...MINIMAL, then: [] })).toThrow();
  });

  it('carries an if tree that nests, including legacy type-style not', () => {
    const parsed = automationDefinitionSchema.parse({
      ...MINIMAL,
      if: {
        op: 'and',
        items: [
          { type: 'time_window', from: '22:00', to: '06:30' },
          { type: 'not', condition: { type: 'state', entityId: 'person.mattia', state: 'home' } },
        ],
      },
    });

    expect(parsed.if).toEqual({
      op: 'and',
      items: [
        { type: 'time_window', from: '22:00', to: '06:30' },
        { op: 'not', item: { type: 'state', entityId: 'person.mattia', state: 'home' } },
      ],
    });
  });

  it('carries then actions that nest, including the new block kinds', () => {
    const parsed = automationDefinitionSchema.parse({
      ...MINIMAL,
      then: [
        {
          type: 'sequence',
          actions: [
            { type: 'scene', sceneKey: 'good_night' },
            {
              type: 'if',
              condition: { type: 'state', entityId: 'person.mattia', state: 'home' },
              then: [{ type: 'notify', channel: 'push', message: 'home' }],
              else: [{ type: 'stop' }],
            },
            {
              type: 'for',
              over: { kind: 'count', count: 3 },
              actions: [{ type: 'wait_duration', durationMs: 1_000 }],
            },
            {
              type: 'switch',
              entityId: 'sensor.mode',
              cases: [{ value: 'away', actions: [{ type: 'scene', sceneKey: 'away' }] }],
              default: [{ type: 'stop' }],
            },
            {
              type: 'while',
              condition: { type: 'state', entityId: 'binary_sensor.busy', state: 'on' },
              actions: [{ type: 'wait_duration', durationMs: 500 }],
            },
            {
              type: 'do_while',
              condition: { type: 'state', entityId: 'binary_sensor.busy', state: 'on' },
              actions: [{ type: 'wait_duration', durationMs: 500 }],
            },
            {
              type: 'wait_for_trigger',
              trigger: { type: 'manual' },
              timeoutMs: 60_000,
            },
            {
              type: 'parallel',
              actions: [
                { type: 'scene', sceneKey: 'good_night' },
                { type: 'wait_duration', durationMs: 5_000 },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.then[0]?.type).toBe('sequence');
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

describe('booleanTreeSchema', () => {
  it('rewrites a legacy type-style not into op form', () => {
    expect(
      booleanTreeSchema.parse({
        type: 'not',
        condition: { type: 'state', entityId: 'person.mattia', state: 'home' },
      }),
    ).toEqual({
      op: 'not',
      item: { type: 'state', entityId: 'person.mattia', state: 'home' },
    });
  });

  it('keeps a non-state leaf rather than dropping it', () => {
    expect(booleanTreeSchema.parse({ type: 'time_window', from: '22:00', to: '06:00' })).toEqual({
      type: 'time_window',
      from: '22:00',
      to: '06:00',
    });
  });
});

describe('waiting', () => {
  it('requires a timeout, so a run cannot wait forever', () => {
    expect(() =>
      automationDefinitionSchema.parse({
        ...MINIMAL,
        then: [
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
        then: [{ type: 'wait_duration', durationMs: 604_800_001 }],
      }),
    ).toThrow();
  });
});

describe('entityIdsOfDefinition', () => {
  it('finds entities in triggers, the if tree and nested actions, each once', () => {
    const definition = automationDefinitionSchema.parse({
      triggers: {
        op: 'or',
        items: [
          { type: 'state', entityId: 'binary_sensor.door', to: 'on' },
          { type: 'numeric_state', entityId: 'sensor.lux', operator: 'lt', value: 10 },
        ],
      },
      if: {
        op: 'and',
        items: [
          { type: 'state', entityId: 'switch.away', state: 'off' },
          {
            op: 'not',
            item: { type: 'numeric', entityId: 'sensor.lux', operator: 'gt', value: 50 },
          },
        ],
      },
      then: [
        {
          type: 'if',
          condition: { type: 'state', entityId: 'binary_sensor.window', state: 'on' },
          then: [
            {
              type: 'command',
              entityId: 'light.hall',
              capability: 'on_off',
              params: { command: 'turn_on' },
            },
          ],
          else: [
            {
              type: 'switch',
              entityId: 'sensor.mode',
              cases: [
                {
                  value: 'eco',
                  actions: [
                    {
                      type: 'parallel',
                      actions: [
                        {
                          type: 'command',
                          entityId: 'light.porch',
                          capability: 'on_off',
                          params: { command: 'turn_off' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'wait_for_trigger',
          trigger: { type: 'state', entityId: 'binary_sensor.door', to: 'off' },
          timeoutMs: 1000,
        },
      ],
    });

    expect(entityIdsOfDefinition(definition)).toEqual([
      'binary_sensor.door',
      'sensor.lux',
      'switch.away',
      'binary_sensor.window',
      'light.hall',
      'sensor.mode',
      'light.porch',
    ]);
  });

  it('does not follow a scene or another automation called by key', () => {
    const definition = automationDefinitionSchema.parse({
      triggers: { type: 'manual' },
      then: [
        { type: 'scene', sceneKey: 'evening' },
        { type: 'automation', automationKey: 'porch' },
      ],
    });

    expect(entityIdsOfDefinition(definition)).toEqual([]);
  });
});

describe('what a block may ask for', () => {
  /**
   * A one-action document around an action.
   *
   * @param action - The action.
   * @returns Whether it parses.
   */
  const accepts = (action: unknown): boolean =>
    automationDefinitionSchema.safeParse({ triggers: { type: 'manual' }, then: [action] }).success;

  it('takes a command its capability takes, and refuses one it does not', () => {
    const command = { type: 'command', entityId: 'light.hall', capability: 'level' };

    expect(accepts({ ...command, params: { command: 'set_level', level: 60 } })).toBe(true);
    // An empty body is a run that fails every time it reaches the block.
    expect(accepts({ ...command, params: {} })).toBe(false);
    expect(accepts({ ...command, params: { command: 'set_level', level: 160 } })).toBe(false);
  });

  it('sets a stored number helper, the one command a sensor reading takes', () => {
    expect(
      accepts({
        type: 'command',
        entityId: 'sensor.grid_power_limit',
        capability: 'sensor_numeric',
        params: { command: 'set_value', value: 3000 },
      }),
    ).toBe(true);
  });

  it('refuses a command to a capability that only reports', () => {
    expect(
      accepts({
        type: 'command',
        entityId: 'sensor.lux',
        capability: 'sensor_numeric',
        params: { command: 'set' },
      }),
    ).toBe(false);
  });

  it("calls a package's own services, never the platform's", () => {
    const call = { type: 'package_service', params: {} };

    expect(accepts({ ...call, packageId: 'nvr', service: 'record' })).toBe(true);
    expect(accepts({ ...call, packageId: 'supervisor', service: 'compose_remove' })).toBe(false);
    expect(accepts({ ...call, packageId: 'core', service: 'sync_alias' })).toBe(false);
    expect(accepts({ ...call, packageId: 'nvr', service: 'settings' })).toBe(false);
  });
});

describe('expression variables', () => {
  it('names entities the way an alias names its sources', () => {
    const parsed = booleanTreeSchema.parse({
      type: 'expression',
      expression: 'power > 2 * avg_power',
      variables: { power: 'sensor.house_power', avg_power: 'sensor.avg_power' },
    });

    expect(parsed).toMatchObject({ variables: { power: 'sensor.house_power' } });
  });

  it('refuses a name the language already means something by', () => {
    expect(
      booleanTreeSchema.safeParse({
        type: 'expression',
        expression: 'true',
        variables: { true: 'sensor.house_power' },
      }).success,
    ).toBe(false);
  });
});
