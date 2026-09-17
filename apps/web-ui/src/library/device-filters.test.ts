/**
 * The header's every combination, tried without a page.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type DeviceView, type EntityView } from '@nebula-home/contracts';

import { isNarrowing, matchesFilter, OPEN_FILTER } from './device-filters';

/** The printer, as the registry lists it. */
const PRINTER: DeviceView = {
  id: 'bambu-lab-p1s',
  name: 'Workshop printer',
  icon: 'printer',
  kind: 'bambu-lab/printer',
  kindVersion: '1.0.0',
  vendorId: 'bambu-lab',
  driverId: 'printer',
  driverName: 'Printer',
  model: 'P1S',
  transport: 'mqtt',
  transportConfig: {},
  options: {},
  isEnabled: true,
  state: 'running',
  lastError: null,
  lastStartedAt: null,
  lastUpdatedAt: null,
  externalId: '01P00A000000042',
  manufacturer: 'Bambu Lab',
  swVersion: null,
  hwVersion: null,
  areaKey: 'workshop',
  areaName: 'Workshop',
  entityIds: [entityIdSchema.parse('sensor.bambu_lab_p1s_nozzle_temperature')],
};

/** One of its entities. */
const NOZZLE: EntityView = {
  entityId: entityIdSchema.parse('sensor.bambu_lab_p1s_nozzle_temperature'),
  domain: 'sensor',
  name: 'Nozzle temperature',
  icon: null,
  areaKey: 'workshop',
  areaName: 'Workshop',
  deviceId: '00000000-0000-4000-8000-000000000010',
  source: 'bambu-lab-p1s',
  unitOfMeasurement: '°C',
  deviceClass: 'temperature',
  isEnabled: true,
  isHidden: false,
  capabilities: [{ capability: 'sensor_numeric', params: {} }],
  searchAliases: [],
  state: null,
  attributes: {},
  isAvailable: true,
  lastChanged: null,
  lastUpdated: null,
};

describe('matchesFilter', () => {
  it('admits everything when nothing is set', () => {
    expect(matchesFilter(PRINTER, [NOZZLE], OPEN_FILTER)).toBe(true);
  });

  it('searches the device, its id, its vendor, its serial and its entities, ignoring case', () => {
    for (const search of [
      'workshop',
      'p1s',
      'BAMBU-LAB-P1S',
      'bambu lab',
      '01P00A',
      'nozzle temp',
      'sensor.bambu',
    ]) {
      expect(matchesFilter(PRINTER, [NOZZLE], { ...OPEN_FILTER, search })).toBe(true);
    }

    expect(matchesFilter(PRINTER, [NOZZLE], { ...OPEN_FILTER, search: 'shelly' })).toBe(false);
  });

  it('narrows by vendor and by area', () => {
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, vendorId: 'bambu-lab' })).toBe(true);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, vendorId: 'shelly' })).toBe(false);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, areaKey: 'workshop' })).toBe(true);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, areaKey: 'kitchen' })).toBe(false);
  });

  it('narrows to exactly one device when a link asked for it', () => {
    // `/devices?device=bambu-lab-p1s` from the vendor page: the registry, opened on that row.
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, deviceId: 'bambu-lab-p1s' })).toBe(true);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, deviceId: 'bambu-lab-x1c' })).toBe(false);
  });
});

describe('isNarrowing', () => {
  it('says whether a facet is set, search aside', () => {
    expect(isNarrowing(OPEN_FILTER)).toBe(false);
    expect(isNarrowing({ ...OPEN_FILTER, search: 'x' })).toBe(false);
    expect(isNarrowing({ ...OPEN_FILTER, vendorId: 'shelly' })).toBe(true);
    expect(isNarrowing({ ...OPEN_FILTER, deviceId: 'bambu-lab-p1s' })).toBe(true);
  });
});
