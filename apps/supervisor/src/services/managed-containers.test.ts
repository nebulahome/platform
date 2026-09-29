/**
 * The managed containers' bookkeeping: which owner declares what, and which kind's reconciling
 * releases which containers. Docker is out of reach here, so nothing is made.
 */
import { describe, expect, it } from 'vitest';

import type { ManagedContainerSpec } from '@nebula-home/contracts';
import { createLogger } from '@nebula-home/logging';

import { MANAGED_LABELS } from '../domain/managed.js';

import { ManagedContainers, type ManagedContainersOptions } from './managed-containers.js';

/**
 * One declared container.
 *
 * @param vendorId - Its vendor, or package.
 * @param dependencyId - Its id.
 * @returns The declaration.
 */
function spec(vendorId: string, dependencyId: string): ManagedContainerSpec {
  return {
    ownerKind: 'vendor',
    vendorId,
    dependencyId,
    name: dependencyId,
    image: `example/${dependencyId}`,
    minVersion: '1.0.0',
    env: [],
    volumes: [],
    devices: [],
    ports: [],
    seed: [],
    webPort: null,
  };
}

/**
 * The set, with Docker out of reach.
 *
 * @returns It.
 */
function managed(): ManagedContainers {
  return new ManagedContainers({
    logger: createLogger({ service: 'supervisor', version: '0.0.0', level: 'fatal' }),
    context: () => null,
    installationId: 'test',
    selfId: () => null,
    onChange: () => undefined,
  } as unknown as ManagedContainersOptions);
}

/**
 * The labels a managed container carries.
 *
 * @param ownerKind - Who declares it.
 * @param vendorId - The vendor or the package.
 * @param dependencyId - Its id.
 * @returns The labels.
 */
function labels(ownerKind: string, vendorId: string, dependencyId: string): Record<string, string> {
  return {
    [MANAGED_LABELS.managed]: 'true',
    [MANAGED_LABELS.ownerKind]: ownerKind,
    [MANAGED_LABELS.vendor]: vendorId,
    [MANAGED_LABELS.dependency]: dependencyId,
  };
}

describe('the managed containers of two kinds of owner', () => {
  it("leaves the packages' containers declared when the vendors are reconciled", () => {
    const set = managed();

    set.reconcile({
      ownerKind: 'package',
      vendors: [{ vendorId: 'nvr', containers: [spec('nvr', 'frigate')] }],
    });
    set.reconcile({
      ownerKind: 'vendor',
      vendors: [{ vendorId: 'zigbee2mqtt', containers: [spec('zigbee2mqtt', 'zigbee2mqtt')] }],
    });

    expect(set.managerOf(labels('package', 'nvr', 'frigate'))).toEqual({
      ownerKind: 'package',
      vendorId: 'nvr',
      dependencyId: 'frigate',
      isReleased: false,
    });
    expect(set.statusesOf('nvr', 'package')).toEqual([
      expect.objectContaining({ ownerKind: 'package', dependencyId: 'frigate' }),
    ]);
    expect(set.statusesOf('nvr')).toEqual([]);
  });

  it('releases a container its kind no longer declares, and reads an unlabelled one as a vendor’s', () => {
    const set = managed();

    set.reconcile({ ownerKind: 'vendor', vendors: [] });

    expect(
      set.managerOf({
        [MANAGED_LABELS.managed]: 'true',
        [MANAGED_LABELS.vendor]: 'zigbee2mqtt',
        [MANAGED_LABELS.dependency]: 'zigbee2mqtt',
      }),
    ).toMatchObject({ ownerKind: 'vendor', isReleased: true });
    // The packages were never reconciled: nothing of theirs is released yet.
    expect(set.managerOf(labels('package', 'nvr', 'frigate'))?.isReleased).toBe(false);
  });
});
