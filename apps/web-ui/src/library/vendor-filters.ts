/**
 * Narrowing the vendors grid: a search, the wire, and whether the internet is needed.
 *
 * Pure, so the page's header can be tested by what it lets through rather than by what it
 * renders. The search reads more than the vendor's name on purpose: a person looking for their
 * printer types what is on the box, which is a model, not the company that made it.
 */
import type { IntegrationVendorView } from '@nebula-home/contracts';

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
  /** Free text, matched case-insensitively. Blank matches everything. */
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
  const needle = filter.search.trim().toLowerCase();

  if (needle !== '') {
    const haystack = [
      vendor.name,
      vendor.id,
      ...vendor.drivers.flatMap((driver) => [driver.name, ...driver.models]),
    ]
      .join('\n')
      .toLowerCase();

    if (!haystack.includes(needle)) {
      return false;
    }
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
