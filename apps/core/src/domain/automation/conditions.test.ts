import { describe, expect, it } from 'vitest';

import type { ConditionNode } from '@nebulahome/contracts';

import { entityState, statesOf } from '@/testing/entity-states.js';

import {
  dependsOnClock,
  entitiesOfConditions,
  evaluateConditions,
  type ConditionContext,
} from './conditions.js';

const alarm = 'alarm.house';
const battery = 'sensor.hall_battery';
const power = 'sensor.house_power';
const average = 'sensor.average_power';

/** Rome, for the sun. */
const ROME = { latitude: 41.9, longitude: 12.5 };

/**
 * A context at a moment in Rome.
 *
 * @param iso - The instant.
 * @param more - Anything else to change.
 * @returns The context.
 */
function at(iso: string, more: Partial<ConditionContext> = {}): ConditionContext {
  return {
    stateOf: statesOf(
      entityState(alarm, { select: { option: 'armed_away' } }),
      entityState(battery, { sensor_numeric: { value: 35 } }),
      entityState(power, { sensor_numeric: { value: 410 } }),
      entityState(average, { sensor_numeric: { value: 380 } }),
    ),
    now: new Date(iso),
    timeZone: 'Europe/Rome',
    position: ROME,
    ...more,
  };
}

/**
 * Evaluates one condition alone.
 *
 * @param node - The condition.
 * @param context - The house.
 * @returns What the list of it said.
 */
function one(
  node: ConditionNode,
  context: ConditionContext,
): ReturnType<typeof evaluateConditions> {
  return evaluateConditions([node], 'if', context);
}

/** A Saturday evening in Rome: 20:30 local. */
const saturdayEvening = '2026-10-10T18:30:00Z';

describe('evaluateConditions: leaves', () => {
  it('compares an entity state as one word, any of several', () => {
    const outcome = one(
      { type: 'entity', entityId: alarm, match: { kind: 'state', states: ['armed_away'] } },
      at(saturdayEvening),
    );

    expect(outcome).toEqual({
      value: true,
      steps: [
        { path: 'if.0', type: 'entity', result: 'true', entityId: alarm, detail: 'is armed_away' },
      ],
    });
    expect(
      one(
        {
          type: 'entity',
          entityId: alarm,
          match: { kind: 'state', states: ['disarmed', 'armed_home'] },
        },
        at(saturdayEvening),
      ).value,
    ).toBe(false);
  });

  it('compares a number, and says false when there is no reading', () => {
    const above: ConditionNode = {
      type: 'entity',
      entityId: battery,
      match: { kind: 'numeric', operator: 'gt', value: 20 },
    };

    expect(one(above, at(saturdayEvening)).value).toBe(true);
    expect(one(above, at(saturdayEvening, { stateOf: statesOf() })).steps[0]).toMatchObject({
      result: 'false',
      detail: 'has no reading',
    });
  });

  it("reads a time window on the house's clock, across midnight", () => {
    const night: ConditionNode = { type: 'time', from: '22:00', to: '06:30' };

    expect(one(night, at(saturdayEvening)).value).toBe(false);
    // 23:30 in Rome.
    expect(one(night, at('2026-10-10T21:30:00Z')).steps[0]).toMatchObject({
      result: 'true',
      detail: 'it is Saturday 23:30',
    });
  });

  it('holds from a time until midnight when it has no end', () => {
    const evening: ConditionNode = { type: 'time', from: '20:00' };

    expect(one(evening, at(saturdayEvening)).value).toBe(true);
    // 19:30 in Rome.
    expect(one(evening, at('2026-10-10T17:30:00Z')).value).toBe(false);
  });

  it("reads the days on the house's clock, and the day a night window started on", () => {
    const weekend: ConditionNode = { type: 'time', days: ['saturday', 'sunday'] };
    const fridayNight: ConditionNode = {
      type: 'time',
      from: '22:00',
      to: '06:30',
      days: ['friday'],
    };

    expect(one(weekend, at(saturdayEvening)).value).toBe(true);
    // Saturday 02:00 in Rome: Friday's night is still on.
    expect(one(fridayNight, at('2026-10-10T00:00:00Z')).value).toBe(true);
    // Saturday 23:00 in Rome: Saturday's night is not Friday's.
    expect(one(fridayNight, at('2026-10-10T21:00:00Z')).value).toBe(false);
  });

  it('reads the sun where the house stands', () => {
    // 20:30 in Rome in October: long after sunset.
    expect(one({ type: 'sun', phase: 'night' }, at(saturdayEvening)).value).toBe(true);
    expect(one({ type: 'sun', phase: 'day' }, at(saturdayEvening)).value).toBe(false);
    expect(
      one({ type: 'sun', phase: 'above', elevation: 20 }, at('2026-10-10T11:00:00Z')).value,
    ).toBe(true);
  });

  it('fails a sun check in a house that stands nowhere', () => {
    expect(
      one({ type: 'sun', phase: 'day' }, at(saturdayEvening, { position: null })),
    ).toMatchObject({ value: false, steps: [{ result: 'failed' }] });
  });

  it('evaluates an expression over the readings it names', () => {
    const twice: ConditionNode = {
      type: 'expression',
      expression: 'power > 2 * avg_power',
      variables: { power, avg_power: average },
    };

    expect(one(twice, at(saturdayEvening)).steps[0]).toEqual({
      path: 'if.0',
      type: 'expression',
      result: 'false',
      detail: 'power 410, avg_power 380',
    });
  });

  it('says false when a reading it names is missing, and failed when it cannot run', () => {
    const missing: ConditionNode = {
      type: 'expression',
      expression: 'x > 1',
      variables: { x: 'sensor.nowhere' },
    };
    const broken: ConditionNode = { type: 'expression', expression: 'power >' };

    expect(one(missing, at(saturdayEvening)).steps[0]).toMatchObject({
      result: 'false',
      detail: 'x (sensor.nowhere) has no reading',
    });
    expect(one(broken, at(saturdayEvening))).toMatchObject({
      value: false,
      steps: [{ result: 'failed' }],
    });
  });

  it('reads a number or text result as yes or no', () => {
    expect(one({ type: 'expression', expression: '2 - 2' }, at(saturdayEvening)).value).toBe(false);
    expect(one({ type: 'expression', expression: '"on"' }, at(saturdayEvening)).value).toBe(true);
  });
});

