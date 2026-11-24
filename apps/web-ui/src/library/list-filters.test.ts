/**
 * The filters of the lists that had none, and the way each lives in the address.
 */
import { describe, expect, it } from 'vitest';

import type { SceneView } from '@nebulahome/contracts';

import {
  matchesSceneFilter,
  OPEN_PACKAGE_FILTER,
  OPEN_PEOPLE_FILTER,
  OPEN_SCENE_FILTER,
  packageFilterCodec,
  PEOPLE_FILTER_CODEC,
  SCENE_FILTER_CODEC,
  sceneNarrowingCount,
  searchAndFacetCodec,
} from './list-filters';

/** A scene placed in the lounge. */
const EVENING = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  key: 'evening',
  name: 'Evening',
  icon: null,
  areaKey: 'lounge',
  rollbackOnPartialFailure: false,
  members: [],
  unresolvedMembers: [],
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

  it('keeps only the scenes with members waiting for an entity when asked', () => {
    const waiting = {
      ...EVENING,
      unresolvedMembers: [{ entityId: 'light.gone' }],
    } as unknown as SceneView;

    expect(matchesSceneFilter(EVENING, { ...OPEN_SCENE_FILTER, isWaiting: true })).toBe(false);
    expect(matchesSceneFilter(waiting, { ...OPEN_SCENE_FILTER, isWaiting: true })).toBe(true);
    expect(matchesSceneFilter(EVENING, OPEN_SCENE_FILTER)).toBe(true);
  });
});

describe('sceneNarrowingCount', () => {
  it('counts the facets set, not the search', () => {
    expect(sceneNarrowingCount({ ...OPEN_SCENE_FILTER, search: 'evening' })).toBe(0);
    expect(sceneNarrowingCount({ search: '', areaKey: 'lounge', isWaiting: true })).toBe(2);
  });
});

describe('the codecs', () => {
  it('round-trip what they hold and leave the defaults out of the address', () => {
    const scene = { search: 'evening', areaKey: 'lounge', isWaiting: true };

    expect(SCENE_FILTER_CODEC.read(new URLSearchParams(SCENE_FILTER_CODEC.write(scene)))).toEqual(
      scene,
    );
    expect(PEOPLE_FILTER_CODEC.write(OPEN_PEOPLE_FILTER)).toEqual({});
    expect(searchAndFacetCodec('used').write({ search: '', facet: 'no' })).toEqual({ used: 'no' });
  });

  it('read an unknown value as its default rather than as a filter nothing matches', () => {
    expect(
      packageFilterCodec(['running', 'failed']).read(new URLSearchParams({ state: 'exploded' }))
        .states,
    ).toEqual([]);
  });

  it('keep the package states as a list, dropping what does not read', () => {
    const codec = packageFilterCodec(['running', 'failed', 'stopped']);
    const filter = { search: 'mqtt', states: ['running', 'failed'] as const };

    expect(codec.read(new URLSearchParams(codec.write(filter)))).toEqual(filter);
    expect(codec.read(new URLSearchParams({ state: 'failed,bogus' })).states).toEqual(['failed']);
    expect(codec.write(OPEN_PACKAGE_FILTER)).toEqual({});
  });
});
