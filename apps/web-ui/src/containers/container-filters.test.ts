import { describe, expect, it } from 'vitest';

import type { ContainerSummary } from '@nebula-home/contracts';

import {
  CONTAINER_FILTER_CODEC,
  matchesContainer,
  OPEN_CONTAINER_FILTER,
  ownerOf,
} from './container-filters';

/**
 * A container, varying what the filter reads.
 *
 * @param fields - What differs from a plain running container.
 * @returns The container.
 */
function container(fields: Partial<ContainerSummary> = {}): ContainerSummary {
  return {
    id: 'a'.repeat(64),
    name: 'adguard',
    deviceId: 'container-adguard',
    image: 'adguard/adguardhome:v0.107.60',
    version: 'v0.107.60',
    state: 'running',
    status: 'Up 2 hours',
    health: null,
    createdAt: new Date('2026-09-20T10:00:00Z'),
    startedAt: new Date('2026-09-27T08:00:00Z'),
    isSelf: false,
    managedBy: null,
    registryUrl: null,
    cpuPercent: 1,
    memoryUsedBytes: 1,
    memoryLimitBytes: 2,
    update: {
      installedVersion: null,
      latestVersion: null,
      isAvailable: false,
      checkedAt: null,
      error: null,
      isInstalling: false,
      progress: null,
    },
    refusal: null,
    ...fields,
  };
}

describe('ownerOf', () => {
  it('tells the platform’s own, an integration’s and the owner’s apart', () => {
    expect(ownerOf(container({ isSelf: true }))).toBe('platform');
    expect(
      ownerOf(
        container({
          managedBy: { vendorId: 'zigbee2mqtt', dependencyId: 'zigbee2mqtt', isReleased: false },
        }),
      ),
    ).toBe('integration');
    expect(
      ownerOf(
        container({
          managedBy: { vendorId: 'gone', dependencyId: 'gone', isReleased: true },
        }),
      ),
    ).toBe('other');
  });
});

describe('matchesContainer', () => {
  it('narrows by running, by owner and by the words searched', () => {
    expect(matchesContainer(container(), { ...OPEN_CONTAINER_FILTER, run: 'stopped' })).toBe(false);
    expect(
      matchesContainer(container({ state: 'exited' }), {
        ...OPEN_CONTAINER_FILTER,
        run: 'stopped',
      }),
    ).toBe(true);
    expect(matchesContainer(container(), { ...OPEN_CONTAINER_FILTER, owner: 'other' })).toBe(true);
    expect(matchesContainer(container(), { ...OPEN_CONTAINER_FILTER, search: 'adguardhome' })).toBe(
      true,
    );
    expect(matchesContainer(container(), { ...OPEN_CONTAINER_FILTER, search: 'zigbee' })).toBe(
      false,
    );
  });
});

describe('CONTAINER_FILTER_CODEC', () => {
  it('keeps only what differs from the open filter in the address', () => {
    expect(CONTAINER_FILTER_CODEC.write({ search: '', run: 'running', owner: 'any' })).toEqual({
      run: 'running',
    });
    expect(CONTAINER_FILTER_CODEC.read(new URLSearchParams('owner=integration&run=nope'))).toEqual({
      search: '',
      run: 'any',
      owner: 'integration',
    });
  });
});
