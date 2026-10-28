/**
 * The house the newer brokers' gallery samples share, as the boards tell it: its rooms, the
 * integrations its blasters, ports and proxies come from, and a cache with them in it. Each
 * broker's own samples (`infrared-samples.ts` and the rest) add its state on top.
 */
import { QueryClient } from '@tanstack/react-query';

import type { AreaView, DeviceView, IconView } from '@nebulahome/contracts';
import { BUILTIN_UI_FRAME, BUILTIN_UI_NODES, type UiIconId } from '@nebulahome/ui';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import { aDevice, anArea, aVendor } from '@/testing/fixtures';

/** The rooms, by name. */
export const SAMPLE_ROOMS = {
  living: '0a000000-0000-4000-8000-000000000001',
  bedroom: '0a000000-0000-4000-8000-000000000002',
  kitchen: '0a000000-0000-4000-8000-000000000003',
  office: '0a000000-0000-4000-8000-000000000004',
  bathroom: '0a000000-0000-4000-8000-000000000005',
  hall: '0a000000-0000-4000-8000-000000000006',
  garage: '0a000000-0000-4000-8000-000000000007',
  utility: '0a000000-0000-4000-8000-000000000008',
} as const;

/** What each room is called. */
const ROOM_NAMES: Readonly<Record<string, string>> = {
  living: 'Living room',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  office: 'Office',
  bathroom: 'Bathroom',
  hall: 'Hall',
  garage: 'Garage',
  utility: 'Utility room',
};

/** The rooms, as the areas list has them. */
export const SAMPLE_AREAS: AreaView[] = Object.entries(SAMPLE_ROOMS).map(([key, id]) =>
  anArea(id, 'room', null, {
    key,
    name: ROOM_NAMES[key] ?? key,
  }),
);

/** The integrations the brokers' devices come from. */
export const SAMPLE_VENDORS = [
  aVendor({ id: 'broadlink', name: 'Broadlink', color: '#3aa0ff' }),
  aVendor({ id: 'zigbee2mqtt', name: 'zigbee2mqtt', color: '#f2b84b' }),
  aVendor({ id: 'tuya', name: 'Tuya', color: '#ff6a3d' }),
  aVendor({ id: 'shelly', name: 'Shelly', color: '#62a9ff' }),
  aVendor({ id: 'victron', name: 'Victron', color: '#2b6cff' }),
  aVendor({ id: 'xiaomi', name: 'Xiaomi', color: '#ff6900' }),
  aVendor({ id: 'eve', name: 'Eve', color: '#8f9bb3' }),
];

/**
 * A catalogue glyph of the interface's set, as the catalogue serves it.
 *
 * @param id - The glyph.
 * @returns The icon.
 */
export function sampleIcon(id: UiIconId): IconView {
  return {
    id,
    name: id,
    keywords: [],
    origin: 'builtin',
    isOverridden: false,
    node: BUILTIN_UI_NODES[id],
    frame: BUILTIN_UI_FRAME,
  };
}

/**
 * A cache with the house in it and nothing fetched: the pages poll, and there is no server.
 *
 * @param devices - The house's devices the pages read.
 * @returns The cache.
 */
export function brokerSampleCache(devices: readonly DeviceView[] = []): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, staleTime: Infinity, retry: false } },
  });

  client.setQueryData(LIBRARY_QUERY_KEYS.devices, [...devices]);
  client.setQueryData(LIBRARY_QUERY_KEYS.areas, SAMPLE_AREAS);
  client.setQueryData(LIBRARY_QUERY_KEYS.vendors, SAMPLE_VENDORS);

  return client;
}

/**
 * A device of the house, in a room.
 *
 * @param id - Its id.
 * @param name - Its name.
 * @param room - Its room.
 * @param overrides - What else differs.
 * @returns The device.
 */
export function sampleDevice(
  id: string,
  name: string,
  room: keyof typeof SAMPLE_ROOMS,
  overrides: Partial<DeviceView> = {},
): DeviceView {
  return aDevice({ id, name, areaId: SAMPLE_ROOMS[room], ...overrides });
}
