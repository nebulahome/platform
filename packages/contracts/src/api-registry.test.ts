import { describe, expect, it } from 'vitest';

import {
  deviceCreateSchema,
  deviceProbeRequestSchema,
  deviceUpdateSchema,
  deviceViewSchema,
  integrationVendorConfigUpdateSchema,
  integrationVendorViewSchema,
} from './api-registry.js';

/**
 * A device as the API serves it, for tests that vary one field.
 *
 * @returns The row.
 */
function device(): Record<string, unknown> {
  return {
    id: 'bambu-lab-x1c',
    name: 'X1C',
    icon: 'printer',
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
    lastUpdatedAt: '2026-09-17T08:00:00.000Z',
    externalId: '01P00A000000000',
    manufacturer: 'Bambu Lab',
    swVersion: null,
    hwVersion: null,
    areaKey: null,
    areaName: null,
    entityIds: ['light.bambu_lab_x1c_chamber_light'],
  };
}

describe('deviceViewSchema', () => {
  it('serves the connection half and the identity half as one device', () => {
    // The vendor page wants the state and the pick; the devices page wants the name, the icon
    // and the entities. One row answers both, under the one id an entity carries as its source.
    const parsed = deviceViewSchema.parse(device());

    expect([parsed.id, parsed.name, parsed.icon, parsed.state, parsed.vendorId]).toEqual([
      'bambu-lab-x1c',
      'X1C',
      'printer',
      'running',
      'bambu-lab',
    ]);
  });

  it('allows a device not yet identified: no serial, nothing heard, no entities', () => {
    const parsed = deviceViewSchema.parse({
      ...device(),
      state: 'identifying',
      externalId: null,
      lastUpdatedAt: null,
      entityIds: [],
    });

    expect(parsed.externalId).toBeNull();
  });

  it('allows a device with no icon', () => {
    expect(deviceViewSchema.parse({ ...device(), icon: null }).icon).toBeNull();
  });

  it('carries a sealed secret as a marker, so the form knows one is kept', () => {
    expect(deviceViewSchema.parse(device()).transportConfig['password']).toEqual({
      $sealed: true,
    });
  });
});

describe('deviceCreateSchema', () => {
  it('needs an id, a kind, a model, a name and a transport configuration, and switches the device on', () => {
    const parsed = deviceCreateSchema.parse({
      id: 'bambu-lab-x1c',
      kind: 'bambu-lab/printer',
      model: 'X1C',
      name: 'X1C',
      transportConfig: { url: 'mqtts://192.168.1.60:8883', password: '12345678' },
    });

    expect([parsed.isEnabled, parsed.options, parsed.icon]).toEqual([true, {}, undefined]);
  });

  it('holds the id to the instance id pattern', () => {
    expect(
      deviceCreateSchema.safeParse({
        id: 'Bambu Lab',
        kind: 'bambu-lab/printer',
        model: 'X1C',
        name: 'X1C',
        transportConfig: {},
      }).success,
    ).toBe(false);
  });

  it('holds the kind to vendor/driver', () => {
    expect(
      deviceCreateSchema.safeParse({
        id: 'bambu-lab-x1c',
        kind: 'bambu-lab',
        model: 'X1C',
        name: 'X1C',
        transportConfig: {},
      }).success,
    ).toBe(false);
  });

  it('requires a name, trimmed', () => {
    // The name is what both pages show for the row. A blank one would be a device listed as
    // nothing, and a padded one would sort apart from its neighbours.
    expect(
      deviceCreateSchema.safeParse({
        id: 'bambu-lab-x1c',
        kind: 'bambu-lab/printer',
        model: 'X1C',
        name: '   ',
        transportConfig: {},
      }).success,
    ).toBe(false);
    expect(
      deviceCreateSchema.parse({
        id: 'bambu-lab-x1c',
        kind: 'bambu-lab/printer',
        model: 'X1C',
        name: '  Studio printer ',
        transportConfig: {},
      }).name,
    ).toBe('Studio printer');
  });

  it('holds the icon to the catalogue id shape', () => {
    expect(
      deviceCreateSchema.safeParse({
        id: 'bambu-lab-x1c',
        kind: 'bambu-lab/printer',
        model: 'X1C',
        name: 'X1C',
        icon: 'Printer Icon',
        transportConfig: {},
      }).success,
    ).toBe(false);
  });
});

describe('deviceUpdateSchema', () => {
  it('refuses an empty change', () => {
    expect(deviceUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('takes a rename on its own', () => {
    expect(deviceUpdateSchema.parse({ name: 'Studio printer' })).toEqual({
      name: 'Studio printer',
    });
  });

  it('lets the owner clear the icon', () => {
    expect(deviceUpdateSchema.parse({ icon: null }).icon).toBeNull();
  });

  it('lets the owner correct the model they picked', () => {
    expect(deviceUpdateSchema.parse({ model: 'P1S' }).model).toBe('P1S');
  });
});

describe('deviceProbeRequestSchema', () => {
  it('names the device being edited, so its kept secrets can stand in for the blanks', () => {
    const parsed = deviceProbeRequestSchema.parse({
      kind: 'bambu-lab/printer',
      transportConfig: { url: 'mqtts://192.168.1.60:8883' },
      deviceId: 'bambu-lab-x1c',
    });

    expect(parsed.deviceId).toBe('bambu-lab-x1c');
  });

  it('works for a device that does not exist yet', () => {
    expect(
      deviceProbeRequestSchema.parse({ kind: 'bambu-lab/printer', transportConfig: {} }).deviceId,
    ).toBeUndefined();
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
    deviceCount: 1,
    entityCount: 12,
  };
}

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

  it('counts the devices under the vendor and the entities they expose', () => {
    const parsed = integrationVendorViewSchema.parse(vendorView());

    expect([parsed.deviceCount, parsed.entityCount]).toEqual([1, 12]);
    expect('instanceCount' in parsed).toBe(false);
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
