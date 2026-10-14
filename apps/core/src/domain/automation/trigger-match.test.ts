import { describe, expect, it } from 'vitest';

import {
  parseEntityId,
  SUN_ELEVATION_ENTITY_ID,
  type AutomationTrigger,
  type EntityState,
} from '@nebulahome/contracts';

import { entityState, statesOf } from '@/testing/entity-states.js';

import {
  entitiesOfTriggers,
  reactTriggers,
  triggerHoldsNow,
  triggerLeaves,
  type TriggerEvent,
} from './trigger-match.js';

const now = new Date('2026-10-09T12:00:00Z');
const motion = parseEntityId('binary_sensor.living_room_motion');
const lux = parseEntityId('sensor.living_room_lux');

/**
 * The motion sensor in a state.
 *
 * @param value - On, off, or gone (unreachable).
 * @returns The state.
 */
function motionState(value: boolean | 'gone'): EntityState {
  return entityState(
    motion,
    { sensor_binary: { isOn: value === true } },
    { isAvailable: value !== 'gone', lastChanged: now },
  );
}

/**
 * A change of the motion sensor.
 *
 * @param from - What it was, or undefined for a first report.
 * @param to - What it is now.
 * @returns The event and the state after it.
 */
function motionChange(
  from: boolean | 'gone' | undefined,
  to: boolean | 'gone',
): { event: TriggerEvent; current: EntityState } {
  const current = motionState(to);

  return {
    current,
    event: {
      kind: 'state',
      entityId: motion,
      previous: from === undefined ? undefined : motionState(from),
      current,
    },
  };
}

/**
 * A change of the light level.
 *
 * @param from - The reading before, or 'gone'.
 * @param to - The reading now.
 * @returns The event.
 */
function luxChange(from: number | 'gone', to: number): TriggerEvent {
  return {
    kind: 'state',
    entityId: lux,
    previous: entityState(
      lux,
      { sensor_numeric: { value: from === 'gone' ? 0 : from } },
      { isAvailable: from !== 'gone' },
    ),
    current: entityState(lux, { sensor_numeric: { value: to } }),
  };
}

/**
 * A list of triggers: the one asked about, and its path in the list.
 *
 * @param triggers - The triggers.
 * @returns The same, as the document holds them.
 */
const list = (...triggers: AutomationTrigger[]): AutomationTrigger[] => triggers;

const turnsOn: AutomationTrigger = {
  type: 'entity',
  entityId: motion,
  change: { kind: 'state', to: 'on' },
};
const heldOn: AutomationTrigger = { ...turnsOn, forMs: 120_000 };
const sunset: AutomationTrigger = { type: 'sun', event: 'sunset' };
const dark: AutomationTrigger = {
  type: 'entity',
  entityId: lux,
  change: { kind: 'numeric', operator: 'lt', value: 50 },
};
const heldDark: AutomationTrigger = { ...dark, forMs: 60_000 };

