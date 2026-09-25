/**
 * Sharing a house's power out along its wires, and adding up its day.
 */
import { describe, expect, it } from 'vitest';

import {
  energyOf,
  energyToday,
  flowsOf,
  formatPower,
  headlineOf,
  mainSource,
  toWatts,
} from './energy-flow';

describe('flowsOf', () => {
  it('feeds the house from the panels first, then charges the battery with the rest', () => {
    // The photo the card is drawn after: 11.1 kW made, 8.3 kW into the battery, 2.8 kW used.
    const flows = flowsOf({ solar: 11_100, battery: -8300, grid: 0, home: 2800 });

    expect(flows).toMatchObject({
      solarToHome: 2800,
      solarToBattery: 8300,
      solarToGrid: 0,
      gridToHome: 0,
      home: 2800,
    });
  });

  it('sells what the panels make beyond what the house and the battery take', () => {
    const flows = flowsOf({ solar: 5000, battery: -1000, grid: -3000, home: null });

    expect(flows).toMatchObject({ solarToGrid: 3000, solarToBattery: 1000, solarToHome: 1000 });
    expect(flows.home).toBe(1000);
  });

  it('runs the house on the battery at night, and buys the rest', () => {
    const flows = flowsOf({ solar: 0, battery: 600, grid: 400, home: null });

    expect(flows).toMatchObject({ batteryToHome: 600, gridToHome: 400, home: 1000 });
  });

  it('charges the battery from the grid when the panels cannot', () => {
    const flows = flowsOf({ solar: 200, battery: -1000, grid: 1300, home: 500 });

    expect(flows).toMatchObject({ solarToBattery: 200, gridToBattery: 800, gridToHome: 500 });
  });

  it('works with no panels and no battery at all', () => {
    expect(flowsOf({ solar: null, battery: null, grid: 750, home: null })).toMatchObject({
      gridToHome: 750,
      home: 750,
    });
  });
});

describe('headlineOf', () => {
  it('leads with the battery, then with selling, then with where the house draws from', () => {
    expect(headlineOf({ solar: 11_100, battery: -8300, grid: 0, home: null })).toBe('charging');
    expect(headlineOf({ solar: 0, battery: 900, grid: 0, home: null })).toBe('discharging');
    expect(headlineOf({ solar: 4000, battery: null, grid: -1500, home: null })).toBe('exporting');
    expect(headlineOf({ solar: 1200, battery: 0, grid: 3, home: null })).toBe('self-powered');
    expect(headlineOf({ solar: 0, battery: null, grid: 800, home: null })).toBe('importing');
    expect(headlineOf({ solar: null, battery: null, grid: 2, home: null })).toBe('idle');
  });
});

describe('mainSource', () => {
  it('names the source giving most, and none when nothing is worth drawing', () => {
    expect(mainSource({ solar: 2800, grid: 400 })).toBe('solar');
    expect(mainSource({ solar: 2, battery: 4 })).toBeNull();
  });
});

describe('units', () => {
  it('reads kilowatts as watts, and writes a kilowatt and more to one decimal', () => {
    expect(toWatts(1.5, 'kW')).toBe(1500);
    expect(toWatts(700, null)).toBe(700);
    expect(formatPower(11_100)).toEqual({ value: '11.1', unit: 'kW' });
    expect(formatPower(-640.4)).toEqual({ value: '640', unit: 'W' });
  });
});

describe('the day', () => {
  const start = new Date('2026-09-25T10:00:00.000Z').getTime();

  /**
   * One reading a minute, from the start.
   *
   * @param values - The minute averages, in watts.
   * @returns The readings.
   */
  const minutes = (values: readonly number[]) =>
    values.map((value, index) => ({ time: new Date(start + index * 60_000), value }));

  it('adds up a minute average as a minute of energy, each way apart', () => {
    const { positive, negative } = energyOf(
      { points: minutes([6000, -6000]), sign: 1, unit: 'W' },
      start + 120_000,
    );

    expect(positive).toBeCloseTo(0.1, 5);
    expect(negative).toBeCloseTo(0.1, 5);
  });

  it('counts a gap in the readings as nothing', () => {
    const points = [
      { time: new Date(start), value: 6000 },
      { time: new Date(start + 3_600_000), value: 0 },
    ];

    expect(energyOf({ points, sign: 1, unit: 'W' }, start + 3_660_000).positive).toBeCloseTo(
      0.1,
      5,
    );
  });

  it('says how much of the day the house ran on its own power', () => {
    const today = energyToday(
      {
        solar: { points: minutes([3000, 3000]), sign: 1, unit: 'W' },
        battery: null,
        grid: { points: minutes([1000, 1000]), sign: 1, unit: 'W' },
        home: null,
      },
      start + 120_000,
    );

    expect(today.generated).toBeCloseTo(0.1, 5);
    expect(today.used).toBeCloseTo(0.1333, 3);
    expect(today.selfPowered).toBe(75);
  });

  it('turns a meter that counts the other way round', () => {
    const today = energyToday(
      {
        solar: null,
        battery: null,
        grid: { points: minutes([-1200]), sign: -1, unit: 'W' },
        home: null,
      },
      start + 60_000,
    );

    expect(today.bought).toBeCloseTo(0.02, 5);
    expect(today.selfPowered).toBeNull();
  });
});
