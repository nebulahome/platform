/**
 * Narrowing the vendors grid: a search, how each stands, the wire, whether the internet is needed,
 * whether it has new devices on the network or an update waiting - and the order it is shown in.
 *
 * Pure, so the page's header can be tested by what it lets through rather than by what it
 * renders. The search reads more than the vendor's name on purpose: a person looking for their
 * printer types what is on the box, which is a model, not the company that made it.
 */
import {
  TRANSPORT_WIRES,
  type DiscoveredDevice,
  type IntegrationVendorView,
  type TransportWire,
} from '@nebulahome/contracts';

import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';
import {
  VENDOR_STATUS_KINDS,
  VENDOR_STATUS_LABELS,
  vendorStatusOf,
  type VendorStatusKind,
} from '@/library/vendor-status';

/**
 * The wires the interface names: what a person recognises on the box - HTTP, MQTT, Bluetooth LE,
 * Zigbee, a device's own datagrams on the network, Modbus.
 *
 * A transport a vendor ships in its bundle - `shelly/rpc`, `govee/lan` - is that vendor's way of
 * speaking, not a wire anybody shops by, and is not named: its manifest says which wires it goes
 * over, and the hub serves the vendor's wires with them in.
 */
export const WIRES = TRANSPORT_WIRES;

/** A wire the interface names. */
export type Wire = TransportWire;

/** Which wire to keep, or any. */
export type TransportFilter = '' | Wire;

/** Which vendors to keep by their need for the internet, or any. */
export type InternetFilter = '' | 'needed' | 'local';

/** What the header has been set to. */
export type VendorFilter = {
  /** Free text; every word must be found. Blank matches everything. */
  readonly search: string;

  /** Only vendors with a driver on this wire. Blank means any. */
  readonly transport: TransportFilter;

  /** Only vendors that need the internet, or only those that do not. Blank means any. */
  readonly internet: InternetFilter;

  /** Only vendors standing so: any of them. None means any standing. */
  readonly statuses: readonly VendorStatusKind[];

  /** Only vendors with devices found on the network that nobody has added. */
  readonly hasNew: boolean;

  /** Only vendors with a newer release, or a rebuild, waiting. */
  readonly hasUpdate: boolean;

  /** The order the grid is shown in. */
  readonly sort: VendorSort;
};

/** The orders the grid can be shown in. */
export const VENDOR_SORTS = ['name', 'devices', 'recent'] as const;

/** One order. */
export type VendorSort = (typeof VENDOR_SORTS)[number];

/** The header as the page opens: everything shown, by name. */
export const OPEN_VENDOR_FILTER: VendorFilter = {
  search: '',
  transport: '',
  internet: '',
  statuses: [],
  hasNew: false,
  hasUpdate: false,
  sort: 'name',
};

/**
 * Whether a filter narrows anything at all.
 *
 * @param filter - What the header is set to.
 * @returns True when some facet is set.
 */
export function isNarrowing(filter: VendorFilter): boolean {
  return filter.search.trim() !== '' || narrowingCount(filter) > 0;
}

/**
 * How many facets of the sheet are set: the number on its button. The search and the order are
 * not facets - the one has its own field, the other narrows nothing.
 *
 * @param filter - What the header is set to.
 * @returns The count.
 */
export function narrowingCount(filter: VendorFilter): number {
  return (
    Number(filter.statuses.length > 0) +
    Number(filter.transport !== '') +
    Number(filter.internet !== '') +
    Number(filter.hasNew) +
    Number(filter.hasUpdate)
  );
}

/** How the filter lives in the address. */
export const VENDOR_FILTER_CODEC: ListCodec<VendorFilter> = {
  keys: ['q', 'wire', 'internet', 'status', 'new', 'update', 'sort'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    transport: readChoice<TransportFilter>(params, 'wire', ['', ...WIRES], ''),
    internet: readChoice<InternetFilter>(params, 'internet', ['', 'needed', 'local'], ''),
    statuses: (params.get('status') ?? '')
      .split(',')
      .flatMap((value) => VENDOR_STATUS_KINDS.filter((kind) => kind === value)),
    hasNew: params.get('new') === '1',
    hasUpdate: params.get('update') === '1',
    sort: readChoice<VendorSort>(params, 'sort', VENDOR_SORTS, 'name'),
  }),

  /**
   * Writes what differs from an open filter.
   *
   * @param filter - The filter.
   * @returns The query entries.
   */
  write: (filter) =>
    nonDefault({
      q: [filter.search, ''],
      wire: [filter.transport, ''],
      internet: [filter.internet, ''],
      status: [filter.statuses.join(','), ''],
      new: [filter.hasNew ? '1' : '', ''],
      update: [filter.hasUpdate ? '1' : '', ''],
      sort: [filter.sort, 'name'],
    }),
};

