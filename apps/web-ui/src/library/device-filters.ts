/**
 * Narrowing the registry: the search box and the facets behind the Filter button.
 *
 * Pure, so the header's every combination can be tried without a page. A search matches on
 * anything a person might type from memory - the device's name, its id, its model, its maker,
 * its vendor, the serial the hardware reports, and the addresses and names of its entities -
 * because the point of a registry search is to find the row for the thing in your hand, and
 * the one string you remember about it could be any of those.
 *
 * `deviceId` is the one facet nobody sets by hand: a link from the vendor page names the device
 * it was clicked on, and the page opens on that row alone.
 */
import type { DeviceView, EntityView } from '@nebula-home/contracts';

/** What the header has been set to. */
export type DeviceFilter = {
  /** Free text, matched case-insensitively. Blank matches everything. */
  readonly search: string;

  /** Only devices of this vendor. Blank means any. */
  readonly vendorId: string;

  /** Only devices in this area, by key. Blank means any. */
  readonly areaKey: string;

  /** Only this one device, from a link. Blank means any. */
  readonly deviceId: string;
};

/** The header as a page opens: everything shown. */
export const OPEN_FILTER: DeviceFilter = {
  search: '',
  vendorId: '',
  areaKey: '',
  deviceId: '',
};

/**
 * Whether any facet is set - the search aside, which has its own box to clear.
 *
 * @param filter - What the header has been set to.
 * @returns True when a facet narrows the list.
 */
export function isNarrowing(filter: DeviceFilter): boolean {
  return filter.vendorId !== '' || filter.areaKey !== '' || filter.deviceId !== '';
}

/**
 * Whether one device belongs in the list under a filter.
 *
 * @param device - The device.
 * @param entities - The entities it exposes.
 * @param filter - What the header has been set to.
 * @param tagNames - The names of the tags on the device and on its entities, for the search.
 * @returns True when every part of the filter admits it.
 */
export function matchesFilter(
  device: DeviceView,
  entities: readonly EntityView[],
  filter: DeviceFilter,
  tagNames: readonly string[] = [],
): boolean {
  if (filter.deviceId !== '' && device.id !== filter.deviceId) {
    return false;
  }

  if (filter.vendorId !== '' && device.vendorId !== filter.vendorId) {
    return false;
  }

  if (filter.areaKey !== '' && device.areaKey !== filter.areaKey) {
    return false;
  }

  const needle = filter.search.trim().toLowerCase();

  if (needle === '') {
    return true;
  }

  const haystack = [
    device.name,
    device.id,
    device.model ?? '',
    device.manufacturer ?? '',
    device.vendorId,
    device.externalId ?? '',
    device.areaName ?? '',
    ...entities.flatMap((entity) => [entity.entityId, entity.name]),
    ...tagNames,
  ]
    .join('\n')
    .toLowerCase();

  return haystack.includes(needle);
}
