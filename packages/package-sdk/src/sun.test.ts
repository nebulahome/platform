import { describe, expect, it } from 'vitest';

import * as platform from '@nebulahome/contracts';

import {
  SUN_AZIMUTH_ENTITY_ID,
  SUN_ELEVATION_ENTITY_ID,
  sunPhaseLabel,
  sunPosition,
  sunState,
  sunTimes,
} from './sun.js';

const turin = { latitude: 45.07, longitude: 7.69 };

describe('the sun', () => {
  it('stands where the platform says it does', () => {
    for (const at of [
      new Date('2026-03-20T12:00:00Z'),
      new Date('2026-06-21T05:30:00Z'),
      new Date('2026-12-21T16:00:00Z'),
    ]) {
      expect(sunPosition(at, turin)).toEqual(platform.sunPosition(at, turin));
      expect(sunTimes(at, turin)).toEqual(platform.sunTimes(at, turin));
      expect(sunPhaseLabel(sunState(at, turin))).toBe(
        platform.sunPhaseLabel(platform.sunState(at, turin)),
      );
    }
  });

  it('is high in the south at noon in summer, and under the horizon at midnight', () => {
    const noon = sunPosition(new Date('2026-06-21T11:30:00Z'), turin);
    const midnight = sunPosition(new Date('2026-06-21T23:30:00Z'), turin);

    expect(noon.elevation).toBeGreaterThan(60);
    expect(noon.azimuth).toBeGreaterThan(150);
    expect(noon.azimuth).toBeLessThan(210);
    expect(midnight.elevation).toBeLessThan(0);
  });

  it('names the entities the platform reports it on', () => {
    expect([SUN_ELEVATION_ENTITY_ID, SUN_AZIMUTH_ENTITY_ID]).toEqual([
      platform.SUN_ELEVATION_ENTITY_ID,
      platform.SUN_AZIMUTH_ENTITY_ID,
    ]);
  });
});
