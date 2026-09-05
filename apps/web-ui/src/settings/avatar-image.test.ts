/**
 * Preparing a chosen picture.
 *
 * Only the geometry is tested here. The rest of the module is a canvas and an encoder, neither
 * of which jsdom has, and standing up a fake for both would test the fake. What can go wrong
 * without a browser noticing is the crop: an off-centre square is a face with its chin cut off,
 * and it looks deliberate enough that nobody reports it.
 */
import { describe, expect, it } from 'vitest';

import { centreCrop } from '@/settings/avatar-image';

describe('centreCrop', () => {
  it('takes the whole thing when it is already square', () => {
    expect(centreCrop(512, 512)).toEqual({ x: 0, y: 0, side: 512 });
  });

  it('trims the sides of a landscape picture evenly', () => {
    expect(centreCrop(800, 600)).toEqual({ x: 100, y: 0, side: 600 });
  });

  it('trims the top and bottom of a portrait picture evenly', () => {
    // A phone photograph is this shape, and the interesting part is in the middle.
    expect(centreCrop(1080, 1920)).toEqual({ x: 0, y: 420, side: 1080 });
  });

  it('keeps the largest square that fits', () => {
    const crop = centreCrop(1000, 400);

    expect(crop.side).toBe(400);
    expect(crop.x * 2 + crop.side).toBe(1000);
  });

  it('handles an odd difference without drifting off the edge', () => {
    const crop = centreCrop(101, 51);

    expect(crop.side).toBe(51);
    expect(crop.x).toBe(25);
    expect(crop.x + crop.side).toBeLessThanOrEqual(101);
  });
});
