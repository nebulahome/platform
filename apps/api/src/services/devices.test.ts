import { describe, expect, it } from 'vitest';

import type { IntegrationVendor } from '@nebulahome/contracts';

import { toDeviceView, type DeviceRow } from './devices.js';

/** The catalogue as the hub lists it, with the one driver the row names. */
const CATALOGUE: IntegrationVendor[] = [
  {
    id: 'bambu-lab',
    version: '1.0.0',
    name: 'Bambu Lab',
    logoPadding: 0,
    internetRequired: false,
    transports: ['mqtt'],
    wires: ['mqtt'],
    discoverySources: [],
    adoption: 'owner',
    pairing: null,
    listener: null,
    passedOver: [],
    requires: { packages: {}, services: [] },
    packageProblems: [],
    account: null,
    containers: [],
    setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
    drivers: [
      {
        id: 'bambu-lab/printer',
        vendorId: 'bambu-lab',
        driverId: 'printer',
        name: 'Printer',
        transport: 'mqtt',
        models: ['X1C'],
        modelSeries: { X1C: 'X series' },
        setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
      },
    ],
  },
];

/**
 * A row as the two halves join, for tests that vary one field.
 *
 * @param fields - What to change.
 * @returns The row.
 */
function row(fields: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: 'bambu-lab-x1c',
    kind: 'bambu-lab/printer',
    kindVersion: '1.0.0',
    pickedModel: 'X1C',
    transport: 'mqtt',
    transportConfig: { url: 'mqtts://192.168.1.60:8883', password: { $sealed: 'v1:aa:bb' } },
    options: {},
    isEnabled: true,
    state: 'running',
    lastError: null,
    lastStartedAt: new Date('2026-09-17T08:00:00Z'),
    name: 'Studio printer',
    icon: 'printer',
    externalId: '01P00A000000000',
    manufacturer: 'Bambu Lab',
    model: null,
    swVersion: null,
    hwVersion: null,
    areaId: null,
    areaKey: null,
    areaName: null,
    lastUpdatedAt: null,
    ...fields,
  };
}

describe('toDeviceView', () => {
  it('reads one instance and its identity row as one device, under the instance id', () => {
    const view = toDeviceView(row(), CATALOGUE, ['sensor.bambu_lab_x1c_nozzle_temperature']);

    expect(view).toMatchObject({
      id: 'bambu-lab-x1c',
      name: 'Studio printer',
      icon: 'printer',
      vendorId: 'bambu-lab',
      driverId: 'printer',
      driverName: 'Printer',
      state: 'running',
      externalId: '01P00A000000000',
      entityIds: ['sensor.bambu_lab_x1c_nozzle_temperature'],
    });
  });

  it('shows the picked model until the hardware reports one', () => {
    expect(toDeviceView(row(), CATALOGUE, []).model).toBe('X1C');
    expect(toDeviceView(row({ model: 'S3SW-001P8EU' }), CATALOGUE, []).model).toBe('S3SW-001P8EU');
  });

  it('says the series of the model picked, and none for a model the driver puts in none', () => {
    expect(toDeviceView(row(), CATALOGUE, []).series).toBe('X series');
    // The hardware's code is not a label the driver lists: the pick still says the series.
    expect(toDeviceView(row({ model: 'BL-P001' }), CATALOGUE, []).series).toBe('X series');
    expect(toDeviceView(row({ pickedModel: 'X9' }), CATALOGUE, []).series).toBeNull();
    expect(toDeviceView(row(), [], []).series).toBeNull();
  });

  it('says a device is not yet identified', () => {
    const view = toDeviceView(row({ state: 'identifying', externalId: null }), CATALOGUE, []);

    expect([view.state, view.externalId, view.entityIds]).toEqual(['identifying', null, []]);
  });

  it('withholds a sealed secret as a marker, so the form knows one is kept', () => {
    expect(toDeviceView(row(), CATALOGUE, []).transportConfig['password']).toEqual({
      $sealed: true,
    });
  });

  it('names the driver by its id when the hub is away, and a row without a name by its id', () => {
    // The hub holds the drivers' names. A page that showed nothing while it restarted would be
    // worse than one showing the ids.
    const view = toDeviceView(row({ name: null, icon: null }), [], []);

    expect([view.driverName, view.name, view.icon]).toEqual(['printer', 'bambu-lab-x1c', null]);
  });

  it('lists the tags on the device by id, and none when it has none', () => {
    const tagId = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';

    expect(toDeviceView(row(), CATALOGUE, [], [tagId]).tagIds).toEqual([tagId]);
    expect(toDeviceView(row(), CATALOGUE, []).tagIds).toEqual([]);
  });
});
