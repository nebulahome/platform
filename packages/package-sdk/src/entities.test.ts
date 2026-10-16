import { describe, expect, it } from 'vitest';

import { ENTITY_DOMAINS as PLATFORM_DOMAINS } from '@nebulahome/contracts';

import { ENTITY_DOMAINS, isEntityId, parseEntityId } from './entities.js';

describe('entity identifiers', () => {
  it('know the platform’s domains', () => {
    expect([...ENTITY_DOMAINS]).toEqual([...PLATFORM_DOMAINS]);
  });

  it('are read back into their domain and object id', () => {
    expect(parseEntityId('sensor.weather_temperature')).toEqual({
      domain: 'sensor',
      objectId: 'weather_temperature',
    });
    expect(parseEntityId('custom.music_player_queue')).toEqual({
      domain: 'custom',
      objectId: 'music_player_queue',
    });
    expect(parseEntityId('sensor.3d_home_kitchen_temperature')).toEqual({
      domain: 'sensor',
      objectId: '3d_home_kitchen_temperature',
    });
  });

  it('refuse what the platform would not take', () => {
    expect(parseEntityId('weather')).toBeUndefined();
    expect(parseEntityId('teapot.kitchen')).toBeUndefined();
    expect(parseEntityId('sensor.Kitchen')).toBeUndefined();
    expect(isEntityId('switch.hall_light')).toBe(true);
    expect(isEntityId(42)).toBe(false);
  });
});
