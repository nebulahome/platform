/**
 * Old automations read as current ones.
 *
 * Every shape the format has had is in a row somewhere, and the schema runs this before it checks
 * anything. A shape it misreads is an automation that silently stops working, or - worse - one
 * that starts doing something its author never wrote.
 */
import { describe, expect, it } from 'vitest';

import { automationDefinitionSchema } from './automation-definition.js';
import { migrateDefinition } from './automation-migrate.js';

/** A light switched on: the action every case ends with. */
const TURN_ON = {
  type: 'command',
  entityId: 'light.hall',
  capability: 'on_off',
  params: { command: 'turn_on' },
};

describe('migrateDefinition', () => {
  it('reads the oldest { triggers, conditions, actions } document', () => {
    const parsed = automationDefinitionSchema.parse({
      triggers: [{ type: 'state', entityId: 'binary_sensor.door', to: 'on' }],
      conditions: [{ type: 'state', entityId: 'person.mattia', state: 'home' }],
      actions: [TURN_ON],
    });

    expect(parsed).toEqual({
      triggers: [
        { type: 'entity', entityId: 'binary_sensor.door', change: { kind: 'state', to: 'on' } },
      ],
      if: [
        { type: 'entity', entityId: 'person.mattia', match: { kind: 'state', states: ['home'] } },
      ],
      then: [TURN_ON],
    });
  });

  it('flattens a trigger tree into the list, AND groups included', () => {
    const parsed = automationDefinitionSchema.parse({
      triggers: {
        op: 'or',
        items: [
          {
            op: 'and',
            items: [
              {
                type: 'numeric_state',
                entityId: 'sensor.lux',
                operator: 'lt',
                value: 50,
                forMs: 5,
              },
              { type: 'manual' },
            ],
          },
          { type: 'time', at: { kind: 'solar', event: 'sunset', offsetMinutes: -15 } },
          { type: 'time', at: { kind: 'solar', event: 'sunrise', offsetMinutes: 0 } },
        ],
      },
      then: [TURN_ON],
    });

    expect(parsed.triggers).toEqual([
      {
        type: 'entity',
        entityId: 'sensor.lux',
        change: { kind: 'numeric', operator: 'lt', value: 50 },
        forMs: 5,
      },
      { type: 'manual' },
      { type: 'sun', event: 'sunset', offsetMinutes: -15 },
      { type: 'sun', event: 'sunrise' },
    ]);
  });

  it('unwraps a root AND into the list, reads every old condition, keeps NOT on the block', () => {
    const migrated = migrateDefinition({
      triggers: [{ type: 'manual' }],
      if: {
        op: 'and',
        items: [
          { type: 'time_window', from: '22:00', to: '06:30' },
          { op: 'not', item: { type: 'day_of_week', days: ['saturday', 'sunday'] } },
          {
            op: 'or',
            items: [
              { type: 'state', entityId: 'person.anna', state: 'home' },
              { type: 'numeric', entityId: 'sensor.lux', operator: 'gt', value: 10 },
            ],
          },
          {
            type: 'not',
            condition: { type: 'not', condition: { type: 'expression', expression: 'x' } },
          },
        ],
      },
      then: [TURN_ON],
    });

    expect(migrated).toEqual({
      triggers: [{ type: 'manual' }],
      if: [
        { type: 'time', from: '22:00', to: '06:30' },
        { type: 'time', days: ['saturday', 'sunday'], isNot: true },
        {
          type: 'or',
          conditions: [
            { type: 'entity', entityId: 'person.anna', match: { kind: 'state', states: ['home'] } },
            {
              type: 'entity',
              entityId: 'sensor.lux',
              match: { kind: 'numeric', operator: 'gt', value: 10 },
            },
          ],
        },
        // NOT of NOT is the condition itself.
        { type: 'expression', expression: 'x' },
      ],
      then: [TURN_ON],
    });
  });

  it('keeps a lone legacy condition, NOT included, as a list of one', () => {
    expect(
      migrateDefinition({
        triggers: [{ type: 'manual' }],
        if: { op: 'not', item: { type: 'state', entityId: 'person.anna', state: 'home' } },
        then: [TURN_ON],
      }),
    ).toMatchObject({
      if: [
        {
          type: 'entity',
          entityId: 'person.anna',
          match: { kind: 'state', states: ['home'] },
          isNot: true,
        },
      ],
    });
  });

  it('rewrites the conditions and branches of nested actions', () => {
    const parsed = automationDefinitionSchema.parse({
      triggers: [{ type: 'manual' }],
      then: [
        {
          type: 'if',
          condition: { type: 'state', entityId: 'person.anna', state: 'home' },
          then: [
            {
              type: 'while',
              condition: {
                op: 'and',
                items: [
                  { type: 'state', entityId: 'binary_sensor.busy', state: 'on' },
                  { type: 'time_window', from: '08:00', to: '20:00' },
                ],
              },
              actions: [{ type: 'wait_duration', durationMs: 500 }],
            },
          ],
        },
        {
          type: 'parallel',
          actions: [
            TURN_ON,
            { type: 'sequence', actions: [{ type: 'wait_duration', durationMs: 5 }, TURN_ON] },
          ],
        },
        {
          type: 'wait_for_trigger',
          trigger: { type: 'state', entityId: 'binary_sensor.door', to: 'off' },
          timeoutMs: 1_000,
        },
      ],
    });

    expect(parsed.then).toEqual([
      {
        type: 'if',
        conditions: [
          { type: 'entity', entityId: 'person.anna', match: { kind: 'state', states: ['home'] } },
        ],
        then: [
          {
            type: 'while',
            conditions: [
              {
                type: 'entity',
                entityId: 'binary_sensor.busy',
                match: { kind: 'state', states: ['on'] },
              },
              { type: 'time', from: '08:00', to: '20:00' },
            ],
            actions: [{ type: 'wait_duration', durationMs: 500 }],
          },
        ],
      },
      {
        type: 'parallel',
        branches: [[TURN_ON], [{ type: 'wait_duration', durationMs: 5 }, TURN_ON]],
      },
      {
        type: 'wait_for_trigger',
        trigger: {
          type: 'entity',
          entityId: 'binary_sensor.door',
          change: { kind: 'state', to: 'off' },
        },
        timeoutMs: 1_000,
      },
    ]);
  });

  it('gives a current document back as it was', () => {
    const current = {
      triggers: [{ type: 'sun', event: 'sunset', name: 'Evening' }],
      if: [{ type: 'and', isNot: true, conditions: [{ type: 'time', from: '18:00' }] }],
      then: [{ type: 'parallel', branches: [[TURN_ON]] }],
    };

    expect(migrateDefinition(current)).toEqual(current);
    expect(migrateDefinition(migrateDefinition(current))).toEqual(current);
  });

  it('leaves area occupancy for the schema to refuse', () => {
    const migrated = migrateDefinition({
      triggers: [{ type: 'manual' }],
      if: [{ type: 'area_occupancy', areaKey: 'kitchen', isOccupied: true }],
      then: [TURN_ON],
    });

    expect(migrated).toMatchObject({ if: [{ type: 'area_occupancy' }] });
    expect(automationDefinitionSchema.safeParse(migrated).success).toBe(false);
  });
});
