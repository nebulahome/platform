import { describe, expect, it } from 'vitest';

import type { CapabilityName, EntityDomain } from '@nebulahome/contracts';

import {
  allowedSizes,
  CARD_SIZES,
  cardKindOf,
  missingSizes,
  sizeName,
  snapSize,
  stepSize,
} from '@/dashboard/card-sizes';

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
  it('gives what is told rather than switched a card of its own, at the sizes its board draws', () => {
    expect(cardKindOf(entity('vacuum', 'vacuum', 'on_off'))).toBe('vacuum');
    expect(cardKindOf(entity('lawn_mower', 'lawn_mower'))).toBe('mower');
    expect(cardKindOf(entity('select', 'select'))).toBe('select');
    expect(cardKindOf(entity('number', 'number'))).toBe('number');
    expect(cardKindOf(entity('button', 'button'))).toBe('button');
    expect(cardKindOf(entity('update', 'update'))).toBe('update');
    expect(cardKindOf(entity('image', 'image'))).toBe('picture');
    expect(cardKindOf(entity('custom', 'custom'))).toBe('custom');
    expect(CARD_SIZES.vacuum.sizes.map(sizeName)).toEqual(['1×1', '1×2', '2×2']);
    expect(CARD_SIZES.button.sizes.map(sizeName)).toEqual(['1×1']);
    expect(CARD_SIZES.picture.sizes.map(sizeName)).toEqual(['2×2', '2×3']);
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

  it('gives a fan, a time and a person their own cards', () => {
    expect(cardKindOf(entity('fan', 'on_off', 'fan'))).toBe('fan');
    expect(cardKindOf(entity('time', 'time_of_day'))).toBe('time');
    expect(cardKindOf(entity('time', 'date'))).toBe('time');
    expect(cardKindOf(entity('time', 'datetime'))).toBe('time');
    expect(cardKindOf(entity('device_tracker', 'location'))).toBe('person');
    expect(CARD_SIZES.fan.sizes.map(sizeName)).toEqual(['1×1', '1×2', '2×2']);
    expect(CARD_SIZES.time.sizes.map(sizeName)).toEqual(['1×1', '2×1']);
    expect(CARD_SIZES.person.sizes.map(sizeName)).toEqual(['1×1', '1×2', '2×2']);
  });

  it('offers no square to a fan that only switches', () => {
    const onOff = entity('fan', 'on_off', 'fan');
    const withSpeeds = {
      domain: 'fan' as const,
      capabilities: [
        { capability: 'on_off' as const, params: {} },
        { capability: 'fan' as const, params: { speedCount: 3 } },
      ],
    };

    expect(allowedSizes(onOff).map(sizeName)).toEqual(['1×1', '1×2']);
    expect(missingSizes(onOff).map((each) => sizeName(each.size))).toEqual(['2×2']);
    expect(allowedSizes(withSpeeds).map(sizeName)).toEqual(['1×1', '1×2', '2×2']);
  });

  it('falls back on the reading', () => {
    expect(cardKindOf(entity('alias'))).toBe('text');
  });
});

describe('sizeName', () => {
  it('names the sizes the picker offers', () => {
    expect(sizeName({ w: 1, h: 2 })).toBe('1×2');
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