/**
 * Whether a device found on the network answers the search.
 *
 * The strip of found devices sits above the grid and follows the same search, so typing
 * "plug" does not leave a strip of lamps in view above a grid narrowed to plugs.
 *
 * @param device - The device found.
 * @param vendorName - Its vendor's name.
 * @param search - What was typed.
 * @returns True when every word is in its name, model, address, vendor or its model choices.
 */
export function matchesDiscovered(
  device: DiscoveredDevice,
  vendorName: string | undefined,
  search: string,
): boolean {
  return matchesQuery(
    [
      device.name,
      device.model,
      device.address,
      device.externalId,
      vendorName,
      ...device.modelChoices,
    ],
    search,
  );
}

/**
 * The wires a vendor's devices are reached over.
 *
 * @param vendor - As the list serves it.
 * @returns Its wires, in the order the interface lists them; none for a vendor whose own
 * transports declare none.
 */
export function wiresOf(vendor: Pick<IntegrationVendorView, 'wires'>): Wire[] {
  return WIRES.filter((wire) => vendor.wires.includes(wire));
}

/**
 * Whether a vendor passes the filter.
 *
 * @param vendor - As the list serves it.
 * @param filter - What the header is set to.
 * @param foundCount - How many of its devices were found on the network and not added.
 * @returns True when every facet lets it through.
 */
export function matchesVendorFilter(
  vendor: IntegrationVendorView,
  filter: VendorFilter,
  foundCount = 0,
): boolean {
  if (
    !matchesQuery(
      [
        vendor.name,
        vendor.id,
        ...vendor.drivers.flatMap((driver) => [driver.name, ...driver.models]),
      ],
      filter.search,
    )
  ) {
    return false;
  }

  if (filter.transport !== '' && !vendor.wires.includes(filter.transport)) {
    return false;
  }

  if (filter.internet === 'needed' && !vendor.internetRequired) {
    return false;
  }

  if (filter.internet === 'local' && vendor.internetRequired) {
    return false;
  }

  if (filter.statuses.length > 0 && !filter.statuses.includes(vendorStatusOf(vendor).kind)) {
    return false;
  }

  if (filter.hasNew && foundCount === 0) {
    return false;
  }

  if (
    filter.hasUpdate &&
    vendor.update?.hasUpdate !== true &&
    vendor.update?.hasNewBuild !== true
  ) {
    return false;
  }

  return true;
}

/**
 * Puts the vendors in the order asked for.
 *
 * Most devices puts the busiest first; recently added puts the newest install first, and the
 * vendors under development - read from the hub's development folder, never installed - after
 * every installed one. Ties go
 * by name.
 *
 * @param vendors - As the list serves them.
 * @param sort - The order.
 * @returns A sorted copy.
 */
export function sortVendors(
  vendors: readonly IntegrationVendorView[],
  sort: VendorSort,
): IntegrationVendorView[] {
  /**
   * When a vendor was installed, for the newest first; zero for one never installed.
   *
   * @param vendor - The vendor.
   * @returns The time, in milliseconds.
   */
  const installedAt = (vendor: IntegrationVendorView): number =>
    vendor.install === null ? 0 : Date.parse(vendor.install.installedAt);

  return [...vendors].sort((left, right) => {
    const byName = left.name.localeCompare(right.name);

    switch (sort) {
      case 'name':
        return byName;
      case 'devices':
        return right.deviceCount - left.deviceCount || byName;
      case 'recent':
        return installedAt(right) - installedAt(left) || byName;
    }
  });
}

/**
 * How many vendors stand each way, for the counts beside the filter's boxes.
 *
 * @param vendors - As the list serves them.
 * @returns The count of each standing.
 */
export function countStatuses(
  vendors: readonly IntegrationVendorView[],
): Readonly<Record<VendorStatusKind, number>> {
  const counts: Record<VendorStatusKind, number> = {
    running: 0,
    degraded: 0,
    'needs-sign-in': 0,
    'needs-setup': 0,
    idle: 0,
  };

  for (const vendor of vendors) {
    counts[vendorStatusOf(vendor).kind] += 1;
  }

  return counts;
}

/**
 * The standings chosen, in words, for the chip that shows them.
 *
 * @param statuses - The standings chosen.
 * @returns "Running, Degraded".
 */
export function statusesText(statuses: readonly VendorStatusKind[]): string {
  return VENDOR_STATUS_KINDS.filter((kind) => statuses.includes(kind))
    .map((kind) => VENDOR_STATUS_LABELS[kind])
    .join(', ');
}
