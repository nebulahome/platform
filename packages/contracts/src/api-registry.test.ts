import { describe, expect, it } from 'vitest';

import {
  deviceViewSchema,
  integrationCreateSchema,
  integrationProbeRequestSchema,
  integrationUpdateSchema,
  integrationVendorConfigUpdateSchema,
  integrationVendorViewSchema,
  integrationViewSchema,
} from './api-registry.js';

/**
 * A view row as the API serves it, for tests that vary one field.
 *
 * @returns The row.
 */
function view(): Record<string, unknown> {
  return {
    id: 'bambu-lab-1',
    kind: 'bambu-lab/printer',
    kindVersion: '1.0.0',
    vendorId: 'bambu-lab',
    driverId: 'printer',
    driverName: 'Printer',
    model: 'X1C',
    transport: 'mqtt',
    transportConfig: { url: 'mqtts://192.168.1.60:8883', password: { $sealed: true } },
    options: {},
    isEnabled: true,
    state: 'running',
    lastError: null,
    lastStartedAt: null,
    deviceCount: 1,
    entityCount: 12,
  };
}

/**
 * A device as the API serves it, for tests that vary its owner.
 *
 * @param owner - Who it belongs to.
 * @returns The row.
 */
function device(owner: unknown): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    owner,
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
    entityIds: ['light.p1s_chamber_light'],
  };
}

describe('deviceViewSchema', () => {
  it('names the integration instance that owns a device the hub adopted', () => {
    const parsed = deviceViewSchema.parse(device({ kind: 'integration', id: 'bambu-lab-1' }));

    expect(parsed.owner).toEqual({ kind: 'integration', id: 'bambu-lab-1' });
  });

  it('names the package that owns a device an adapter registered', () => {
    const parsed = deviceViewSchema.parse(device({ kind: 'package', id: 'pkg-mqtt' }));

    expect(parsed.owner).toEqual({ kind: 'package', id: 'pkg-mqtt' });
  });

  it('refuses a device nobody owns', () => {
    expect(deviceViewSchema.safeParse(device(null)).success).toBe(false);
  });
});

/**
 * A vendor as the API serves it, for tests that vary one field.
 *
 * @returns The row.
 */
function vendorView(): Record<string, unknown> {
  return {
    id: 'bambu-lab',
    version: '1.0.0',
    name: 'Bambu Lab',
    internetRequired: false,
    transports: ['mqtt'],
    setup: { transport: { fields: [] } },
    drivers: [],
    needsSetup: false,
    isConfigured: false,
    transportConfig: {},
    options: {},
    configuredAt: null,
    instanceCount: 1,
    deviceCount: 1,
    entityCount: 12,
  };
}

describe('integrationViewSchema', () => {
  it('serves the options alongside the transport configuration', () => {
    expect(integrationViewSchema.parse(view()).options).toEqual({});
  });

  it('says which vendor and driver the kind names, and the model the owner picked', () => {
    // The vendor page groups rows by vendor and shows the pick, and neither should have to
    // split the kind or look a driver up in the catalogue to do it.
    const parsed = integrationViewSchema.parse(view());

    expect([parsed.vendorId, parsed.driverId, parsed.driverName, parsed.model]).toEqual([
      'bambu-lab',
      'printer',
      'Printer',
      'X1C',
    ]);
  });

  it('allows a row without a model, from before there was one to pick', () => {
    expect(integrationViewSchema.parse({ ...view(), model: null }).model).toBeNull();
  });

  it('carries a sealed secret as a marker, so the form knows one is kept', () => {
    const parsed = integrationViewSchema.parse(view());

    expect(parsed.transportConfig['password']).toEqual({ $sealed: true });
  });
});

describe('integrationCreateSchema', () => {
  it('needs an id, a kind, a model and a transport configuration, and switches the instance on', () => {
    const parsed = integrationCreateSchema.parse({
      id: 'bambu-lab-1',
      kind: 'bambu-lab/printer',
      model: 'X1C',
      transportConfig: { url: 'mqtts://192.168.1.60:8883', password: '12345678' },
    });

    expect(parsed.isEnabled).toBe(true);
    expect(parsed.options).toEqual({});
  });

  it('holds the id to the instance id pattern', () => {
    expect(
      integrationCreateSchema.safeParse({
        id: 'Bambu Lab',
        kind: 'bambu-lab/printer',
        model: 'X1C',
        transportConfig: {},
      }).success,
    ).toBe(false);
  });

  it('holds the kind to vendor/driver', () => {
    expect(
      integrationCreateSchema.safeParse({
        id: 'bambu-lab-1',
        kind: 'bambu-lab',
        model: 'X1C',
        transportConfig: {},
      }).success,
    ).toBe(false);
  });

  it('requires the model the owner picked', () => {
    // The pick is what the vendor page shows for the row. A create without one would be a
    // row that says "Printer" among rows that say which printer.
    expect(
      integrationCreateSchema.safeParse({
        id: 'bambu-lab-1',
        kind: 'bambu-lab/printer',
        transportConfig: {},
      }).success,
    ).toBe(false);
  });
});

describe('integrationVendorViewSchema', () => {
  it('says whether the vendor still needs setting up, and what it holds once it is', () => {
    const parsed = integrationVendorViewSchema.parse({
      ...vendorView(),
      needsSetup: true,
      transportConfig: { apiKey: { $sealed: true } },
    });

    expect([parsed.needsSetup, parsed.transportConfig['apiKey']]).toEqual([
      true,
      { $sealed: true },
    ]);
  });

  it('counts what came in through the vendor', () => {
    const parsed = integrationVendorViewSchema.parse(vendorView());

    expect([parsed.instanceCount, parsed.deviceCount, parsed.entityCount]).toEqual([1, 1, 12]);
  });
});

describe('integrationVendorConfigUpdateSchema', () => {
  it('refuses an empty change', () => {
    expect(integrationVendorConfigUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('takes either group on its own', () => {
    expect(
      integrationVendorConfigUpdateSchema.parse({ transportConfig: { apiKey: 'k' } }).options,
    ).toBeUndefined();
  });
});

describe('integrationProbeRequestSchema', () => {
  it('names the instance being edited, so its kept secrets can stand in for the blanks', () => {
    const parsed = integrationProbeRequestSchema.parse({
      kind: 'bambu-lab/printer',
      transportConfig: { url: 'mqtts://192.168.1.60:8883' },
      integrationId: 'bambu-lab-1',
    });

    expect(parsed.integrationId).toBe('bambu-lab-1');
  });

  it('works for an instance that does not exist yet', () => {
    expect(
      integrationProbeRequestSchema.parse({ kind: 'bambu-lab/printer', transportConfig: {} })
        .integrationId,
    ).toBeUndefined();
  });
});

describe('integrationUpdateSchema', () => {
  it('still refuses an empty change', () => {
    expect(integrationUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('lets the owner correct the model they picked', () => {
    expect(integrationUpdateSchema.parse({ model: 'P1S' }).model).toBe('P1S');
  });
});
