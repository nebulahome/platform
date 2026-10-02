/**
 * The filters of the lists that had none, and the way each lives in the address.
 */
import { describe, expect, it } from 'vitest';

import type { SceneView } from '@nebulahome/contracts';

import {
  matchesSceneFilter,
  OPEN_PEOPLE_FILTER,
  OPEN_SCENE_FILTER,
  packageFilterCodec,
  PEOPLE_FILTER_CODEC,
  SCENE_FILTER_CODEC,
  searchAndFacetCodec,
  VENDOR_DEVICE_FILTER_CODEC,
} from './list-filters';

/** A scene placed in the lounge. */
const EVENING = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  key: 'evening',
  name: 'Evening',
  icon: null,
  areaKey: 'lounge',
  transitionMs: 0,
  rollbackOnPartialFailure: false,
  members: [],
} as unknown as SceneView;

describe('matchesSceneFilter', () => {
  it('finds a scene by its area and by what it sets', () => {
    expect(
      matchesSceneFilter(
        EVENING,
        { ...OPEN_SCENE_FILTER, search: 'lounge' },
        { areaName: 'Lounge' },
      ),
    ).toBe(true);
    expect(
      matchesSceneFilter(
        EVENING,
        { ...OPEN_SCENE_FILTER, search: 'floor lamp' },
        { memberNames: ['Floor lamp'] },
      ),
    ).toBe(true);
    expect(matchesSceneFilter(EVENING, { ...OPEN_SCENE_FILTER, search: 'morning' })).toBe(false);
  });

  it('narrows by area', () => {
    expect(matchesSceneFilter(EVENING, { ...OPEN_SCENE_FILTER, areaKey: 'lounge' })).toBe(true);
    expect(matchesSceneFilter(EVENING, { ...OPEN_SCENE_FILTER, areaKey: 'kitchen' })).toBe(false);
  });
});

describe('the codecs', () => {
  it('round-trip what they hold and leave the defaults out of the address', () => {
    const scene = { search: 'evening', areaKey: 'lounge' };

    expect(SCENE_FILTER_CODEC.read(new URLSearchParams(SCENE_FILTER_CODEC.write(scene)))).toEqual(
      scene,
    );
    expect(PEOPLE_FILTER_CODEC.write(OPEN_PEOPLE_FILTER)).toEqual({});
    expect(searchAndFacetCodec('used').write({ search: '', facet: 'no' })).toEqual({ used: 'no' });
  });

  it('read an unknown value as its default rather than as a filter nothing matches', () => {
    expect(
      packageFilterCodec(['running', 'failed']).read(new URLSearchParams({ state: 'exploded' }))
        .state,
    ).toBe('');
    expect(VENDOR_DEVICE_FILTER_CODEC.read(new URLSearchParams({ standing: '?' })).standing).toBe(
      'any',
    );
  });
});
