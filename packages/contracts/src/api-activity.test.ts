import { describe, expect, it } from 'vitest';

import { activityQuerySchema } from './api-activity.js';

describe('the activity of many entities', () => {
  it('reads a few entities from one comma-separated value', () => {
    const query = activityQuerySchema.parse({ entityIds: 'light.island,binary_sensor.front_door' });

    expect(query.entityIds).toEqual(['light.island', 'binary_sensor.front_door']);
  });

  it('is the whole house when narrowed by nothing', () => {
    expect(activityQuerySchema.parse({})).toEqual({});
  });

  it('refuses an address that is not one', () => {
    expect(activityQuerySchema.safeParse({ entityIds: 'not an entity' }).success).toBe(false);
  });
});
