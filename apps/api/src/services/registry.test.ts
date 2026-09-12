/**
 * The pure part of the registry reads: one row from the devices table becoming one view.
 *
 * The devices table has two owner columns and a constraint that exactly one is set - a package
 * for a device an adapter registered, an integration instance for one the hub adopted. What is
 * asserted is that either kind of row reads as a device, with the owner named the way the
 * interface shows it.
 */
import { describe, expect, it } from 'vitest';

import { toDeviceView, type DeviceRow } from './registry.js';

/**
 * A row as the devices query returns it, for tests that vary the owner columns.
 *
 * @param owner - The two owner columns.
 * @param owner.packageId - The package, when a package owns it.
 * @param owner.integrationId - The instance, when the hub adopted it.
 * @returns The row.
 */
function row(owner: Pick<DeviceRow, 'packageId' | 'integrationId'>): DeviceRow {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    ...owner,
    externalId: '01P00A000000000',
    name: 'Bambu Lab P1S',
    manufacturer: 'Bambu Lab',
    model: 'P1S',
    swVersion: null,
    hwVersion: null,
    areaKey: null,
    areaName: null,
    viaDeviceId: null,
    isEnabled: true,
    lastSeenAt: null,
  };
}

describe('toDeviceView', () => {
  it('names the integration instance that adopted a device', () => {
    const view = toDeviceView(row({ packageId: null, integrationId: 'bambu-lab-1' }), [
      'light.p1s_chamber_light',
    ]);

    expect(view.owner).toEqual({ kind: 'integration', id: 'bambu-lab-1' });
    expect(view.entityIds).toEqual(['light.p1s_chamber_light']);
  });

  it('names the package that registered a device', () => {
    const view = toDeviceView(row({ packageId: 'pkg-mqtt', integrationId: null }), []);

    expect(view.owner).toEqual({ kind: 'package', id: 'pkg-mqtt' });
  });

  it('throws on a row with no owner, which the table forbids', () => {
    expect(() => toDeviceView(row({ packageId: null, integrationId: null }), [])).toThrow();
  });
});