describe('evaluateConditions: lists and groups', () => {
  const armed: ConditionNode = {
    type: 'entity',
    entityId: alarm,
    match: { kind: 'state', states: ['armed_away'] },
  };
  const weekend: ConditionNode = { type: 'time', days: ['saturday', 'sunday'] };
  const low: ConditionNode = {
    type: 'entity',
    entityId: battery,
    match: { kind: 'numeric', operator: 'lt', value: 20 },
  };

  it('needs every condition of a list, and records every check', () => {
    const outcome = evaluateConditions([armed, low], 'if', at(saturdayEvening));

    expect(outcome.value).toBe(false);
    expect(outcome.steps.map((step) => step.path)).toEqual(['if.0', 'if.1']);
  });

  it('holds when there is nothing to check', () => {
    expect(evaluateConditions([], 'if', at(saturdayEvening))).toEqual({ value: true, steps: [] });
  });

  it('groups with AND and OR, each a block of its own in the trace', () => {
    const either: ConditionNode = { type: 'or', conditions: [armed, low] };
    const outcome = evaluateConditions([either], 'if', at(saturdayEvening));

    expect(outcome.value).toBe(true);
    expect(outcome.steps.map((step) => [step.path, step.result])).toEqual([
      ['if.0', 'true'],
      ['if.0.conditions.0', 'true'],
      ['if.0.conditions.1', 'false'],
    ]);
    expect(
      evaluateConditions([{ type: 'and', conditions: [armed, low] }], 'if', at(saturdayEvening))
        .value,
    ).toBe(false);
  });

  it('turns any block around with NOT, a group as a whole', () => {
    expect(one({ ...weekend, isNot: true }, at(saturdayEvening))).toMatchObject({
      value: false,
      steps: [{ result: 'false', detail: 'it is Saturday 20:30' }],
    });
    expect(
      one({ type: 'or', isNot: true, conditions: [armed, low] }, at(saturdayEvening)).value,
    ).toBe(false);
  });

  it('leaves out what is turned off, as if it were not there', () => {
    const outcome = evaluateConditions(
      [armed, { ...low, isEnabled: false }],
      'if',
      at(saturdayEvening),
    );

    expect(outcome.value).toBe(true);
    expect(outcome.steps[1]).toMatchObject({
      path: 'if.1',
      result: 'skipped',
      detail: 'Turned off',
    });
    // An OR with nothing left on in it asks nothing.
    expect(
      one({ type: 'or', conditions: [{ ...low, isEnabled: false }] }, at(saturdayEvening)).value,
    ).toBe(true);
  });

  it('finds the entities and the dependence on the clock', () => {
    const conditions: ConditionNode[] = [
      armed,
      {
        type: 'or',
        conditions: [weekend, { type: 'expression', expression: 'p > 1', variables: { p: power } }],
      },
    ];

    expect(entitiesOfConditions(conditions)).toEqual([alarm, power]);
    expect(dependsOnClock(conditions)).toBe(true);
    expect(dependsOnClock([armed])).toBe(false);
    expect(dependsOnClock([{ type: 'sun', phase: 'day' }])).toBe(true);
  });
});
