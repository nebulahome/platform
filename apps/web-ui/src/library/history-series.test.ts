/**
 * State history becoming the band and the line on an entity's page.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type JsonObject, type StateHistoryPoint } from '@nebulahome/contracts';

import { anEntity } from '@/testing/fixtures';

import {
  numericFieldsOf,
  numericSeries,
  stateSegments,
  telemetryResolutionFor,
  windowOf,
  windowOfChoice,
} from './history-series';

const LAMP = entityIdSchema.parse('light.desk');

/**
 * One recorded change.
 *
 * @param at - When, in milliseconds since the epoch.
 * @param state - What it became.
 * @param previousState - What it was.
 * @returns The point.
 */
function change(
  at: number,
  state: JsonObject,
  previousState: JsonObject | null,
): StateHistoryPoint {
  return {
    time: new Date(at),
    entityId: LAMP,
    state,
    previousState,
    attributes: {},
    isAvailable: true,
    source: 'shelly-desk',
  };
}

/**
 * Puts a state into words, as the page does, but shortly.
 *
 * @param state - The state.
 * @returns "On" or "Off".
 */
function words(state: JsonObject | null): string {
  return JSON.stringify(state).includes('"isOn":true') ? 'On' : 'Off';
}

describe('the window', () => {
  const now = 100 * 86_400_000;

  it('ends now and reads a day in minutes and a month in hours', () => {
    expect(windowOf('1h', 10_000_000)).toEqual({ from: 6_400_000, to: 10_000_000 });
    expect(telemetryResolutionFor(windowOf('1h', now))).toBe('raw');
    expect(telemetryResolutionFor(windowOf('6h', now))).toBe('1m');
    expect(telemetryResolutionFor(windowOf('24h', now))).toBe('1m');
    expect(telemetryResolutionFor(windowOf('7d', now))).toBe('1h');
    expect(telemetryResolutionFor(windowOf('30d', now))).toBe('1h');
  });

  it('takes a stretch chosen by its ends as it is, and reads a long one in days', () => {
    const custom = { kind: 'custom', from: 1_000, to: 91 * 86_400_000 } as const;

    expect(windowOfChoice(custom, now)).toEqual({ from: 1_000, to: 91 * 86_400_000 });
    expect(windowOfChoice({ kind: 'preset', range: '1h' }, now)).toEqual(windowOf('1h', now));
    expect(telemetryResolutionFor(windowOfChoice(custom, now))).toBe('1d');
  });
});

describe('stateSegments', () => {
  const window = { from: 0, to: 1000 };

  it('starts the band at the left edge with what the lamp was before its first change', () => {
    const points = [
      change(400, { on_off: { isOn: true } }, { on_off: { isOn: false } }),
      change(700, { on_off: { isOn: false } }, { on_off: { isOn: true } }),
    ];

    expect(
      stateSegments(points, window, { state: null, isAvailable: true }, words).map((segment) => [
        segment.from,
        segment.to,
        segment.label,
        segment.isActive,
      ]),
    ).toEqual([
      [0, 400, 'Off', false],
      [400, 700, 'On', true],
      [700, 1000, 'Off', false],
    ]);
  });

  it('fills the whole window with the state now when nothing changed', () => {
    const segments = stateSegments(
      [],
      window,
      { state: { on_off: { isOn: true } }, isAvailable: true },
      words,
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ from: 0, to: 1000, isActive: true });
  });

  it('draws nothing for a state with no on and off in it', () => {
    expect(
      stateSegments(
        [],
        window,
        { state: { sensor_numeric: { value: 3 } }, isAvailable: true },
        words,
      ),
    ).toEqual([]);
  });
});

describe('numericSeries', () => {
  const lamp = anEntity({
    entityId: 'light.desk',
    capabilities: [
      { capability: 'on_off', params: {} },
      { capability: 'level', params: {} },
      { capability: 'color_temp', params: { minMireds: 153, maxMireds: 370 } },
    ],
  });

  it('finds the numbers a lamp carries, in kelvin rather than mireds', () => {
    const fields = numericFieldsOf(lamp);

    expect(fields.map((field) => [field.label, field.unit])).toEqual([
      ['Brightness', '%'],
      ['Colour temperature', 'K'],
    ]);
    expect(fields[1]?.read({ color_temp: { mireds: 250 } })).toBe(4000);
  });

  it('holds a value from the left edge to the right one', () => {
    const fields = numericFieldsOf(lamp);
    const points = [change(500, { level: { level: 80 } }, { level: { level: 20 } })];

    expect(numericSeries(points, fields, { from: 0, to: 1000 }, null)).toEqual([
      { at: 0, f0: 20, f1: null },
      { at: 500, f0: 80, f1: null },
      { at: 1000, f0: 80, f1: null },
    ]);
  });
});
