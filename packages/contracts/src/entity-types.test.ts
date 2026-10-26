import { describe, expect, it } from 'vitest';

import { BINARY_SENSOR_CLASSES, shownAsOptions } from './entity-types.js';

describe('shownAsOptions', () => {
  it('swaps a switch and a light, whatever else the light can do', () => {
    expect(shownAsOptions({ domain: 'switch', deviceClass: 'outlet' }, ['on_off'])).toEqual([
      { domain: 'light', deviceClass: null },
    ]);
    expect(shownAsOptions({ domain: 'light', deviceClass: null }, ['on_off', 'level'])).toEqual([
      { domain: 'switch', deviceClass: null },
    ]);
  });

  it('offers a binary sensor every other class', () => {
    const options = shownAsOptions({ domain: 'binary_sensor', deviceClass: 'motion' }, [
      'sensor_binary',
    ]);

    expect(options).toHaveLength(BINARY_SENSOR_CLASSES.length - 1);
    expect(options).toContainEqual({ domain: 'binary_sensor', deviceClass: 'presence' });
    expect(options).not.toContainEqual({ domain: 'binary_sensor', deviceClass: 'motion' });
    expect(
      shownAsOptions({ domain: 'binary_sensor', deviceClass: null }, ['sensor_binary']),
    ).toHaveLength(BINARY_SENSOR_CLASSES.length);
  });

  it('offers nothing for the other kinds, or without the capability that makes them alike', () => {
    expect(shownAsOptions({ domain: 'sensor', deviceClass: 'power' }, ['sensor_numeric'])).toEqual(
      [],
    );
    expect(shownAsOptions({ domain: 'switch', deviceClass: null }, ['button'])).toEqual([]);
  });
});
