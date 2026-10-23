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
  automationDefinitionSchema,
  automationTriggerSchema,
  clockAtToCron,
  conditionNodeSchema,
  entityIdsOfDefinition,
  forEachBlock,
  renameEntities,
  isBlockEnabled,
} from './automation-definition.js';

/** The smallest document that means anything: one trigger, one action. */
const MINIMAL = {
  triggers: [
    {
      type: 'entity',
      entityId: 'binary_sensor.hallway_motion',
      change: { kind: 'state', to: 'on' },
    },
  ],
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

  it('gives a current document back unchanged', () => {
    const document = {
      ...MINIMAL,
      if: [
        { type: 'time', from: '22:00', to: '06:30', days: ['friday', 'saturday'] },
        {
          type: 'or',
          isNot: true,
          conditions: [
            {
              type: 'entity',
              entityId: 'person.mattia',
              match: { kind: 'state', states: ['home'] },
            },
            { type: 'sun', phase: 'below', elevation: 5, name: 'Dark enough' },
          ],
        },
      ],
    };

    expect(automationDefinitionSchema.parse(document)).toEqual(document);
  });

  it('refuses a document that can never fire', () => {
    expect(() => automationDefinitionSchema.parse({ ...MINIMAL, triggers: [] })).toThrow();
  });

  it('refuses a document that would do nothing', () => {
    expect(() => automationDefinitionSchema.parse({ ...MINIMAL, then: [] })).toThrow();
  });

  it('carries then actions that nest, including every control block', () => {
    const parsed = automationDefinitionSchema.parse({
      ...MINIMAL,
      then: [
        {
          type: 'sequence',
          actions: [
            { type: 'scene', sceneKey: 'good_night' },
            {
              type: 'if',
              conditions: [],
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
              conditions: [
                {
                  type: 'entity',
                  entityId: 'binary_sensor.busy',
                  match: { kind: 'state', states: ['on'] },
                },
              ],
              actions: [{ type: 'wait_duration', durationMs: 500 }],
            },
            {
              type: 'wait_for_trigger',
              trigger: { type: 'manual' },
              timeoutMs: 60_000,
            },
            {
              type: 'parallel',
              branches: [
                [{ type: 'scene', sceneKey: 'good_night' }],
                [{ type: 'wait_duration', durationMs: 5_000 }, { type: 'stop' }],
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.then[0]?.type).toBe('sequence');
  });

  it('lets an If check nothing, and a loop not', () => {
    const body = [{ type: 'wait_duration', durationMs: 500 }];

    expect(
      automationDefinitionSchema.safeParse({
        ...MINIMAL,
        then: [{ type: 'if', conditions: [], then: body }],
      }).success,
    ).toBe(true);

    // A loop with nothing to check would never end.
    expect(
      automationDefinitionSchema.safeParse({
        ...MINIMAL,
        then: [{ type: 'while', conditions: [], actions: body }],
      }).success,
    ).toBe(false);
  });

  it('keeps the name and the off switch of any block', () => {
    const parsed = automationDefinitionSchema.parse({
      triggers: [{ type: 'manual', name: 'By hand', isEnabled: false }],
      then: [{ type: 'stop', name: 'Done' }],
    });

    expect(parsed.triggers[0]).toEqual({ type: 'manual', name: 'By hand', isEnabled: false });
    expect(parsed.then[0]).toEqual({ type: 'stop', name: 'Done' });
    expect(parsed.triggers[0] === undefined ? true : isBlockEnabled(parsed.triggers[0])).toBe(
      false,
    );
  });

  it('refuses area occupancy, which was removed', () => {
    expect(
      automationDefinitionSchema.safeParse({
        ...MINIMAL,
        if: [{ type: 'area_occupancy', areaKey: 'kitchen', isOccupied: true }],
      }).success,
    ).toBe(false);
  });
});

describe('automationTriggerSchema', () => {
  it('takes a time of day with its days and months, or a cron expression', () => {
    expect(() =>
      automationTriggerSchema.parse({
        type: 'time',
        at: { kind: 'clock', time: '07:15:30', weekdays: ['monday'], months: ['june'] },
      }),
    ).not.toThrow();

    expect(() =>
      automationTriggerSchema.parse({
        type: 'time',
        at: { kind: 'cron', expression: '0 7 * * 1-5' },
      }),
    ).not.toThrow();
  });

  it('takes a moment of the sun, and an elevation only with its number', () => {
    expect(() =>
      automationTriggerSchema.parse({ type: 'sun', event: 'sunset', offsetMinutes: -15 }),
    ).not.toThrow();
    expect(
      automationTriggerSchema.safeParse({ type: 'sun', event: 'elevation_crossed' }).success,
    ).toBe(false);
    expect(
      automationTriggerSchema.safeParse({
        type: 'sun',
        event: 'elevation_crossed',
        elevation: 10,
        direction: 'setting',
      }).success,
    ).toBe(true);
  });

  it('takes an entity changing state or crossing a number', () => {
    expect(() =>
      automationTriggerSchema.parse({
        type: 'entity',
        entityId: 'sensor.lux',
        change: { kind: 'numeric', operator: 'lt', value: 50 },
        forMs: 60_000,
      }),
    ).not.toThrow();
  });

  it('refuses a time that is not one', () => {
    expect(() =>
      automationTriggerSchema.parse({ type: 'time', at: { kind: 'clock', time: '25:00' } }),
    ).toThrow();
  });

  it('refuses an entity address that is not one', () => {
    expect(() =>
      automationTriggerSchema.parse({
        type: 'entity',
        entityId: 'hallway',
        change: { kind: 'state' },
      }),
    ).toThrow();
  });

  it('accepts a manual trigger, which is how the UI runs one by hand', () => {
    expect(() => automationTriggerSchema.parse({ type: 'manual' })).not.toThrow();
  });

  it('takes a webhook with an id as long as a password, and nothing guessable', () => {
    const webhook = {
      type: 'webhook',
      hookId: '7f3a9c2e5b1d4e88a0b1c2d3e4f50617',
      method: 'POST',
      reach: 'local',
    };

    expect(automationTriggerSchema.parse(webhook)).toEqual(webhook);
    expect(() => automationTriggerSchema.parse({ ...webhook, hookId: '7f3a9c2e' })).toThrow();
    expect(() => automationTriggerSchema.parse({ ...webhook, method: 'TRACE' })).toThrow();
  });
});

describe('the HTTP request action', () => {
  const request = {
    type: 'http_request',
    method: 'POST',
    url: 'https://hooks.example.com/house/{{ door }}/state',
    variables: { door: 'binary_sensor.front_door' },
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Authorization', value: { $sealed: true, ref: 'a1b2c3d4e5f60718' } },
    ],
    body: { kind: 'json', text: '{ "door": {{ door }} }' },
    timeoutMs: 10_000,
  };
  const document = { triggers: [{ type: 'manual' }], then: [request] };

  it('round-trips, and its parameters are entities the automation names', () => {
    const parsed = automationDefinitionSchema.parse(document);

    expect(parsed).toEqual(document);
    expect(entityIdsOfDefinition(parsed)).toEqual(['binary_sensor.front_door']);
  });

  it('refuses an address that is not http, and a header that would split the request', () => {
    for (const action of [
      { ...request, url: 'file:///etc/passwd' },
      { ...request, headers: [{ name: 'X-Evil', value: 'a\r\nHost: elsewhere' }] },
      { ...request, timeoutMs: 120_000 },
    ]) {
      expect(() => automationDefinitionSchema.parse({ ...document, then: [action] })).toThrow();
    }
  });
});

describe('clockAtToCron', () => {
  it('fires every day when no day or month is chosen', () => {
    expect(clockAtToCron({ kind: 'clock', time: '07:00' })).toBe('0 0 7 * * *');
  });

  it('numbers weekdays as cron does, Sunday first, and months from one', () => {
    expect(
      clockAtToCron({
        kind: 'clock',
        time: '22:15:30',
        weekdays: ['sunday', 'monday', 'friday'],
        months: ['december', 'june'],
      }),
    ).toBe('30 15 22 * 6,12 0,1,5');
  });
});

describe('conditionNodeSchema', () => {
  it('needs a time, a day, or both, in a time condition', () => {
    expect(conditionNodeSchema.safeParse({ type: 'time' }).success).toBe(false);
    expect(conditionNodeSchema.safeParse({ type: 'time', from: '22:00' }).success).toBe(true);
    expect(conditionNodeSchema.safeParse({ type: 'time', days: ['monday'] }).success).toBe(true);
  });

  it('needs at least one condition in a group', () => {
    expect(() => conditionNodeSchema.parse({ type: 'or', conditions: [] })).toThrow();
  });

  it('needs the elevation to compare the sun with', () => {
    expect(conditionNodeSchema.safeParse({ type: 'sun', phase: 'above' }).success).toBe(false);
    expect(conditionNodeSchema.safeParse({ type: 'sun', phase: 'golden_hour' }).success).toBe(true);
  });

  it('bounds a sandboxed expression', () => {
    expect(() =>
      conditionNodeSchema.parse({ type: 'expression', expression: 'x'.repeat(2_001) }),
    ).toThrow();
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
            conditions: [
              {
                type: 'entity',
                entityId: 'person.mattia',
                match: { kind: 'state', states: ['home'] },
              },
            ],
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

/** A document with something in every place a block can be. */
const EVERYWHERE = {
  triggers: [
    { type: 'entity', entityId: 'binary_sensor.door', change: { kind: 'state', to: 'on' } },
    {
      type: 'entity',
      entityId: 'sensor.lux',
      change: { kind: 'numeric', operator: 'lt', value: 10 },
    },
  ],
  if: [
    { type: 'entity', entityId: 'switch.away', match: { kind: 'state', states: ['off'] } },
    {
      type: 'and',
      isNot: true,
      conditions: [
        {
          type: 'entity',
          entityId: 'sensor.lux',
          match: { kind: 'numeric', operator: 'gt', value: 50 },
        },
      ],
    },
  ],
  then: [
    {
      type: 'if',
      conditions: [
        {
          type: 'entity',
          entityId: 'binary_sensor.window',
          match: { kind: 'state', states: ['on'] },
        },
      ],
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
                  branches: [
                    [
                      {
                        type: 'command',
                        entityId: 'light.porch',
                        capability: 'on_off',
                        params: { command: 'turn_off' },
                      },
                    ],
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
      trigger: {
        type: 'entity',
        entityId: 'binary_sensor.door',
        change: { kind: 'state', to: 'off' },
      },
      timeoutMs: 1000,
    },
  ],
};

describe('entityIdsOfDefinition', () => {
  it('finds entities in triggers, the conditions and nested actions, each once', () => {
    const definition = automationDefinitionSchema.parse(EVERYWHERE);

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
      triggers: [{ type: 'manual' }],
      then: [
        { type: 'scene', sceneKey: 'evening' },
        { type: 'automation', automationKey: 'porch' },
      ],
    });

    expect(entityIdsOfDefinition(definition)).toEqual([]);
  });
});

describe('renameEntities', () => {
  it('swaps entities at any depth and in expression variables, leaving the rest', () => {
    const definition = automationDefinitionSchema.parse({
      triggers: [{ type: 'entity', entityId: 'binary_sensor.door', change: { kind: 'state' } }],
      if: [
        {
          type: 'or',
          conditions: [
            { type: 'expression', expression: 'a > 1', variables: { a: 'sensor.lux' } },
            { type: 'entity', entityId: 'switch.away', match: { kind: 'state', states: ['on'] } },
          ],
        },
      ],
      then: [
        {
          type: 'if',
          conditions: [],
          then: [
            {
              type: 'command',
              entityId: 'light.hall',
              capability: 'on_off',
              params: { command: 'turn_on' },
            },
          ],
        },
      ],
    });
    const renamed = renameEntities(
      definition,
      new Map([
        ['binary_sensor.door', 'binary_sensor.front_door'],
        ['sensor.lux', 'sensor.hall_lux'],
        ['light.hall', 'light.hallway'],
      ]),
    );

    expect(entityIdsOfDefinition(renamed)).toEqual([
      'binary_sensor.front_door',
      'sensor.hall_lux',
      'switch.away',
      'light.hallway',
    ]);
    expect(entityIdsOfDefinition(definition)).toContain('light.hall');
  });
});

describe('forEachBlock', () => {
  it('addresses every block the way the editor and the trace do', () => {
    const paths: string[] = [];

    forEachBlock(automationDefinitionSchema.parse(EVERYWHERE), (visited) => {
      paths.push(`${visited.family}:${visited.path}`);
    });

    expect(paths).toEqual([
      'trigger:triggers.0',
      'trigger:triggers.1',
      'condition:if.0',
      'condition:if.1',
      'condition:if.1.conditions.0',
      'action:then.0',
      'condition:then.0.conditions.0',
      'action:then.0.then.0',
      'action:then.0.else.0',
      'action:then.0.else.0.cases.0.0',
      'action:then.0.else.0.cases.0.0.branches.0.0',
      'action:then.1',
      'trigger:then.1.trigger',
    ]);
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
    automationDefinitionSchema.safeParse({ triggers: [{ type: 'manual' }], then: [action] })
      .success;

  it('takes a command its capability takes, and refuses one it does not', () => {
    const command = { type: 'command', entityId: 'light.hall', capability: 'level' };

    expect(accepts({ ...command, params: { command: 'set_level', level: 60 } })).toBe(true);
    // An empty body is a run that fails every time it reaches the block.
    expect(accepts({ ...command, params: {} })).toBe(false);
    expect(accepts({ ...command, params: { command: 'set_level', level: 160 } })).toBe(false);
  });

  it('fades a light on and off', () => {
    const command = { type: 'command', entityId: 'light.hall', capability: 'on_off' };

    expect(accepts({ ...command, params: { command: 'turn_on', transitionMs: 2_000 } })).toBe(true);
    expect(accepts({ ...command, params: { command: 'turn_off', transitionMs: 2_000 } })).toBe(
      true,
    );
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
    const parsed = conditionNodeSchema.parse({
      type: 'expression',
      expression: 'power > 2 * avg_power',
      variables: { power: 'sensor.house_power', avg_power: 'sensor.avg_power' },
    });

    expect(parsed).toMatchObject({ variables: { power: 'sensor.house_power' } });
  });

  it('refuses a name the language already means something by', () => {
    expect(
      conditionNodeSchema.safeParse({
        type: 'expression',
        expression: 'true',
        variables: { true: 'sensor.house_power' },
      }).success,
    ).toBe(false);
  });
});
