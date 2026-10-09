import { describe, expect, it } from 'vitest';

import type { BooleanTree } from '@nebulahome/contracts';

import { entityState, statesOf } from '@/testing/entity-states.js';

import {
  areasOfConditions,
  dependsOnClock,
  entitiesOfConditions,
  evaluateConditions,
  isOccupied,
  type ConditionContext,
} from './conditions.js';

const alarm = 'alarm.house';
const battery = 'sensor.hall_battery';
const power = 'sensor.house_power';
const average = 'sensor.average_power';

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
    occupancy: () => null,
    ...more,
  };
}

/** A Saturday evening in Rome: 20:30 local. */
const saturdayEvening = '2026-10-10T18:30:00Z';

describe('evaluateConditions: leaves', () => {
  it('compares an entity state as one word', () => {
    const outcome = evaluateConditions(
      { type: 'state', entityId: alarm, state: 'armed_away' },
      'if',
      at(saturdayEvening),
    );

    expect(outcome).toEqual({
      value: true,
      steps: [
        { path: 'if', type: 'state', result: 'true', entityId: alarm, detail: 'is armed_away' },
      ],
    });
  });

  it('compares a number, and says false when there is no reading', () => {
    const above: BooleanTree = { type: 'numeric', entityId: battery, operator: 'gt', value: 20 };

    expect(evaluateConditions(above, 'if', at(saturdayEvening)).value).toBe(true);
    expect(
      evaluateConditions(above, 'if', at(saturdayEvening, { stateOf: statesOf() })).steps[0],
    ).toMatchObject({ result: 'false', detail: 'has no reading' });
  });

  it("reads a time window on the house's clock, across midnight", () => {
    const night: BooleanTree = { type: 'time_window', from: '22:00', to: '06:30' };

    expect(evaluateConditions(night, 'if', at(saturdayEvening)).value).toBe(false);
    // 23:30 in Rome.
    expect(evaluateConditions(night, 'if', at('2026-10-10T21:30:00Z')).steps[0]).toMatchObject({
      result: 'true',
      detail: 'it is 23:30',
    });
  });

  it("reads the day on the house's clock", () => {
    const weekend: BooleanTree = { type: 'day_of_week', days: ['saturday', 'sunday'] };

    expect(evaluateConditions(weekend, 'if', at(saturdayEvening)).steps[0]).toMatchObject({
      result: 'true',
      detail: 'it is Saturday',
    });
  });

  it('asks the areas who is there, and says so when an area cannot tell', () => {
    const someone: BooleanTree = { type: 'area_occupancy', areaKey: 'kitchen', isOccupied: true };

    expect(
      evaluateConditions(someone, 'if', at(saturdayEvening, { occupancy: () => true })).value,
    ).toBe(true);
    expect(evaluateConditions(someone, 'if', at(saturdayEvening)).steps[0]).toMatchObject({
      result: 'false',
      detail: 'No motion, occupancy or presence sensor in kitchen',
    });
    expect(
      evaluateConditions(
        { ...someone, isOccupied: false },
        'if',
        at(saturdayEvening, {
          occupancy: () => false,
        }),
      ).value,
    ).toBe(true);
  });

  it('evaluates an expression over the readings it names', () => {
    const twice: BooleanTree = {
      type: 'expression',
      expression: 'power > 2 * avg_power',
      variables: { power, avg_power: average },
    };

    expect(evaluateConditions(twice, 'if', at(saturdayEvening)).steps[0]).toEqual({
      path: 'if',
      type: 'expression',
      result: 'false',
      detail: 'power 410, avg_power 380',
    });
  });

  it('says false when a reading it names is missing, and failed when it cannot run', () => {
    const missing: BooleanTree = {
      type: 'expression',
      expression: 'x > 1',
      variables: { x: 'sensor.nowhere' },
    };
    const broken: BooleanTree = { type: 'expression', expression: 'power >' };

    expect(evaluateConditions(missing, 'if', at(saturdayEvening)).steps[0]).toMatchObject({
      result: 'false',
      detail: 'x (sensor.nowhere) has no reading',
    });
    expect(evaluateConditions(broken, 'if', at(saturdayEvening))).toMatchObject({
      value: false,
      steps: [{ result: 'failed' }],
    });
  });

  it('reads a number or text result as yes or no', () => {
    expect(
      evaluateConditions({ type: 'expression', expression: '2 - 2' }, 'if', at(saturdayEvening))
        .value,
    ).toBe(false);
    expect(
      evaluateConditions({ type: 'expression', expression: '"on"' }, 'if', at(saturdayEvening))
        .value,
    ).toBe(true);
  });
});

describe('evaluateConditions: trees', () => {
  const armed: BooleanTree = { type: 'state', entityId: alarm, state: 'armed_away' };
  const weekend: BooleanTree = { type: 'day_of_week', days: ['saturday', 'sunday'] };
  const low: BooleanTree = { type: 'numeric', entityId: battery, operator: 'lt', value: 20 };

  it('combines with AND and OR, and records every check', () => {
    const outcome = evaluateConditions(
      { op: 'and', items: [armed, low] },
      'if',
      at(saturdayEvening),
    );

    expect(outcome.value).toBe(false);
    expect(outcome.steps.map((step) => step.path)).toEqual(['if.0', 'if.1']);
    expect(
      evaluateConditions({ op: 'or', items: [armed, low] }, 'if', at(saturdayEvening)).value,
    ).toBe(true);
  });

  it('negates with NOT', () => {
    const notWeekend: BooleanTree = { op: 'not', item: weekend };
    const outcome = evaluateConditions(notWeekend, 'if', at(saturdayEvening));

    expect(outcome.value).toBe(false);
    expect(outcome.steps[0]?.path).toBe('if.not');
  });

  it('finds the areas, entities and clock dependence of a tree', () => {
    const tree: BooleanTree = {
      op: 'and',
      items: [
        armed,
        { op: 'not', item: { type: 'area_occupancy', areaKey: 'kitchen', isOccupied: true } },
        { type: 'expression', expression: 'p > 1', variables: { p: power } },
      ],
    };

    expect(areasOfConditions(tree)).toEqual(['kitchen']);
    expect(entitiesOfConditions(tree)).toEqual([alarm, power]);
    expect(dependsOnClock(tree)).toBe(true);
    expect(dependsOnClock(armed)).toBe(false);
  });
});

describe('isOccupied', () => {
  it('is occupied while any reachable sensor is on', () => {
    const stateOf = statesOf(
      entityState('binary_sensor.kitchen_motion', { sensor_binary: { isOn: false } }),
      entityState('binary_sensor.kitchen_presence', { sensor_binary: { isOn: true } }),
      entityState(
        'binary_sensor.pantry_motion',
        { sensor_binary: { isOn: true } },
        {
          isAvailable: false,
        },
      ),
    );

    expect(
      isOccupied(['binary_sensor.kitchen_motion', 'binary_sensor.kitchen_presence'], stateOf),
    ).toBe(true);
    expect(
      isOccupied(['binary_sensor.kitchen_motion', 'binary_sensor.pantry_motion'], stateOf),
    ).toBe(false);
  });

  it('cannot tell without sensors', () => {
    expect(isOccupied([], statesOf())).toBeNull();
  });
});
