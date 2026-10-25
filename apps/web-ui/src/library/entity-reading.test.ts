/**
 * States becoming words, and words becoming a device's standing.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type EntityView } from '@nebulahome/contracts';

import { numberFormat } from '@/i18n/formatters';

import {
  describeState,
  NO_READING,
  readingOf,
  sensorFigureOf,
  standingOf,
  type Reading,
} from './entity-reading';

/**
 * A figure as the reader's language writes it (English, with its region from this machine).
 *
 * @param value - The number.
 * @returns "42.26", or however the reader's English writes it.
 */
function figure(value: number): string {
  return numberFormat({ maximumFractionDigits: 2 }).format(value);
}

/**
 * An entity as the API serves it, for tests that vary the state.
 *
 * @param overrides - What differs from a nozzle thermometer that has reported once.
 * @returns The entity.
 */
function entity(overrides: Partial<EntityView> = {}): EntityView {
  return {
    entityId: entityIdSchema.parse('sensor.p1s_nozzle_temperature'),
    domain: 'sensor',
    name: 'Nozzle temperature',
    icon: null,
    areaKey: null,
    areaName: null,
    deviceId: '00000000-0000-4000-8000-000000000010',
    source: 'bambu-lab-1',
    unitOfMeasurement: '°C',
    deviceClass: 'temperature',
    isEnabled: true,
    isHidden: false,
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    searchAliases: [],
    state: { sensor_numeric: { value: 215 } },
    attributes: {},
    isAvailable: true,
    lastChanged: new Date('2026-09-12T00:00:00.000Z'),
    lastUpdated: new Date('2026-09-12T00:00:05.000Z'),
    tagIds: [],
    addresses: [],
    linked: null,
    key: null,
    createdAt: null,
    ...overrides,
  };
}

describe('describeState', () => {
  it('writes a numeric reading with its unit, and a percentage without a space', () => {
    expect(describeState({ sensor_numeric: { value: 215 } }, entity())).toBe('215 °C');
    expect(
      describeState({ sensor_numeric: { value: 87 } }, entity({ unitOfMeasurement: '%' })),
    ).toBe('87%');
    expect(
      describeState({ sensor_numeric: { value: 42.256 } }, entity({ unitOfMeasurement: 'lx' })),
    ).toBe(`${figure(42.26)} lx`);
  });

  it('uses the words the device class calls for on a binary sensor', () => {
    expect(
      describeState({ sensor_binary: { isOn: true } }, entity({ deviceClass: 'running' })),
    ).toBe('Running');
    expect(
      describeState({ sensor_binary: { isOn: false } }, entity({ deviceClass: 'motion' })),
    ).toBe('Clear');
    expect(describeState({ sensor_binary: { isOn: true } }, entity({ deviceClass: null }))).toBe(
      'On',
    );
  });

  it('joins the capabilities of a light in order', () => {
    expect(describeState({ on_off: { isOn: true }, level: { level: 60 } }, entity())).toBe(
      'On · 60%',
    );
  });

  it('describes a thermostat by where it is, where it is going, and what it is doing', () => {
    expect(
      describeState(
        {
          thermostat: {
            currentTemperature: 21.5,
            targetTemperature: 22,
            mode: 'heat',
            action: 'heating',
          },
        },
        entity(),
      ),
    ).toBe(`${figure(21.5)} °C → 22 °C · Heating`);
  });

  it('shows a dash for an entity that has never reported, or reported nonsense', () => {
    expect(describeState(null, entity())).toBe(NO_READING);
    expect(describeState({ sensor_numeric: { value: 'hot' } }, entity())).toBe(NO_READING);
    expect(describeState({}, entity())).toBe(NO_READING);
  });

  it('splits a catalogue numeric reading for the devices row', () => {
    expect(
      sensorFigureOf(
        { sensor_numeric: { value: 0.09 } },
        entity({
          deviceClass: 'current',
          unitOfMeasurement: 'A',
        }),
      ),
    ).toEqual({
      figure: figure(0.09),
      unit: 'A',
      classLabel: 'Current',
    });
    expect(
      sensorFigureOf(
        { sensor_numeric: { value: 87 } },
        entity({ deviceClass: null, unitOfMeasurement: '%' }),
      ),
    ).toBeNull();
    expect(
      sensorFigureOf({ sensor_binary: { isOn: true } }, entity({ deviceClass: 'running' })),
    ).toBeNull();
  });
});

describe('readingOf', () => {
  it('prefers what the channel said over what the page loaded with', () => {
    const reading = readingOf(entity(), {
      state: { sensor_numeric: { value: 220 } },
      attributes: {},
      isAvailable: true,
      changedAt: new Date('2026-09-12T00:01:00.000Z'),
      receivedAt: Date.parse('2026-09-12T00:01:00.500Z'),
    });

    expect(reading.text).toBe('220 °C');
    expect(reading.isLive).toBe(true);
    expect(reading.at).toEqual(new Date('2026-09-12T00:01:00.500Z'));
  });

  it('falls back to the page when the channel has said nothing', () => {
    const reading = readingOf(entity(), undefined);

    expect(reading.text).toBe('215 °C');
    expect(reading.isLive).toBe(false);
    expect(reading.at).toEqual(new Date('2026-09-12T00:00:05.000Z'));
  });
});

describe('standingOf', () => {
  /**
   * A reading, for tests that vary reachability and time.
   *
   * @param isAvailable - Whether the device could be reached.
   * @param at - When it spoke.
   * @returns The reading.
   */
  function reading(isAvailable: boolean, at: Date | null): Reading {
    return { text: '1', isAvailable, isUpdating: false, at, isLive: false, sensorFigure: null };
  }

  it('is reporting when any entity is reachable and has spoken, as of the newest of them', () => {
    const standing = standingOf(
      [
        reading(true, new Date('2026-09-12T00:00:05.000Z')),
        reading(false, new Date('2026-09-12T00:00:09.000Z')),
      ],
      null,
    );

    expect(standing.isReporting).toBe(true);
    expect(standing.lastSeenAt).toEqual(new Date('2026-09-12T00:00:09.000Z'));
  });

  it('is silent when nothing has spoken, and keeps what the registry recorded', () => {
    const recorded = new Date('2026-09-11T00:00:00.000Z');
    const standing = standingOf([reading(true, null)], recorded);

    expect(standing.isReporting).toBe(false);
    expect(standing.lastSeenAt).toBe(recorded);
  });
});
