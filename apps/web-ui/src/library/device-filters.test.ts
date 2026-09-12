/**
 * The toolbar's every combination, tried without a page.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type DeviceView, type EntityView } from '@nebula-home/contracts';

import { matchesFilter, OPEN_FILTER } from './device-filters';

/** The printer, as the registry lists it. */
const PRINTER: DeviceView = {
  id: '00000000-0000-4000-8000-000000000010',
  owner: { kind: 'integration', id: 'bambu-lab-1' },
  externalId: '01P00A000000042',
  name: 'Workshop printer',
  manufacturer: 'Bambu Lab',
  model: 'P1S',
  swVersion: null,
  hwVersion: null,
  areaKey: 'workshop',
  areaName: 'Workshop',
  viaDeviceId: null,
  isEnabled: true,
  lastSeenAt: null,
  entityIds: [entityIdSchema.parse('sensor.p1s_nozzle_temperature')],
};

/** One of its entities. */
const NOZZLE: EntityView = {
  entityId: entityIdSchema.parse('sensor.p1s_nozzle_temperature'),
  domain: 'sensor',
  name: 'Nozzle temperature',
  icon: null,
  areaKey: 'workshop',
  areaName: 'Workshop',
  deviceId: PRINTER.id,
  source: 'bambu-lab-1',
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
    expect(matchesFilter(PRINTER, [NOZZLE], false, OPEN_FILTER)).toBe(true);
  });

  it('searches the device, its owner, its identifier and its entities, ignoring case', () => {
    for (const search of [
      'workshop',
      'p1s',
      'BAMBU-LAB-1',
      '01P00A',
      'nozzle temp',
      'sensor.p1s',
    ]) {
      expect(matchesFilter(PRINTER, [NOZZLE], false, { ...OPEN_FILTER, search })).toBe(true);
    }

    expect(matchesFilter(PRINTER, [NOZZLE], false, { ...OPEN_FILTER, search: 'shelly' })).toBe(
      false,
    );
  });

  it('narrows by owner and by area', () => {
    expect(matchesFilter(PRINTER, [], false, { ...OPEN_FILTER, ownerId: 'bambu-lab-1' })).toBe(
      true,
    );
    expect(matchesFilter(PRINTER, [], false, { ...OPEN_FILTER, ownerId: 'shelly-1' })).toBe(false);
    expect(matchesFilter(PRINTER, [], false, { ...OPEN_FILTER, areaKey: 'workshop' })).toBe(true);
    expect(matchesFilter(PRINTER, [], false, { ...OPEN_FILTER, areaKey: 'kitchen' })).toBe(false);
  });

  it('keeps only what is reporting when asked to', () => {
    expect(matchesFilter(PRINTER, [], true, { ...OPEN_FILTER, isReportingOnly: true })).toBe(true);
    expect(matchesFilter(PRINTER, [], false, { ...OPEN_FILTER, isReportingOnly: true })).toBe(
      false,
    );
  });
});
