/**
 * Narrowing the registry: the search box and the facets behind the Filter button.
 *
 * Pure, so the header's every combination can be tried without a page. A search matches on
 * anything a person might type from memory - the device's name, its id, its model, its maker,
 * its vendor, the serial the hardware reports, and the addresses and names of its entities -
 * because the point of a registry search is to find the row for the thing in your hand, and
 * the one string you remember about it could be any of those.
 */
import type { DeviceView, EntityView } from '@nebulahome/contracts';

import { matchesQuery } from '@/lib/search-text';
import { nonDefault, type ListCodec } from '@/lib/use-list-state';

/** What the header has been set to. */
export type DeviceFilter = {
  /** Free text; every word must be found. Blank matches everything. */
  readonly search: string;

  /** Only devices of this vendor. Blank means any. */
  readonly vendorId: string;

  /** Only devices in this area, by key. Blank means any. */
  readonly areaKey: string;
};

/** The header as a page opens: everything shown. */
export const OPEN_FILTER: DeviceFilter = {
  search: '',
  vendorId: '',
  areaKey: '',
};

/** How the filter lives in the address: `?q=`, `?vendor=` and `?area=`. */
export const DEVICE_FILTER_CODEC: ListCodec<DeviceFilter> = {
  keys: ['q', 'vendor', 'area'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    vendorId: params.get('vendor') ?? '',
    areaKey: params.get('area') ?? '',
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
      vendor: [filter.vendorId, ''],
      area: [filter.areaKey, ''],
    }),
};

/**
 * Whether anything narrows the list: the search or a facet.
 *
 * @param filter - What the header has been set to.
 * @returns True when fewer than every device may be shown.
 */
export function isNarrowing(filter: DeviceFilter): boolean {
  return filter.search.trim() !== '' || filter.vendorId !== '' || filter.areaKey !== '';
}

/** Words the search finds a device by that the device row does not carry itself. */
export type DeviceSearchWords = {
  /** The names of the tags on the device and on its entities. */
  readonly tagNames?: readonly string[];

  /** The vendor's name as the Integration column shows it. */
  readonly vendorName?: string | undefined;
};

/**
 * Whether one device belongs in the list under a filter.
 *
 * The search follows the rule every search box does ({@link matchesQuery}): case and accents
 * aside, every word typed must be found in one of the fields.
 *
 * @param device - The device.
 * @param entities - The entities it exposes.
 * @param filter - What the header has been set to.
 * @param words - Tag names and the vendor's name, for the search.
 * @returns True when every part of the filter admits it.
 */
export function matchesFilter(
  device: DeviceView,
  entities: readonly EntityView[],
  filter: DeviceFilter,
  words: DeviceSearchWords = {},
): boolean {
  if (filter.vendorId !== '' && device.vendorId !== filter.vendorId) {
    return false;
  }

  if (filter.areaKey !== '' && device.areaKey !== filter.areaKey) {
    return false;
  }

  return matchesQuery(
    [
      device.name,
      device.id,
      device.model,
      device.manufacturer,
      device.vendorId,
      words.vendorName,
      device.driverName,
      device.externalId,
      device.areaName,
      ...entities.flatMap((entity) => [entity.entityId, entity.name, ...entity.searchAliases]),
      ...(words.tagNames ?? []),
    ],
    filter.search,
  );
}