describe('reactTriggers: an entity entering a state', () => {
  it('fires when the entity enters the state it waits for', () => {
    const { event, current } = motionChange(false, true);

    expect(reactTriggers(list(turnsOn), event, { stateOf: statesOf(current), now }).fired).toEqual({
      kind: 'entity',
      path: 'triggers.0',
      entityId: motion,
      from: 'off',
      to: 'on',
    });
  });

  it('does not fire on the first report after startup, which is not a change', () => {
    const { event, current } = motionChange(undefined, true);

    expect(
      reactTriggers(list(turnsOn), event, { stateOf: statesOf(current), now }).fired,
    ).toBeNull();
  });

  it('does not fire when a device comes back, unless the trigger asks about that', () => {
    const { event, current } = motionChange('gone', true);
    const context = { stateOf: statesOf(current), now };

    expect(reactTriggers(list(turnsOn), event, context).fired).toBeNull();
    expect(
      reactTriggers(
        list({
          type: 'entity',
          entityId: motion,
          change: { kind: 'state', from: 'unavailable', to: 'on' },
        }),
        event,
        context,
      ).fired,
    ).toMatchObject({ from: 'unavailable', to: 'on' });
  });

  it('fires on any change when it names no state, but not on going away', () => {
    const anyChange: AutomationTrigger = {
      type: 'entity',
      entityId: motion,
      change: { kind: 'state' },
    };
    const away = motionChange(true, 'gone');

    expect(
      reactTriggers(list(anyChange), motionChange(true, false).event, {
        stateOf: statesOf(),
        now,
      }).fired,
    ).not.toBeNull();
    expect(
      reactTriggers(list(anyChange), away.event, { stateOf: statesOf(away.current), now }).fired,
    ).toBeNull();
  });

  it('checks where it came from', () => {
    const { event, current } = motionChange(false, true);

    expect(
      reactTriggers(
        list({ type: 'entity', entityId: motion, change: { kind: 'state', from: 'on', to: 'on' } }),
        event,
        { stateOf: statesOf(current), now },
      ).fired,
    ).toBeNull();
  });

  it('starts a hold instead of firing when it must last, and cancels it when it does not', () => {
    const on = motionChange(false, true);
    const started = reactTriggers(list(heldOn), on.event, { stateOf: statesOf(on.current), now });

    expect(started.fired).toBeNull();
    expect(started.holds).toEqual([{ path: 'triggers.0', ms: 120_000, expectToken: 'on' }]);

    const off = motionChange(true, false);

    expect(
      reactTriggers(list(heldOn), off.event, { stateOf: statesOf(off.current), now }).cancels,
    ).toEqual(['triggers.0']);
  });

  it('fires when a hold runs its course with the entity still in the state', () => {
    const hold: TriggerEvent = { kind: 'hold', path: 'triggers.0', expectToken: 'on' };

    expect(
      reactTriggers(list(heldOn), hold, { stateOf: statesOf(motionState(true)), now }).fired,
    ).toMatchObject({ kind: 'entity', to: 'on' });
    expect(
      reactTriggers(list(heldOn), hold, { stateOf: statesOf(motionState(false)), now }).fired,
    ).toBeNull();
  });

  it('ignores a change of another entity', () => {
    expect(
      reactTriggers(list(turnsOn), luxChange(80, 40), { stateOf: statesOf(), now }).fired,
    ).toBeNull();
  });
});

describe('reactTriggers: an entity crossing a number', () => {
  it('fires on crossing the threshold, not while it stays past it', () => {
    const context = { stateOf: statesOf(), now };

    expect(reactTriggers(list(dark), luxChange(80, 40), context).fired).toEqual({
      kind: 'entity',
      path: 'triggers.0',
      entityId: lux,
      value: 40,
    });
    expect(reactTriggers(list(dark), luxChange(40, 30), context).fired).toBeNull();
    expect(reactTriggers(list(dark), luxChange('gone', 30), context).fired).toBeNull();
  });

  it('holds when it must last, and cancels when the reading goes back', () => {
    const context = { stateOf: statesOf(), now };

    expect(reactTriggers(list(heldDark), luxChange(80, 40), context).holds).toEqual([
      { path: 'triggers.0', ms: 60_000 },
    ]);
    expect(reactTriggers(list(heldDark), luxChange(40, 80), context).cancels).toEqual([
      'triggers.0',
    ]);
  });

  it('fires at the end of a hold only while the comparison holds', () => {
    const hold: TriggerEvent = { kind: 'hold', path: 'triggers.0' };
    const reads = (value: number): { stateOf: ReturnType<typeof statesOf>; now: Date } => ({
      stateOf: statesOf(entityState(lux, { sensor_numeric: { value } })),
      now,
    });

    expect(reactTriggers(list(heldDark), hold, reads(10)).fired).toMatchObject({ value: 10 });
    expect(reactTriggers(list(heldDark), hold, reads(90)).fired).toBeNull();
  });
});

