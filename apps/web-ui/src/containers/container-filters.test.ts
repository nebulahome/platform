import { describe, expect, it } from 'vitest';

import type { ContainerSummary } from '@nebulahome/contracts';

import { composeOf, containerSummary } from '@/testing/container-fixtures';

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
  return containerSummary(fields);
}

describe('ownerOf', () => {
  it('tells the platform’s own, an integration’s and the owner’s apart', () => {
    expect(ownerOf(container({ isSelf: true, isSystem: true }))).toBe('system');
    expect(ownerOf(container({ isSystem: true }))).toBe('system');
    expect(
      ownerOf(
        container({
          managedBy: {
            ownerKind: 'vendor',
            vendorId: 'zigbee2mqtt',
            dependencyId: 'zigbee2mqtt',
            isReleased: false,
          },
        }),
      ),
    ).toBe('integration');
    expect(
      ownerOf(
        container({
          managedBy: {
            ownerKind: 'vendor',
            vendorId: 'gone',
            dependencyId: 'gone',
            isReleased: true,
          },
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
    expect(
      matchesContainer(container({ compose: composeOf('media', 'plex') }), {
        ...OPEN_CONTAINER_FILTER,
        search: 'media',
      }),
    ).toBe(true);
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
