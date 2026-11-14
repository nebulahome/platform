/**
 * The pure part of the entity reads: the owner columns becoming the one `source` the contract
 * names; and the list's pages, read through a database that answers in turn.
 */
import { describe, expect, it } from 'vitest';

import type { Identity } from '@nebulahome/contracts';

import { databaseAnswering } from '../testing/hub-harness.js';

import { listEntities, toSourceRef } from './entities.js';

describe('toSourceRef', () => {
  it('names the package that registered an adapter entity', () => {
    expect(toSourceRef('adapter', 'pkg-weather', null)).toBe('pkg-weather');
  });

  it('names the integration instance that registered an adapter entity', () => {
    expect(toSourceRef('adapter', null, 'bambu-lab-1')).toBe('bambu-lab-1');
  });

  it('keeps the reserved kinds as they are', () => {
    expect(toSourceRef('derived', null, null)).toBe('derived');
    expect(toSourceRef('system', null, null)).toBe('system');
  });

  it("names a container entity after its container's device", () => {
    expect(toSourceRef('container', null, null, 'nebulahome-zigbee2mqtt')).toBe(
      'container-nebulahome-zigbee2mqtt',
    );
  });
});

describe('listEntities', () => {
  /**
   * One entity row as the list query returns it.
   *
   * @param entityId - Its address.
   * @returns The row.
   */
  const row = (entityId: string): Record<string, unknown> => ({
    rowId: `row-${entityId}`,
    entityId,
    domain: 'light',
    name: entityId,
    icon: null,
    deviceId: null,
    packageId: null,
    integrationId: null,
    source: 'system',
    deviceExternalId: null,
    areaKey: null,
    areaName: null,
    unitOfMeasurement: null,
    deviceClass: null,
    stateClass: null,
    displayPrecision: null,
    isEnabled: true,
    isHidden: false,
    searchAliases: null,
    state: null,
    attributes: null,
    isAvailable: null,
    lastChanged: null,
    lastUpdated: null,
    linkedTo: null,
    linkOrigin: null,
    transport: null,
    shownDomain: null,
    shownDeviceClass: null,
    config: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    stateSource: null,
    devicePreferred: null,
    kind: null,
    instanceTransport: null,
    aliasBehavesAs: null,
  });

  const identity = {
    permissions: ['light.b', 'light.c', 'light.d'].map((id) => ({
      key: 'entity:read',
      scope: `entity.${id}`,
      effect: 'allow',
    })),
  } as unknown as Identity;

  it('reads on past a batch the permissions thinned, so no entity is left off', async () => {
    // Each batch is the rows, then what is linked to them, their capabilities and their tags.
    const first = await listEntities(
      databaseAnswering(
        [row('light.a'), row('light.b'), row('light.c')],
        [],
        [],
        [],
        [row('light.d')],
      ),
      identity,
      { includeHidden: false },
      { limit: 2 },
    );

    expect(first.items.map((view) => view.entityId)).toEqual(['light.b', 'light.c']);
    expect(first.nextCursor).toBeDefined();

    const second = await listEntities(
      databaseAnswering([row('light.d')]),
      identity,
      { includeHidden: false },
      { limit: 2, cursor: first.nextCursor ?? '' },
    );

    expect(second.items.map((view) => view.entityId)).toEqual(['light.d']);
    expect(second.nextCursor).toBeUndefined();
  });
});
