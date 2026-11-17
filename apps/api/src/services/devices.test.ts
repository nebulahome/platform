import { describe, expect, it } from 'vitest';

import type { IntegrationVendor } from '@nebulahome/contracts';

import { familiesOf, toDeviceView, type DeviceRow } from './devices.js';

/** The catalogue as the hub lists it, with the one driver the row names. */
const CATALOGUE: IntegrationVendor[] = [
  {
    id: 'bambu-lab',
    version: '1.0.0',
    origin: 'development',
    install: null,
    hasCode: false,
    name: 'Bambu Lab',
    logoPadding: 0,
    internetRequired: false,
    transports: ['mqtt'],
    wires: ['mqtt'],
    discoverySources: [],
    adoption: 'owner',
    twins: [],
    twinsPrefer: [],
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
    rowId: null,
    linkedTo: null,
    preferredTransport: null,
    mac: null,
    serialNumber: null,
    createdAt: null,
    parentExternalId: null,
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

describe('familiesOf', () => {
  /**
   * A device of the SolaX vendor.
   *
   * @param id - Its id.
   * @param externalId - Its serial.
   * @param fields - What else to set.
   * @returns The row.
   */
  const solax = (id: string, externalId: string, fields: Partial<DeviceRow> = {}): DeviceRow =>
    row({ id, kind: 'solax/inverter', externalId, rowId: `row-${id}`, ...fields });

  it('puts each part under the device it names, in the order the rows come', () => {
    const families = familiesOf([
      solax('dry', 'H450:dry', { parentExternalId: 'H450' }),
      solax('eps', 'H450:eps', { parentExternalId: 'H450' }),
      solax('inverter', 'H450'),
      solax('wallbox', 'W1'),
    ]);

    expect(families.get('inverter')).toEqual({ parentId: null, childIds: ['dry', 'eps'] });
    expect(families.get('eps')).toEqual({ parentId: 'inverter', childIds: [] });
    expect(families.has('wallbox')).toBe(false);
  });

  it('names the device the house shows when the parent is one way into it', () => {
    const families = familiesOf([
      solax('inverter-cloud', 'H450', { linkedTo: 'row-inverter' }),
      solax('inverter', 'H450-modbus'),
      solax('eps', 'H450:eps', { parentExternalId: 'H450' }),
    ]);

    expect(families.get('eps')?.parentId).toBe('inverter');
  });

  it('keeps one level, another vendor and the device itself out', () => {
    const families = familiesOf([
      solax('inverter', 'H450'),
      solax('eps', 'H450:eps', { parentExternalId: 'H450' }),
      solax('deep', 'H450:eps:1', { parentExternalId: 'H450:eps' }),
      solax('self', 'S1', { parentExternalId: 'S1' }),
      row({ id: 'other', kind: 'acme/relay', externalId: 'A1', parentExternalId: 'H450' }),
    ]);

    expect(families.get('deep')).toBeUndefined();
    expect(families.get('eps')).toEqual({ parentId: 'inverter', childIds: [] });
    expect(families.has('self')).toBe(false);
    expect(families.has('other')).toBe(false);
  });
});
