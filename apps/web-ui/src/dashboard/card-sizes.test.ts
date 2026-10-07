import { describe, expect, it } from 'vitest';

import type { CapabilityName, EntityDomain } from '@nebulahome/contracts';

import { CARD_SIZES, cardKindOf, sizeName, snapSize, stepSize } from '@/dashboard/card-sizes';

/**
 * An entity reduced to what decides its card.
 *
 * @param domain - What kind of thing it is.
 * @param capabilities - What it can do.
 * @returns The entity.
 */
function entity(domain: EntityDomain, ...capabilities: CapabilityName[]) {
  return { domain, capabilities: capabilities.map((capability) => ({ capability, params: {} })) };
}

describe('snapSize', () => {
  const light = CARD_SIZES.light.sizes;

  it('settles a light dragged a little wider on the square', () => {
    expect(snapSize(light, 2, 2, 4)).toEqual({ w: 2, h: 2 });
    expect(snapSize(light, 2, 3, 4)).toEqual({ w: 2, h: 2 });
  });

  it('settles a corner dragged back up on the tile', () => {
    expect(snapSize(light, 1, 1, 4)).toEqual({ w: 1, h: 1 });
  });

  it('prefers the smaller size between two as near', () => {
    // 2x1 is one off both the tile and the square; the tile is smaller.
    expect(snapSize(light, 2, 1, 4)).toEqual({ w: 1, h: 1 });
  });

  it('never offers a size wider than the grid it sits on', () => {
    expect(snapSize(light, 2, 2, 1)).toEqual({ w: 1, h: 2 });
  });
});

describe('cardKindOf', () => {
  it('gives what is told rather than switched the entity page control on a card', () => {
    expect(cardKindOf(entity('vacuum', 'vacuum', 'on_off'))).toBe('control');
    expect(cardKindOf(entity('select', 'select'))).toBe('control');
    expect(cardKindOf(entity('update', 'update'))).toBe('control');
    expect(CARD_SIZES.control.preferred).toEqual({ w: 2, h: 2 });
  });

  it('draws the richest thing an entity can do', () => {
    expect(cardKindOf(entity('climate', 'on_off', 'thermostat'))).toBe('thermostat');
    expect(cardKindOf(entity('light', 'on_off', 'level'))).toBe('light');
    expect(cardKindOf(entity('switch', 'on_off'))).toBe('switch');
    expect(cardKindOf(entity('sensor', 'sensor_numeric'))).toBe('sensor');
    expect(cardKindOf(entity('binary_sensor', 'sensor_binary'))).toBe('binary');
    expect(cardKindOf(entity('media_player', 'media_player', 'on_off'))).toBe('media');
  });

  it('draws a light that only switches as a light', () => {
    expect(cardKindOf(entity('light', 'on_off'))).toBe('light');
  });

  it('falls back on the reading', () => {
    expect(cardKindOf(entity('alias'))).toBe('text');
  });
});

describe('sizeName', () => {
  it('names the sizes the picker offers', () => {
    expect(sizeName({ w: 1, h: 2 })).toBe('Card');
    expect(sizeName({ w: 3, h: 4 })).toBe('3×4');
  });
});

describe('stepSize', () => {
  const sensor = CARD_SIZES.sensor.sizes;

  it('goes up and down the sizes by the cells they cover', () => {
    expect(stepSize(sensor, { w: 1, h: 1 }, 1, 4)).toEqual({ w: 1, h: 2 });
    expect(stepSize(sensor, { w: 1, h: 2 }, 1, 4)).toEqual({ w: 2, h: 1 });
    expect(stepSize(sensor, { w: 2, h: 1 }, -1, 4)).toEqual({ w: 1, h: 2 });
  });

  it('stays put at either end', () => {
    expect(stepSize(sensor, { w: 2, h: 2 }, 1, 4)).toEqual({ w: 2, h: 2 });
    expect(stepSize(sensor, { w: 1, h: 1 }, -1, 4)).toEqual({ w: 1, h: 1 });
  });
});
