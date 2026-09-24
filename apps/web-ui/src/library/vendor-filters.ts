/**
 * Narrowing the vendors grid: a search, the wire, and whether the internet is needed.
 *
 * Pure, so the page's header can be tested by what it lets through rather than by what it
 * renders. The search reads more than the vendor's name on purpose: a person looking for their
 * printer types what is on the box, which is a model, not the company that made it.
 */
import type { DiscoveredDevice, IntegrationVendorView } from '@nebula-home/contracts';

import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';

/**
 * Which wire to keep, or any.
 *
 * `own` is every transport a vendor ships in its own bundle - `shelly/rpc` - which the interface
 * cannot list by name, because a bundle installed tomorrow brings its own.
 */
export type TransportFilter = '' | 'http' | 'mqtt' | 'own';

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
};

/** The header as the page opens: everything shown. */
export const OPEN_VENDOR_FILTER: VendorFilter = { search: '', transport: '', internet: '' };

/**
 * Whether a filter narrows anything at all.
 *
 * @param filter - What the header is set to.
 * @returns True when some facet is set.
 */
export function isNarrowing(filter: VendorFilter): boolean {
  return filter.search.trim() !== '' || filter.transport !== '' || filter.internet !== '';
}

/** How the filter lives in the address. */
export const VENDOR_FILTER_CODEC: ListCodec<VendorFilter> = {
  keys: ['q', 'wire', 'internet'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    transport: readChoice<TransportFilter>(params, 'wire', ['', 'http', 'mqtt', 'own'], ''),
    internet: readChoice<InternetFilter>(params, 'internet', ['', 'needed', 'local'], ''),
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
 * Whether a transport is one a vendor ships rather than one of the platform's.
 *
 * @param transport - Its id.
 * @returns True for an id qualified by its vendor, such as `shelly/rpc`.
 */
export function isOwnTransport(transport: string): boolean {
  return transport.includes('/');
}

/**
 * Whether a vendor passes the filter.
 *
 * @param vendor - As the list serves it.
 * @param filter - What the header is set to.
 * @returns True when every facet lets it through.
 */
export function matchesVendorFilter(vendor: IntegrationVendorView, filter: VendorFilter): boolean {
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

  if (filter.transport === 'own' && !vendor.transports.some(isOwnTransport)) {
    return false;
  }

  if (
    filter.transport !== '' &&
    filter.transport !== 'own' &&
    !vendor.transports.includes(filter.transport)
  ) {
    return false;
  }

  if (filter.internet === 'needed' && !vendor.internetRequired) {
    return false;
  }

  if (filter.internet === 'local' && vendor.internetRequired) {
    return false;
  }

  return true;
}
