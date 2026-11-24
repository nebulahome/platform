/**
 * Narrowing an integration's Devices tab: a search, how each device stands, its room, its model,
 * the transport that reaches it, parts or the devices they belong to, the silent ones, the ones
 * reached two ways - and the order of the columns the table sorts by.
 *
 * Pure, so the tab can be tested by what it lets through rather than by what it draws. A part is
 * matched like any device; bringing a matched part's parent along is the tab's business.
 */
import type { DeviceView, IntegrationState } from '@nebulahome/contracts';

import { collator } from '@/i18n/formatters';
import { TRANSPORT_NAMES } from '@/lib/install-effects';
import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';
import type { SortDirection } from '@/lib/use-paging';

/**
 * How a device stands, as the Status facet groups the states: by the tone of their badge. On the
 * way up (`starting`, `identifying`), running, failed, and not running by choice or not at all
 * (`stopped`, `disabled`).
 */
export const DEVICE_STANDINGS = ['running', 'identifying', 'failed', 'disabled'] as const;

/** One standing. */
export type DeviceStanding = (typeof DEVICE_STANDINGS)[number];

/** Everything, only the devices others are part of and those on their own, or only the parts. */
export const DEVICE_SHOWS = ['all', 'main', 'parts'] as const;

/** What to show of the parts. */
export type DeviceShow = (typeof DEVICE_SHOWS)[number];

/** The columns the table sorts by; the first is the order it opens in. */
export const DEVICE_SORTS = ['name', 'area', 'model', 'status', 'updated'] as const;

/** One column to sort by. */
export type DeviceSort = (typeof DEVICE_SORTS)[number];

/** What a vendor's device table is narrowed by. */
export type VendorDeviceFilter = {
  /** Free text; every word must be found. Blank matches everything. */
  readonly search: string;

  /** Only devices standing so: any of them. None means any standing. */
  readonly statuses: readonly DeviceStanding[];

  /** Only devices in this room, by key. Blank means any. */
  readonly areaKey: string;

  /** Only devices of this model. Blank means any. */
  readonly model: string;

  /** Only devices reached over this transport. Blank means any. */
  readonly transport: string;

  /** Which of the devices and their parts to show. */
  readonly show: DeviceShow;

  /** Only devices nothing has been heard from for over an hour. */
  readonly isSilent: boolean;

  /** Only devices reached two ways. */
  readonly isLinked: boolean;
};

/** Every device, by name. */
export const OPEN_VENDOR_DEVICE_FILTER: VendorDeviceFilter = {
  search: '',
  statuses: [],
  areaKey: '',
  model: '',
  transport: '',
  show: 'all',
  isSilent: false,
  isLinked: false,
};

/** How long a device may say nothing before Silent for over an hour lists it. */
export const SILENT_AFTER_MS = 60 * 60 * 1000;

