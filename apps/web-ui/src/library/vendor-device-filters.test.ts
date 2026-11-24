/**
 * Narrowing an integration's devices: what each facet lets through, the order, and how the filter
 * lives in the address.
 */
import { describe, expect, it } from 'vitest';

import type { DeviceView } from '@nebulahome/contracts';

import { PRINTER } from '@/testing/printer-fixtures';

import {
  connectionName,
  countStandings,
  deviceAddress,
  isNarrowing,
  matchesVendorDevice,
  narrowingCount,
  OPEN_VENDOR_DEVICE_FILTER,
  sortVendorDevices,
  VENDOR_DEVICE_FILTER_CODEC,
  type VendorDeviceFilter,
} from './vendor-device-filters';

const NOW = new Date('2026-11-24T12:00:00Z');

/**
 * A device.
 *
 * @param name - Its name.
 * @param fields - What else to set.
 * @returns The device.
 */
function device(name: string, fields: Partial<DeviceView> = {}): DeviceView {
  return { ...PRINTER, id: name.toLowerCase(), name, ...fields };
}

/**
 * The open filter with some facets set.
 *
 * @param fields - The facets.
 * @returns The filter.
 */
function filter(fields: Partial<VendorDeviceFilter>): VendorDeviceFilter {
  return { ...OPEN_VENDOR_DEVICE_FILTER, ...fields };
}

/**
 * Whether a device on its own passes a filter.
 *
 * @param each - The device.
 * @param fields - The facets.
 * @param isPart - Whether it is a part of another device.
 * @returns True when it passes.
 */
function passes(each: DeviceView, fields: Partial<VendorDeviceFilter>, isPart = false): boolean {
  return matchesVendorDevice(each, filter(fields), { isPart, now: NOW });
}

describe('matchesVendorDevice', () => {
  it('finds a device by its address', () => {
    const plug = device('Plug', { transportConfig: { host: '192.168.1.61' } });

    expect(passes(plug, { search: '1.61' })).toBe(true);
    expect(passes(plug, { search: '1.62' })).toBe(false);
  });

  it('groups the states by standing', () => {
    expect(passes(device('A', { state: 'starting' }), { statuses: ['identifying'] })).toBe(true);
    expect(passes(device('B', { state: 'stopped' }), { statuses: ['disabled'] })).toBe(true);
    expect(passes(device('C', { state: 'failed' }), { statuses: ['running'] })).toBe(false);
  });

  it('narrows by room, model and transport', () => {
    const lamp = device('Lamp', { areaKey: 'kitchen', model: 'Plus 2PM', transport: 'shelly/rpc' });

    expect(passes(lamp, { areaKey: 'kitchen', model: 'Plus 2PM', transport: 'shelly/rpc' })).toBe(
      true,
    );
    expect(passes(lamp, { areaKey: 'garage' })).toBe(false);
    expect(passes(lamp, { model: 'Pro 3EM' })).toBe(false);
    expect(passes(lamp, { transport: 'matter' })).toBe(false);
  });

  it('keeps only the parts, or only the rest', () => {
    const ams = device('AMS');

    expect(passes(ams, { show: 'parts' }, true)).toBe(true);
    expect(passes(ams, { show: 'main' }, true)).toBe(false);
    expect(passes(ams, { show: 'parts' }, false)).toBe(false);
  });

  it('finds the silent ones, measured from when a never-heard device was added', () => {
    const hourAgo = new Date(NOW.getTime() - 61 * 60 * 1000);

    expect(passes(device('A', { lastUpdatedAt: hourAgo }), { isSilent: true })).toBe(true);
    expect(passes(device('B', { lastUpdatedAt: NOW }), { isSilent: true })).toBe(false);
    expect(passes(device('C', { createdAt: hourAgo }), { isSilent: true })).toBe(true);
    expect(passes(device('D'), { isSilent: true })).toBe(false);
  });

  it('finds the ones reached two ways', () => {
    const link: DeviceView['linked'] = { ways: [], preferred: 'lamp' };
    const linked = device('Lamp', { linked: link });

    expect(passes(linked, { isLinked: true })).toBe(true);
    expect(passes(device('Plug'), { isLinked: true })).toBe(false);
  });
});

describe('sortVendorDevices', () => {
  const kitchen = device('Kettle', {
    areaName: 'Kitchen',
    lastUpdatedAt: new Date('2026-11-24T11:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  const attic = device('Fan', {
    areaName: 'Attic',
    lastUpdatedAt: new Date('2026-11-24T11:59:00Z'),
    createdAt: null,
  });
  const nowhere = device('Bulb', {
    areaName: null,
    lastUpdatedAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  });
  const names = (sort: Parameters<typeof sortVendorDevices>[1]): string[] =>
    sortVendorDevices([kitchen, attic, nowhere], sort).map((each) => each.name);

  it('sorts by name, room, last report and age, with what is missing last', () => {
    expect(names('name')).toEqual(['Bulb', 'Fan', 'Kettle']);
    expect(names('area')).toEqual(['Fan', 'Kettle', 'Bulb']);
    expect(names('updated')).toEqual(['Fan', 'Kettle', 'Bulb']);
    expect(names('newest')).toEqual(['Bulb', 'Kettle', 'Fan']);
  });
});

describe('the rest', () => {
  it('round-trips the filter through the address, leaving the defaults out', () => {
    const set = filter({
      search: 'ams',
      statuses: ['failed', 'disabled'],
      areaKey: 'garage',
      model: 'H2D',
      transport: 'bambulab/mqtt',
      show: 'parts',
      isSilent: true,
      isLinked: true,
      sort: 'updated',
    });

    expect(
      VENDOR_DEVICE_FILTER_CODEC.read(new URLSearchParams(VENDOR_DEVICE_FILTER_CODEC.write(set))),
    ).toEqual(set);
    expect(VENDOR_DEVICE_FILTER_CODEC.write(OPEN_VENDOR_DEVICE_FILTER)).toEqual({});
    expect(VENDOR_DEVICE_FILTER_CODEC.read(new URLSearchParams({ show: '?' })).show).toBe('all');
  });

  it('counts the facets set, not the search or the order', () => {
    expect(narrowingCount(filter({ search: 'x', sort: 'area' }))).toBe(0);
    expect(narrowingCount(filter({ statuses: ['running', 'failed'], isSilent: true }))).toBe(2);
    expect(isNarrowing(filter({ search: ' ' }))).toBe(false);
    expect(isNarrowing(filter({ search: 'x' }))).toBe(true);
  });

  it('names a device address and a transport', () => {
    expect(deviceAddress(device('A', { transportConfig: { address: '10.0.0.2' } }))).toBe(
      '10.0.0.2',
    );
    expect(deviceAddress(device('B', { mac: '3C:2E:F5:A1:07:9B' }))).toBe('3C:2E:F5:A1:07:9B');
    expect(connectionName('bambulab/mqtt')).toBe('MQTT');
    expect(connectionName('shelly/rpc')).toBe('RPC');
    expect(connectionName('bambulab/cloud')).toBe('Cloud');
  });

  it('counts the devices by standing', () => {
    expect(
      countStandings([
        device('A'),
        device('B', { state: 'starting' }),
        device('C', { state: 'stopped' }),
      ]),
    ).toEqual({ running: 1, identifying: 1, failed: 0, disabled: 1 });
  });
});