describe('reactTriggers: the list', () => {
  it('fires on whichever trigger fires: any of them wakes it', () => {
    expect(
      reactTriggers(
        list(turnsOn, sunset),
        { kind: 'time', path: 'triggers.1' },
        { stateOf: statesOf(), now },
      ).fired,
    ).toEqual({ kind: 'sun', path: 'triggers.1', event: 'sunset' });
  });

  it('fires a time trigger at its moment', () => {
    const seven: AutomationTrigger = { type: 'time', at: { kind: 'clock', time: '07:00' } };

    expect(
      reactTriggers(list(seven), { kind: 'time', path: 'triggers.0' }, { stateOf: statesOf(), now })
        .fired,
    ).toEqual({ kind: 'time', path: 'triggers.0' });
  });

  it('wakes a manual trigger only when somebody asks, and never an event', () => {
    const context = { stateOf: statesOf(), now };

    expect(reactTriggers(list({ type: 'manual' }), { kind: 'manual' }, context).fired).toEqual({
      kind: 'manual',
      path: 'triggers.0',
    });
    expect(
      reactTriggers(list({ type: 'event', event: 'button.pressed' }), { kind: 'manual' }, context)
        .fired,
    ).toBeNull();
  });

  it('ignores a trigger turned off, which keeps its place in the list', () => {
    const { event, current } = motionChange(false, true);
    const context = { stateOf: statesOf(current), now };
    const off: AutomationTrigger = { ...turnsOn, isEnabled: false };

    expect(reactTriggers(list(off), event, context).fired).toBeNull();
    expect(reactTriggers(list(off, turnsOn), event, context).fired).toMatchObject({
      path: 'triggers.1',
    });
    expect(triggerLeaves(list(off, sunset)).map((ref) => ref.path)).toEqual(['triggers.1']);
  });

  it('lists the triggers with their paths, and the entities it watches', () => {
    const changed: AutomationTrigger = { type: 'sun', event: 'elevation_changed' };

    expect(triggerLeaves(list(turnsOn, sunset, dark)).map((ref) => ref.path)).toEqual([
      'triggers.0',
      'triggers.1',
      'triggers.2',
    ]);
    expect(entitiesOfTriggers(list(turnsOn, sunset, dark, changed))).toEqual([
      motion,
      lux,
      SUN_ELEVATION_ENTITY_ID,
    ]);
  });
});

describe('reactTriggers: the sun', () => {
  it('fires on each new elevation when it waits for the elevation to change', () => {
    const changed: AutomationTrigger = { type: 'sun', event: 'elevation_changed' };
    const sun = parseEntityId(SUN_ELEVATION_ENTITY_ID);
    const event: TriggerEvent = {
      kind: 'state',
      entityId: sun,
      previous: entityState(sun, { sensor_numeric: { value: 12.4 } }),
      current: entityState(sun, { sensor_numeric: { value: 12.6 } }),
    };

    expect(reactTriggers(list(changed), event, { stateOf: statesOf(), now }).fired).toEqual({
      kind: 'sun',
      path: 'triggers.0',
      event: 'elevation_changed',
      entityId: SUN_ELEVATION_ENTITY_ID,
      value: 12.6,
    });
  });
});

describe('triggerHoldsNow', () => {
  it('says whether an entity is where a trigger waits for it, and nothing of an instant', () => {
    const context = { stateOf: statesOf(motionState(true)), now };

    expect(triggerHoldsNow(turnsOn, context)).toBe(true);
    expect(triggerHoldsNow({ ...turnsOn, change: { kind: 'state', to: 'off' } }, context)).toBe(
      false,
    );
    expect(triggerHoldsNow({ ...turnsOn, change: { kind: 'state' } }, context)).toBeNull();
    expect(triggerHoldsNow(sunset, context)).toBeNull();
    expect(
      triggerHoldsNow(dark, {
        stateOf: statesOf(entityState(lux, { sensor_numeric: { value: 20 } })),
        now,
      }),
    ).toBe(true);
  });
});
