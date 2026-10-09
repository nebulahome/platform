import { describe, expect, it } from 'vitest';

import { parseEntityId, type EntityState, type TriggerTree } from '@nebulahome/contracts';

import { entityState, statesOf } from '@/testing/entity-states.js';

import {
  entitiesOfTriggers,
  reactTriggers,
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

const turnsOn: TriggerTree = { type: 'state', entityId: motion, to: 'on' };
const heldOn: TriggerTree = { type: 'state', entityId: motion, to: 'on', forMs: 120_000 };
const sunset: TriggerTree = {
  type: 'time',
  at: { kind: 'solar', event: 'sunset', offsetMinutes: 0 },
};
const dark: TriggerTree = { type: 'numeric_state', entityId: lux, operator: 'lt', value: 50 };
const heldDark: TriggerTree = {
  type: 'numeric_state',
  entityId: lux,
  operator: 'lt',
  value: 50,
  forMs: 60_000,
};

describe('reactTriggers: entity state', () => {
  it('fires when the entity enters the state it waits for', () => {
    const { event, current } = motionChange(false, true);

    expect(reactTriggers(turnsOn, event, { stateOf: statesOf(current), now }).fired).toEqual({
      kind: 'state',
      path: 'triggers',
      entityId: motion,
      from: 'off',
      to: 'on',
    });
  });

  it('does not fire on the first report after startup, which is not a change', () => {
    const { event, current } = motionChange(undefined, true);

    expect(reactTriggers(turnsOn, event, { stateOf: statesOf(current), now }).fired).toBeNull();
  });

  it('does not fire when a device comes back, unless the trigger asks about that', () => {
    const { event, current } = motionChange('gone', true);
    const context = { stateOf: statesOf(current), now };

    expect(reactTriggers(turnsOn, event, context).fired).toBeNull();
    expect(
      reactTriggers(
        { type: 'state', entityId: motion, from: 'unavailable', to: 'on' },
        event,
        context,
      ).fired,
    ).toMatchObject({ from: 'unavailable', to: 'on' });
  });

  it('fires on any change when it names no state, but not on going away', () => {
    const anyChange: TriggerTree = { type: 'state', entityId: motion };
    const away = motionChange(true, 'gone');

    expect(
      reactTriggers(anyChange, motionChange(true, false).event, { stateOf: statesOf(), now }).fired,
    ).not.toBeNull();
    expect(
      reactTriggers(anyChange, away.event, { stateOf: statesOf(away.current), now }).fired,
    ).toBeNull();
  });

  it('checks where it came from', () => {
    const { event, current } = motionChange(false, true);

    expect(
      reactTriggers({ type: 'state', entityId: motion, from: 'on', to: 'on' }, event, {
        stateOf: statesOf(current),
        now,
      }).fired,
    ).toBeNull();
  });

  it('starts a hold instead of firing when it must last, and cancels it when it does not', () => {
    const on = motionChange(false, true);
    const started = reactTriggers(heldOn, on.event, { stateOf: statesOf(on.current), now });

    expect(started.fired).toBeNull();
    expect(started.holds).toEqual([{ path: 'triggers', ms: 120_000, expectToken: 'on' }]);

    const off = motionChange(true, false);

    expect(
      reactTriggers(heldOn, off.event, { stateOf: statesOf(off.current), now }).cancels,
    ).toEqual(['triggers']);
  });

  it('fires when a hold runs its course with the entity still in the state', () => {
    const hold: TriggerEvent = { kind: 'hold', path: 'triggers', expectToken: 'on' };

    expect(
      reactTriggers(heldOn, hold, { stateOf: statesOf(motionState(true)), now }).fired,
    ).toMatchObject({ kind: 'state', to: 'on' });
    expect(
      reactTriggers(heldOn, hold, { stateOf: statesOf(motionState(false)), now }).fired,
    ).toBeNull();
  });

  it('ignores a change of another entity', () => {
    expect(
      reactTriggers(turnsOn, luxChange(80, 40), { stateOf: statesOf(), now }).fired,
    ).toBeNull();
  });
});

describe('reactTriggers: numeric', () => {
  it('fires on crossing the threshold, not while it stays past it', () => {
    const context = { stateOf: statesOf(), now };

    expect(reactTriggers(dark, luxChange(80, 40), context).fired).toEqual({
      kind: 'numeric_state',
      path: 'triggers',
      entityId: lux,
      value: 40,
    });
    expect(reactTriggers(dark, luxChange(40, 30), context).fired).toBeNull();
    expect(reactTriggers(dark, luxChange('gone', 30), context).fired).toBeNull();
  });

  it('holds when it must last, and cancels when the reading goes back', () => {
    const context = { stateOf: statesOf(), now };

    expect(reactTriggers(heldDark, luxChange(80, 40), context).holds).toEqual([
      { path: 'triggers', ms: 60_000 },
    ]);
    expect(reactTriggers(heldDark, luxChange(40, 80), context).cancels).toEqual(['triggers']);
  });

  it('fires at the end of a hold only while the comparison holds', () => {
    const hold: TriggerEvent = { kind: 'hold', path: 'triggers' };
    const reads = (value: number): { stateOf: ReturnType<typeof statesOf>; now: Date } => ({
      stateOf: statesOf(entityState(lux, { sensor_numeric: { value } })),
      now,
    });

    expect(reactTriggers(heldDark, hold, reads(10)).fired).toMatchObject({ value: 10 });
    expect(reactTriggers(heldDark, hold, reads(90)).fired).toBeNull();
  });
});

describe('reactTriggers: trees', () => {
  it('fires an OR on whichever card fires', () => {
    const tree: TriggerTree = { op: 'or', items: [turnsOn, sunset] };

    expect(
      reactTriggers(tree, { kind: 'time', path: 'triggers.1' }, { stateOf: statesOf(), now }).fired,
    ).toEqual({ kind: 'time', path: 'triggers.1' });
  });

  it('fires an AND when one card fires and the others hold right then', () => {
    const tree: TriggerTree = { op: 'and', items: [sunset, turnsOn] };
    const time: TriggerEvent = { kind: 'time', path: 'triggers.0' };

    expect(
      reactTriggers(tree, time, { stateOf: statesOf(motionState(true)), now }).fired,
    ).toMatchObject({ kind: 'time' });
    expect(
      reactTriggers(tree, time, { stateOf: statesOf(motionState(false)), now }).fired,
    ).toBeNull();
  });

  it('never fires an AND of two instants', () => {
    const tree: TriggerTree = { op: 'and', items: [sunset, { type: 'manual' }] };

    expect(reactTriggers(tree, { kind: 'manual' }, { stateOf: statesOf(), now }).fired).toBeNull();
  });

  it('counts a held card as satisfied only once it has lasted', () => {
    const tree: TriggerTree = {
      op: 'and',
      items: [sunset, { type: 'state', entityId: motion, to: 'on', forMs: 300_000 }],
    };
    const time: TriggerEvent = { kind: 'time', path: 'triggers.0' };
    const onSince = (ago: number): EntityState =>
      entityState(
        motion,
        { sensor_binary: { isOn: true } },
        { lastChanged: new Date(now.getTime() - ago) },
      );

    expect(reactTriggers(tree, time, { stateOf: statesOf(onSince(60_000)), now }).fired).toBeNull();
    expect(
      reactTriggers(tree, time, { stateOf: statesOf(onSince(600_000)), now }).fired,
    ).not.toBeNull();
  });

  it('reads a numeric card as satisfied while the comparison holds', () => {
    const tree: TriggerTree = { op: 'and', items: [sunset, dark] };

    expect(
      reactTriggers(
        tree,
        { kind: 'time', path: 'triggers.0' },
        {
          stateOf: statesOf(entityState(lux, { sensor_numeric: { value: 20 } })),
          now,
        },
      ).fired,
    ).not.toBeNull();
  });

  it('reads an OR inside an AND as satisfied when any of it is', () => {
    const tree: TriggerTree = {
      op: 'and',
      items: [sunset, { op: 'or', items: [turnsOn, dark] }],
    };

    expect(
      reactTriggers(
        tree,
        { kind: 'time', path: 'triggers.0' },
        {
          stateOf: statesOf(entityState(lux, { sensor_numeric: { value: 20 } })),
          now,
        },
      ).fired,
    ).not.toBeNull();
  });

  it('nests: an AND inside an OR', () => {
    const tree: TriggerTree = {
      op: 'or',
      items: [{ type: 'manual' }, { op: 'and', items: [sunset, turnsOn] }],
    };

    expect(
      reactTriggers(
        tree,
        { kind: 'time', path: 'triggers.1.0' },
        {
          stateOf: statesOf(motionState(true)),
          now,
        },
      ).fired,
    ).toEqual({ kind: 'time', path: 'triggers.1.0' });
  });

  it('wakes a manual trigger only when somebody asks, and never an event', () => {
    const context = { stateOf: statesOf(), now };

    expect(reactTriggers({ type: 'manual' }, { kind: 'manual' }, context).fired).toEqual({
      kind: 'manual',
      path: 'triggers',
    });
    expect(
      reactTriggers(
        { type: 'event', event: 'button.pressed', match: {} },
        { kind: 'manual' },
        context,
      ).fired,
    ).toBeNull();
  });

  it('lists leaves with their paths, and the entities it watches', () => {
    const tree: TriggerTree = {
      op: 'or',
      items: [turnsOn, { op: 'and', items: [sunset, dark] }],
    };

    expect(triggerLeaves(tree).map((ref) => ref.path)).toEqual([
      'triggers.0',
      'triggers.1.0',
      'triggers.1.1',
    ]);
    expect(entitiesOfTriggers(tree)).toEqual([motion, lux]);
  });
});
