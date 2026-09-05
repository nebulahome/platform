import { beforeEach, describe, expect, it } from 'vitest';

import { parseEntityId, type EntityState, type StateReport } from '@nebula-home/contracts';

import { EntityRegistry } from './entity-registry.js';

const thermometer = parseEntityId('sensor.kitchen_temperature');
const bulb = parseEntityId('light.kitchen_ceiling');

const T0 = new Date('2026-09-04T10:00:00.000Z');
const T1 = new Date('2026-09-04T10:00:30.000Z');
const T2 = new Date('2026-09-04T10:01:00.000Z');

describe('EntityRegistry', () => {
  let clock: Date;
  let registry: EntityRegistry;

  beforeEach(() => {
    clock = T0;
    registry = new EntityRegistry(() => clock);
  });

  /**
   * Applies a report from the fake MQTT adapter.
   *
   * @param report - What was observed.
   * @returns What the report did.
   */
  const report = (report: StateReport): ReturnType<EntityRegistry['apply']> =>
    registry.apply(report, { source: 'pkg-mqtt' });

  it('treats the first report as a change', () => {
    const result = report({ entityId: bulb, state: { on_off: { isOn: true } } });

    expect(result.hasStateChanged).toBe(true);
    expect(result.previous).toBeUndefined();
    expect(result.current.lastChanged).toStrictEqual(T0);
    expect(result.current.lastUpdated).toStrictEqual(T0);
  });

  it('moves lastUpdated but not lastChanged when a sensor repeats itself', () => {
    // The distinction the whole ingest pipeline exists to preserve: a thermometer reporting the
    // same value every thirty seconds updated, but nothing changed.
    report({ entityId: thermometer, state: { sensor_numeric: { value: 21.5 } } });

    clock = T1;
    const second = report({ entityId: thermometer, state: { sensor_numeric: { value: 21.5 } } });

    expect(second.hasStateChanged).toBe(false);
    expect(second.isNotable).toBe(false);
    expect(second.current.lastChanged).toStrictEqual(T0);
    expect(second.current.lastUpdated).toStrictEqual(T1);
  });

  it('moves both when the value actually differs', () => {
    report({ entityId: thermometer, state: { sensor_numeric: { value: 21.5 } } });

    clock = T1;
    const second = report({ entityId: thermometer, state: { sensor_numeric: { value: 21.9 } } });

    expect(second.hasStateChanged).toBe(true);
    expect(second.current.lastChanged).toStrictEqual(T1);
    expect(second.previous?.state).toStrictEqual({ sensor_numeric: { value: 21.5 } });
  });

  it('prefers the time the device observed over the time we received it', () => {
    const observedAt = new Date('2026-09-04T09:59:00.000Z');
    const result = report({
      entityId: thermometer,
      state: { sensor_numeric: { value: 21.5 } },
      observedAt,
    });

    expect(result.current.lastUpdated).toStrictEqual(observedAt);
  });

  it('merges a partial report into what it already knows', () => {
    report({
      entityId: bulb,
      state: {
        on_off: { isOn: true },
        level: { level: 80 },
        color_hs: { hue: 30, saturation: 60 },
      },
    });

    clock = T1;
    const dimmed = report({ entityId: bulb, state: { level: { level: 20 } } });

    expect(dimmed.current.state).toStrictEqual({
      on_off: { isOn: true },
      level: { level: 20 },
      color_hs: { hue: 30, saturation: 60 },
    });
  });

  it('treats becoming unreachable as notable but not as a state change', () => {
    // The light has the same state it had a second ago, and the interface still has to grey it
    // out - which is why the two flags are separate.
    report({ entityId: bulb, state: { on_off: { isOn: true } } });

    clock = T1;
    const lost = report({ entityId: bulb, state: {}, isAvailable: false });

    expect(lost.hasStateChanged).toBe(false);
    expect(lost.hasAvailabilityChanged).toBe(true);
    expect(lost.isNotable).toBe(true);
    expect(lost.current.lastChanged).toStrictEqual(T0);
  });

  it('keeps the last known values while unreachable', () => {
    // "The thermostat was at 19 degrees when we lost it" is more useful than a blank card.
    report({ entityId: thermometer, state: { sensor_numeric: { value: 19 } } });
    registry.setAvailability(thermometer, false);

    expect(registry.get(thermometer)?.state).toStrictEqual({ sensor_numeric: { value: 19 } });
    expect(registry.get(thermometer)?.isAvailable).toBe(false);
  });

  it('reports nothing when availability did not actually change', () => {
    report({ entityId: bulb, state: { on_off: { isOn: true } } });

    expect(registry.setAvailability(bulb, true)).toBeUndefined();
  });

  it('reports nothing for an entity it has never heard of', () => {
    expect(registry.setAvailability(bulb, false)).toBeUndefined();
  });

  it('notices a change in the free-form attributes', () => {
    report({ entityId: bulb, state: { on_off: { isOn: true } }, attributes: { rssi: -60 } });

    clock = T1;
    const moved = report({
      entityId: bulb,
      state: { on_off: { isOn: true } },
      attributes: { rssi: -80 },
    });

    expect(moved.hasStateChanged).toBe(false);
    expect(moved.haveAttributesChanged).toBe(true);
    expect(moved.isNotable).toBe(true);
  });

  it('seeds a stored state without treating it as news', () => {
    // Announcing recovered rows as state changes would fire every automation in the house on
    // every restart.
    const stored: EntityState = {
      entityId: bulb,
      state: { on_off: { isOn: true } },
      attributes: {},
      isAvailable: true,
      lastChanged: T0,
      lastUpdated: T0,
      source: 'pkg-mqtt',
    };

    registry.seed(stored);

    expect(registry.get(bulb)).toStrictEqual(stored);
    expect(registry.size).toBe(1);
  });

  it('lists what one adapter owns, which is what a resynchronisation needs', () => {
    report({ entityId: bulb, state: { on_off: { isOn: true } } });
    registry.apply(
      { entityId: thermometer, state: { sensor_numeric: { value: 21 } } },
      { source: 'pkg-wifi' },
    );

    expect(registry.entitiesOf('pkg-mqtt')).toStrictEqual([bulb]);
    expect(registry.entitiesOf('pkg-wifi')).toStrictEqual([thermometer]);
  });

  it('carries the cause of a change through to the state', () => {
    // What makes "why did this light turn on?" answerable rather than a guess.
    const runId = '01234567-89ab-4cde-8f01-23456789abcd';
    const result = registry.apply(
      { entityId: bulb, state: { on_off: { isOn: true } } },
      { source: 'pkg-mqtt', context: { type: 'automation', id: runId } },
    );

    expect(result.current.context).toStrictEqual({ type: 'automation', id: runId });
  });

  it('snapshots everything it holds', () => {
    report({ entityId: bulb, state: { on_off: { isOn: true } } });
    clock = T2;
    report({ entityId: thermometer, state: { sensor_numeric: { value: 21 } } });

    expect(registry.snapshot().map((state) => state.entityId)).toStrictEqual([bulb, thermometer]);
  });
});
