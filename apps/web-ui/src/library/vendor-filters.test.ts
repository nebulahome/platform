import { describe, expect, it } from 'vitest';

import type { IntegrationVendorView } from '@nebulahome/contracts';

import {
  countStatuses,
  matchesVendorFilter,
  OPEN_VENDOR_FILTER,
  sortVendors,
  VENDOR_FILTER_CODEC,
  wiresOf,
  type VendorFilter,
} from './vendor-filters';
import { connectionHealth, devicesHealth, runtimeHealth, updatesHealth } from './vendor-health';
import { vendorStatusOf } from './vendor-status';

/**
 * A vendor as the list serves it, varying what the filters read.
 *
 * @param overrides - What to change.
 * @returns The vendor.
 */
function vendor(overrides: Partial<IntegrationVendorView> = {}): IntegrationVendorView {
  return {
    id: 'shelly',
    version: '1.0.0',
    name: 'Shelly',
    description: 'Relays on your own network.',
    origin: 'development',
    install: null,
    hasCode: false,
    logoPadding: 0,
    internetRequired: false,
    transports: ['http'],
    wires: ['http'],
    discoverySources: [],
    adoption: 'owner',
    twins: [],
    pairing: null,
    listener: null,
    passedOver: [],
    requires: { packages: {}, services: [] },
    packageProblems: [],
    account: null,
    accounts: [],
    needsAccount: false,
    needsPackage: false,
    update: null,
    containers: [],
    containerStatuses: [],
    setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
    drivers: [
      {
        id: 'shelly/1pm-mini-g3',
        vendorId: 'shelly',
        driverId: '1pm-mini-g3',
        name: '1PM Mini Gen3',
        transport: 'http',
        models: ['S3SW-001P8EU'],
        setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
      },
    ],
    needsSetup: false,
    isConfigured: false,
    transportConfig: {},
    options: {},
    configuredAt: null,
    deviceCount: 0,
    entityCount: 0,
    ...overrides,
  };
}

/**
 * A filter with one thing set.
 *
 * @param overrides - What to set.
 * @returns The filter.
 */
function filter(overrides: Partial<VendorFilter>): VendorFilter {
  return { ...OPEN_VENDOR_FILTER, ...overrides };
}

describe('matchesVendorFilter', () => {
  it('lets everything through when nothing is set', () => {
    expect(matchesVendorFilter(vendor(), OPEN_VENDOR_FILTER)).toBe(true);
  });

  it('searches the name, the id, the drivers and the models, ignoring case', () => {
    // A person looking for their printer types what is on the box, which is a model, not the
    // company; a person looking for a driver types its name.
    expect(matchesVendorFilter(vendor(), filter({ search: 'SHELLY' }))).toBe(true);
    expect(matchesVendorFilter(vendor(), filter({ search: 'mini gen3' }))).toBe(true);
    expect(matchesVendorFilter(vendor(), filter({ search: 's3sw' }))).toBe(true);
    expect(matchesVendorFilter(vendor(), filter({ search: 'hue' }))).toBe(false);
  });

  it('narrows by the wire a vendor speaks', () => {
    expect(matchesVendorFilter(vendor(), filter({ transport: 'http' }))).toBe(true);
    expect(matchesVendorFilter(vendor(), filter({ transport: 'mqtt' }))).toBe(false);
    expect(
      matchesVendorFilter(vendor({ wires: ['http', 'mqtt'] }), filter({ transport: 'mqtt' })),
    ).toBe(true);
  });

  it('narrows a vendor of its own protocols by the wires its manifest declares', () => {
    const shelly = vendor({ transports: ['shelly/rpc'], wires: ['http'] });
    const quiet = vendor({ transports: ['acme/lan'], wires: [] });

    expect(matchesVendorFilter(shelly, filter({ transport: 'http' }))).toBe(true);
    expect(matchesVendorFilter(quiet, filter({ transport: 'http' }))).toBe(false);
    expect(wiresOf(quiet)).toEqual([]);
    expect(wiresOf(vendor({ wires: ['modbus', 'http'] }))).toEqual(['http', 'modbus']);
  });

  it('narrows by whether the internet is needed', () => {
    expect(matchesVendorFilter(vendor(), filter({ internet: 'local' }))).toBe(true);
    expect(matchesVendorFilter(vendor(), filter({ internet: 'needed' }))).toBe(false);
    expect(
      matchesVendorFilter(vendor({ internetRequired: true }), filter({ internet: 'needed' })),
    ).toBe(true);
  });

  it('applies every facet at once', () => {
    expect(
      matchesVendorFilter(
        vendor(),
        filter({ search: 'shelly', transport: 'http', internet: 'needed' }),
      ),
    ).toBe(false);
  });
});

