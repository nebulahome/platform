/**
 * The header's every combination, tried without a page.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type DeviceView, type EntityView } from '@nebula-home/contracts';

import { DEVICE_FILTER_CODEC, isNarrowing, matchesFilter, OPEN_FILTER } from './device-filters';

/** The printer, as the registry lists it. */
const PRINTER: DeviceView = {
  id: 'bambu-lab-p1s',
  name: 'Workshop printer',
  icon: 'printer',
  kind: 'bambu-lab/printer',
  origin: 'integration',
  kindVersion: '1.0.0',
  vendorId: 'bambu-lab',
  driverId: 'printer',
  driverName: 'Printer',
  model: 'P1S',
  series: null,
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
  areaId: null,
  areaKey: 'workshop',
  areaName: 'Workshop',
  entityIds: [entityIdSchema.parse('sensor.bambu_lab_p1s_nozzle_temperature')],
  tagIds: [],
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
  tagIds: [],
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

  it('searches the tags on the device and on its entities, by name', () => {
    const tagged = { ...OPEN_FILTER, search: 'exterior' };

    expect(matchesFilter(PRINTER, [NOZZLE], tagged, { tagNames: ['Exterior'] })).toBe(true);
    expect(matchesFilter(PRINTER, [NOZZLE], tagged, { tagNames: [] })).toBe(false);
    expect(matchesFilter(PRINTER, [NOZZLE], tagged)).toBe(false);
  });

  it('narrows by vendor and by area', () => {
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, vendorId: 'bambu-lab' })).toBe(true);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, vendorId: 'shelly' })).toBe(false);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, areaKey: 'workshop' })).toBe(true);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, areaKey: 'kitchen' })).toBe(false);
  });
});

describe('the search, as every list searches', () => {
  it('finds a device by the vendor name the page shows, its driver and its entities’ synonyms', () => {
    const withSynonym = { ...NOZZLE, searchAliases: ['hotend'] };

    expect(
      matchesFilter(
        PRINTER,
        [NOZZLE],
        { ...OPEN_FILTER, search: 'bambu lab' },
        { vendorName: 'Bambu Lab' },
      ),
    ).toBe(true);
    expect(matchesFilter(PRINTER, [withSynonym], { ...OPEN_FILTER, search: 'hotend' })).toBe(true);
    expect(matchesFilter(PRINTER, [NOZZLE], { ...OPEN_FILTER, search: PRINTER.driverName })).toBe(
      true,
    );
  });

  it('wants every word, in any order, and ignores accents', () => {
    const named = { ...PRINTER, name: 'Stampante officina' };

    expect(matchesFilter(named, [], { ...OPEN_FILTER, search: 'officina stampante' })).toBe(true);
    expect(matchesFilter(named, [], { ...OPEN_FILTER, search: 'officìna' })).toBe(true);
    expect(matchesFilter(named, [], { ...OPEN_FILTER, search: 'officina garage' })).toBe(false);
  });
});

describe('DEVICE_FILTER_CODEC', () => {
  it('keeps the filter in the address, and leaves an open one out of it', () => {
    const filter = { ...OPEN_FILTER, search: 'nozzle', areaKey: 'workshop' };
    const written = DEVICE_FILTER_CODEC.write(filter);

    expect(written).toEqual({ q: 'nozzle', area: 'workshop' });
    expect(DEVICE_FILTER_CODEC.read(new URLSearchParams(written))).toEqual(filter);
    expect(DEVICE_FILTER_CODEC.write(OPEN_FILTER)).toEqual({});
  });
});

describe('isNarrowing', () => {
  it('says whether anything narrows the list, the search included', () => {
    expect(isNarrowing(OPEN_FILTER)).toBe(false);
    expect(isNarrowing({ ...OPEN_FILTER, search: '  ' })).toBe(false);
    expect(isNarrowing({ ...OPEN_FILTER, search: 'x' })).toBe(true);
    expect(isNarrowing({ ...OPEN_FILTER, vendorId: 'shelly' })).toBe(true);
    expect(isNarrowing({ ...OPEN_FILTER, areaKey: 'workshop' })).toBe(true);
  });
});