/** How the vendor device filter lives in the address. */
export const VENDOR_DEVICE_FILTER_CODEC: ListCodec<VendorDeviceFilter> = {
  keys: ['q', 'status', 'area', 'model', 'via', 'show', 'silent', 'linked'],

  /**
   * Reads the filter.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    statuses: (params.get('status') ?? '')
      .split(',')
      .flatMap((value) => DEVICE_STANDINGS.filter((standing) => standing === value)),
    areaKey: params.get('area') ?? '',
    model: params.get('model') ?? '',
    transport: params.get('via') ?? '',
    show: readChoice(params, 'show', DEVICE_SHOWS, 'all'),
    isSilent: params.get('silent') === '1',
    isLinked: params.get('linked') === '1',
  }),

  /**
   * Writes what differs from the open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) =>
    nonDefault({
      q: [filter.search, ''],
      status: [filter.statuses.join(','), ''],
      area: [filter.areaKey, ''],
      model: [filter.model, ''],
      via: [filter.transport, ''],
      show: [filter.show, 'all'],
      silent: [filter.isSilent ? '1' : '', ''],
      linked: [filter.isLinked ? '1' : '', ''],
    }),
};

/**
 * How many facets of the sheet are set: the number on its button. The search is not a facet: it
 * has its own field.
 *
 * @param filter - The filter.
 * @returns The count.
 */
export function narrowingCount(filter: VendorDeviceFilter): number {
  return (
    Number(filter.statuses.length > 0) +
    Number(filter.areaKey !== '') +
    Number(filter.model !== '') +
    Number(filter.transport !== '') +
    Number(filter.show !== 'all') +
    Number(filter.isSilent) +
    Number(filter.isLinked)
  );
}

/**
 * Whether a filter narrows anything at all.
 *
 * @param filter - The filter.
 * @returns True when the search or a facet is set.
 */
export function isNarrowing(filter: VendorDeviceFilter): boolean {
  return filter.search.trim() !== '' || narrowingCount(filter) > 0;
}

/**
 * How a device stands, for the Status facet.
 *
 * @param state - The device's lifecycle state.
 * @returns Its standing.
 */
export function standingOf(state: IntegrationState): DeviceStanding {
  switch (state) {
    case 'running':
      return 'running';
    case 'starting':
    case 'identifying':
      return 'identifying';
    case 'failed':
      return 'failed';
    case 'stopped':
    case 'disabled':
      return 'disabled';
  }
}

/**
 * Where the transport reaches a device: its host or address, else the MAC it said.
 *
 * @param device - The device.
 * @returns The address; null when the device has none.
 */
export function deviceAddress(device: Pick<DeviceView, 'transportConfig' | 'mac'>): string | null {
  const { host, address } = device.transportConfig;

  return typeof host === 'string' && host !== ''
    ? host
    : typeof address === 'string' && address !== ''
      ? address
      : device.mac;
}

/**
 * The model a device is listed under: the one it reported, else its driver's name.
 *
 * @param device - The device.
 * @returns The model.
 */
export function modelOf(device: Pick<DeviceView, 'model' | 'driverName'>): string {
  return device.model ?? device.driverName;
}

/**
 * What the Connection facet calls a transport: a vendor's own (`shelly/rpc`) by its last part, a
 * known one by its name, a short one in capitals, any other with a capital.
 *
 * @param transport - The transport: `shelly/rpc`, `matter`.
 * @returns Its name: `RPC`, `Matter`.
 */
export function connectionName(transport: string): string {
  const leaf = transport.slice(transport.lastIndexOf('/') + 1);
  const known = TRANSPORT_NAMES[leaf];

  if (known !== undefined) {
    return known;
  }

  return leaf.length <= 3 ? leaf.toUpperCase() : `${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}`;
}

/**
 * Whether nothing has been heard from a device for over an hour: its last report, or when the
 * house first had it for one that never reported.
 *
 * @param device - The device.
 * @param now - The time to measure from.
 * @returns True when it has been silent that long.
 */
export function isSilent(
  device: Pick<DeviceView, 'lastUpdatedAt' | 'createdAt'>,
  now: Date,
): boolean {
  const last = device.lastUpdatedAt ?? device.createdAt;

  return last !== null && now.getTime() - last.getTime() > SILENT_AFTER_MS;
}

/** What matching a device needs besides the device and the filter. */
export type DeviceMatchContext = {
  /** Whether the device is a part of another device in the list. */
  readonly isPart: boolean;

  /** The time Silent for over an hour measures from. */
  readonly now: Date;
};

/**
 * Whether a device passes the filter.
 *
 * @param device - The device.
 * @param filter - The filter.
 * @param context - See {@link DeviceMatchContext}.
 * @returns True when the search and every facet let it through.
 */
export function matchesVendorDevice(
  device: DeviceView,
  filter: VendorDeviceFilter,
  context: DeviceMatchContext,
): boolean {
  return (
    matchesQuery(
      [
        device.name,
        device.model,
        device.series,
        device.driverName,
        device.areaName,
        device.externalId,
        device.id,
        deviceAddress(device),
      ],
      filter.search,
    ) &&
    (filter.statuses.length === 0 || filter.statuses.includes(standingOf(device.state))) &&
    (filter.areaKey === '' || device.areaKey === filter.areaKey) &&
    (filter.model === '' || modelOf(device) === filter.model) &&
    (filter.transport === '' || device.transport === filter.transport) &&
    (filter.show !== 'main' || !context.isPart) &&
    (filter.show !== 'parts' || context.isPart) &&
    (!filter.isSilent || isSilent(device, context.now)) &&
    (!filter.isLinked || device.linked !== null)
  );
}

/**
 * Puts devices in the order of a column. A room or a report a device lacks puts it last, whichever
 * way the column sorts; ties go by name.
 *
 * Status goes by the Status facet's order - running, identifying, failed, disabled. Last updated
 * ascending is the most recent first, as the Automations table's Last run is.
 *
 * @param devices - The devices.
 * @param sort - The column.
 * @param direction - Which way.
 * @returns A sorted copy.
 */
export function sortVendorDevices(
  devices: readonly DeviceView[],
  sort: DeviceSort,
  direction: SortDirection,
): DeviceView[] {
  const names = collator();
  const sign = direction === 'asc' ? 1 : -1;

  /**
   * Puts the one lacking a value after the one that has it.
   *
   * @param left - One value.
   * @param right - The other.
   * @returns The comparison; 0 when both or neither lack it.
   */
  const lackingLast = (left: unknown, right: unknown): number =>
    Number(left === null) - Number(right === null);

  return [...devices].sort((left, right) => {
    const byName = names.compare(left.name, right.name);

    switch (sort) {
      case 'name':
        return sign * byName;
      case 'area':
        return (
          lackingLast(left.areaName, right.areaName) ||
          sign * names.compare(left.areaName ?? '', right.areaName ?? '') ||
          byName
        );
      case 'model':
        return sign * names.compare(modelOf(left), modelOf(right)) || byName;
      case 'status':
        return (
          sign *
            (DEVICE_STANDINGS.indexOf(standingOf(left.state)) -
              DEVICE_STANDINGS.indexOf(standingOf(right.state))) || byName
        );
      case 'updated':
        return (
          lackingLast(left.lastUpdatedAt, right.lastUpdatedAt) ||
          sign * ((right.lastUpdatedAt?.getTime() ?? 0) - (left.lastUpdatedAt?.getTime() ?? 0)) ||
          byName
        );
    }
  });
}

/**
 * How many devices stand each way, for the counts beside the Status boxes.
 *
 * @param devices - The devices.
 * @returns The count of each standing.
 */
export function countStandings(
  devices: readonly DeviceView[],
): Readonly<Record<DeviceStanding, number>> {
  const counts: Record<DeviceStanding, number> = {
    running: 0,
    identifying: 0,
    failed: 0,
    disabled: 0,
  };

  for (const device of devices) {
    counts[standingOf(device.state)] += 1;
  }

  return counts;
}