describe('how a vendor stands', () => {
  it('reads a package or a container it needs before anything it asks of the owner', () => {
    expect(vendorStatusOf(vendor({ needsPackage: true, needsSetup: true })).kind).toBe('degraded');
    expect(
      vendorStatusOf(
        vendor({
          containerStatuses: [
            {
              ownerKind: 'vendor',
              vendorId: 'shelly',
              dependencyId: 'bridge',
              containerName: null,
              state: 'pulling',
              version: null,
              error: null,
            },
          ],
        }),
      ),
    ).toMatchObject({ kind: 'degraded', detail: 'Its container is pulling' });
    expect(vendorStatusOf(vendor({ needsAccount: true })).label).toBe('Needs sign-in');
    expect(vendorStatusOf(vendor({ needsSetup: true })).label).toBe('Needs setup');
    expect(vendorStatusOf(vendor({ deviceCount: 2 })).tone).toBe('success');
    expect(vendorStatusOf(vendor()).label).toBe('Idle');
  });

  it('asks for the settings, not after a container, while nobody has set it up', () => {
    // The supervisor makes the containers from the settings: a vendor never set up has none, and
    // the API then answers null for each one it declares.
    expect(vendorStatusOf(vendor({ needsSetup: true, containerStatuses: [null] }))).toMatchObject({
      kind: 'needs-setup',
      label: 'Needs setup',
    });
  });

  it('narrows by standing, by new devices and by an update waiting', () => {
    const idle = vendor();
    const running = vendor({ id: 'govee', name: 'Govee', deviceCount: 1 });

    expect(matchesVendorFilter(idle, filter({ statuses: ['running'] }))).toBe(false);
    expect(matchesVendorFilter(running, filter({ statuses: ['running', 'idle'] }))).toBe(true);
    expect(matchesVendorFilter(idle, filter({ hasNew: true }), 0)).toBe(false);
    expect(matchesVendorFilter(idle, filter({ hasNew: true }), 3)).toBe(true);
    expect(matchesVendorFilter(idle, filter({ hasUpdate: true }))).toBe(false);
    expect(
      matchesVendorFilter(
        vendor({ update: { latestVersion: '2.0.0', hasUpdate: true, hasNewBuild: false } }),
        filter({ hasUpdate: true }),
      ),
    ).toBe(true);
    expect(countStatuses([idle, running])).toMatchObject({ idle: 1, running: 1, degraded: 0 });
  });

  it('sorts by name, by the most devices, and by the newest install', () => {
    const shelly = vendor({ deviceCount: 1 });
    const acme = vendor({
      id: 'acme',
      name: 'ACME',
      deviceCount: 4,
      origin: 'installed',
      install: {
        build: '1.0.0-0a1b2c3d',
        version: '1.0.0',
        source: 'index',
        artifactSha256: 'a'.repeat(64),
        installedAt: '2026-10-07T08:00:00.000Z',
        installedBy: null,
      },
    });

    expect(sortVendors([shelly, acme], 'name').map((each) => each.id)).toEqual(['acme', 'shelly']);
    expect(sortVendors([shelly, acme], 'devices')[0]?.id).toBe('acme');
    expect(sortVendors([shelly, acme], 'recent')[0]?.id).toBe('acme');
  });

  it('keeps the standings, the switches and the order in the address', () => {
    const written = VENDOR_FILTER_CODEC.write(
      filter({ statuses: ['running', 'degraded'], hasNew: true, sort: 'devices' }),
    );

    expect(written).toEqual({ status: 'running,degraded', new: '1', sort: 'devices' });
    expect(VENDOR_FILTER_CODEC.read(new URLSearchParams(written))).toMatchObject({
      statuses: ['running', 'degraded'],
      hasNew: true,
      hasUpdate: false,
      sort: 'devices',
    });
  });
});

describe('the health strip of an integration', () => {
  it('says how it runs from the devices the page found', () => {
    expect(runtimeHealth(vendor(), 2)).toMatchObject({ tone: 'success', value: 'Running' });
    expect(runtimeHealth(vendor(), 0)).toMatchObject({ tone: 'neutral', value: 'Idle' });
  });

  it('says how it connects, and that it cannot while its package is down', () => {
    expect(connectionHealth(vendor({ discoverySources: ['mdns'] }))).toMatchObject({
      value: 'Local network',
      detail: 'Discovery over mDNS',
    });
    expect(
      connectionHealth(vendor({ needsPackage: true, packageProblems: ['MQTT is stopped'] })),
    ).toMatchObject({ tone: 'danger', detail: 'MQTT is stopped' });
  });

  it('counts the devices reporting, the ones failing, and the ones found', () => {
    expect(devicesHealth(vendor(), [{ state: 'running' }, { state: 'running' }], 0)).toMatchObject({
      tone: 'success',
      value: '2 of 2 reporting',
    });
    expect(devicesHealth(vendor(), [{ state: 'failed' }, { state: 'running' }], 0)).toMatchObject({
      tone: 'warning',
      value: '1 of 2 failing',
    });
    expect(devicesHealth(vendor(), [{ state: 'running' }], 5)).toMatchObject({
      tone: 'info',
      detail: '5 more found on the network',
    });
  });

  it('says whether a newer release waits, and that a vendor built in is updated with the platform', () => {
    expect(updatesHealth(vendor()).value).toBe('In development');
    expect(
      updatesHealth(
        vendor({
          origin: 'installed',
          update: { latestVersion: '2.0.0', hasUpdate: true, hasNewBuild: false },
        }),
      ),
    ).toMatchObject({ tone: 'info', value: '2.0.0 ready' });
    expect(
      updatesHealth(
        vendor({
          origin: 'installed',
          update: { latestVersion: '1.0.0', hasUpdate: false, hasNewBuild: false },
        }),
      ),
    ).toMatchObject({ tone: 'success', value: 'Up to date' });
  });
});
