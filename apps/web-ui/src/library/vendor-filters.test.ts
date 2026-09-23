import { describe, expect, it } from 'vitest';

import type { IntegrationVendorView } from '@nebula-home/contracts';

import { matchesVendorFilter, OPEN_VENDOR_FILTER, type VendorFilter } from './vendor-filters';

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
    logoPadding: 0,
    internetRequired: false,
    transports: ['http'],
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
      matchesVendorFilter(vendor({ transports: ['http', 'mqtt'] }), filter({ transport: 'mqtt' })),
    ).toBe(true);
  });

  it("keeps a vendor speaking a protocol of its own under the 'own' wire, and only there", () => {
    // A vendor may ship its transport in its bundle - `shelly/rpc` - and the hub names it after
    // the vendor. No list of wires in the interface could know every such name in advance.
    const shelly = vendor({ transports: ['shelly/rpc'] });
    const bambu = vendor({ transports: ['mqtt'] });

    expect(matchesVendorFilter(shelly, filter({ transport: 'own' }))).toBe(true);
    expect(matchesVendorFilter(bambu, filter({ transport: 'own' }))).toBe(false);
    expect(matchesVendorFilter(shelly, filter({ transport: 'http' }))).toBe(false);
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
