/**
 * The header's every combination, tried without a page.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type DeviceView, type EntityView } from '@nebulahome/contracts';

import { LINKED_SAMPLE_DEVICE } from '@/testing/linked-samples';

import {
  DEVICE_FILTER_CODEC,
  isNarrowing,
  matchesFilter,
  matchesStatus,
  narrowingCount,
  OPEN_FILTER,
} from './device-filters';

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
  mac: null,
  serialNumber: null,
  createdAt: null,
  linked: null,
  suggestedLinks: [],
  parentId: null,
  childIds: [],
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
  addresses: [],
  linked: null,
  key: null,
  createdAt: null,
  original: null,
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

  it('narrows by model - the driver for a device that reported none - transport and tag', () => {
    const unnamed = { ...PRINTER, model: null, tagIds: ['tag-1'] };

    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, model: 'P1S' })).toBe(true);
    expect(matchesFilter(unnamed, [], { ...OPEN_FILTER, model: 'Printer' })).toBe(true);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, transport: 'mqtt' })).toBe(true);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, transport: 'http' })).toBe(false);
    expect(matchesFilter(unnamed, [], { ...OPEN_FILTER, tagId: 'tag-1' })).toBe(true);
    expect(matchesFilter(PRINTER, [], { ...OPEN_FILTER, tagId: 'tag-1' })).toBe(false);
  });

  it('shows the main devices or the parts, and the ones reached two ways', () => {
    const main = { ...OPEN_FILTER, show: 'main' as const };
    const parts = { ...OPEN_FILTER, show: 'parts' as const };
    const linked = { ...OPEN_FILTER, isLinked: true };

    expect(matchesFilter(PRINTER, [], main, { isPart: false })).toBe(true);
    expect(matchesFilter(PRINTER, [], main, { isPart: true })).toBe(false);
    expect(matchesFilter(PRINTER, [], parts, { isPart: true })).toBe(true);
    expect(matchesFilter(PRINTER, [], parts)).toBe(false);
    expect(matchesFilter(PRINTER, [], linked)).toBe(false);
    expect(matchesFilter({ ...PRINTER, linked: LINKED_SAMPLE_DEVICE.linked }, [], linked)).toBe(
      true,
    );
  });
});

describe('matchesStatus', () => {
  it('admits any standing until some are ticked, then those alone', () => {
    expect(matchesStatus(OPEN_FILTER, 'silent')).toBe(true);
    expect(matchesStatus({ ...OPEN_FILTER, statuses: ['silent', 'update'] }, 'update')).toBe(true);
    expect(matchesStatus({ ...OPEN_FILTER, statuses: ['silent'] }, 'reporting')).toBe(false);
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

  it('keeps the standings as a list, the switch as a 1, and drops what does not read', () => {
    const filter = {
      ...OPEN_FILTER,
      statuses: ['unreachable', 'update'] as const,
      model: 'P1S',
      transport: 'mqtt',
      tagId: 'tag-1',
      show: 'parts' as const,
      isLinked: true,
    };
    const written = DEVICE_FILTER_CODEC.write(filter);

    expect(written).toEqual({
      status: 'unreachable,update',
      model: 'P1S',
      via: 'mqtt',
      tag: 'tag-1',
      show: 'parts',
      linked: '1',
    });
    expect(DEVICE_FILTER_CODEC.read(new URLSearchParams(written))).toEqual(filter);
    expect(
      DEVICE_FILTER_CODEC.read(new URLSearchParams({ status: 'silent,bogus', show: 'odd' })),
    ).toEqual({ ...OPEN_FILTER, statuses: ['silent'] });
  });
});

describe('isNarrowing', () => {
  it('says whether anything narrows the list, the search included', () => {
    expect(isNarrowing(OPEN_FILTER)).toBe(false);
    expect(isNarrowing({ ...OPEN_FILTER, search: '  ' })).toBe(false);
    expect(isNarrowing({ ...OPEN_FILTER, search: 'x' })).toBe(true);
    expect(isNarrowing({ ...OPEN_FILTER, vendorId: 'shelly' })).toBe(true);
    expect(isNarrowing({ ...OPEN_FILTER, areaKey: 'workshop' })).toBe(true);
    expect(isNarrowing({ ...OPEN_FILTER, statuses: ['silent'] })).toBe(true);
  });
});

describe('narrowingCount', () => {
  it('counts the facets set, the search left out', () => {
    expect(narrowingCount({ ...OPEN_FILTER, search: 'x' })).toBe(0);
    expect(
      narrowingCount({
        ...OPEN_FILTER,
        statuses: ['silent', 'update'],
        tagId: 'tag-1',
        show: 'main',
        isLinked: true,
      }),
    ).toBe(4);
  });
});
