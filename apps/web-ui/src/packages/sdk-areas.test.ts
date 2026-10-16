/**
 * The areas as a package sees them: each names its parent by key, the way an entity names its
 * area, never by the API's ids.
 */
import { describe, expect, it } from 'vitest';

import { areaViewsOf } from '@/packages/sdk-areas';

const HOUSE = '0199f0e0-0000-7000-8000-000000000001';
const GROUND = '0199f0e0-0000-7000-8000-000000000002';

describe('areaViewsOf', () => {
  it('names each parent by its key, and keeps the owner’s order', () => {
    const base = { icon: null, deviceCount: 0, entityCount: 0 };

    expect(
      areaViewsOf([
        {
          ...base,
          id: HOUSE,
          key: 'home',
          name: 'Home',
          kind: 'house',
          parentId: null,
          sortOrder: 0,
          level: null,
          latitude: 45.07,
          longitude: 7.69,
        },
        {
          ...base,
          id: GROUND,
          key: 'ground_floor',
          name: 'Ground floor',
          kind: 'floor',
          parentId: HOUSE,
          sortOrder: 0,
          level: 0,
          latitude: null,
          longitude: null,
        },
        {
          ...base,
          id: '0199f0e0-0000-7000-8000-000000000003',
          key: 'kitchen',
          name: 'Kitchen',
          kind: 'room',
          parentId: GROUND,
          sortOrder: 1,
          level: null,
          latitude: null,
          longitude: null,
        },
      ]),
    ).toEqual([
      {
        key: 'home',
        name: 'Home',
        kind: 'house',
        parentKey: null,
        icon: null,
        sortOrder: 0,
        level: null,
        latitude: 45.07,
        longitude: 7.69,
      },
      {
        key: 'ground_floor',
        name: 'Ground floor',
        kind: 'floor',
        parentKey: 'home',
        icon: null,
        sortOrder: 0,
        level: 0,
        latitude: null,
        longitude: null,
      },
      {
        key: 'kitchen',
        name: 'Kitchen',
        kind: 'room',
        parentKey: 'ground_floor',
        icon: null,
        sortOrder: 1,
        level: null,
        latitude: null,
        longitude: null,
      },
    ]);
  });
});
