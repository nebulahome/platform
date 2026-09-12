/**
 * Narrowing the registry: the search box, the two dropdowns and the reporting switch.
 *
 * Pure, so the toolbar's every combination can be tried without a page. A search matches on
 * anything a person might type from memory - the device's name, its model, its maker, its
 * owner, the identifier the owner knows it by, and the addresses and names of its entities -
 * because the point of a registry search is to find the row for the thing in your hand, and
 * the one string you remember about it could be any of those.
 */
import type { DeviceView, EntityView } from '@nebula-home/contracts';

/** What the toolbar has been set to. */
export type DeviceFilter = {
  /** Free text, matched case-insensitively. Blank matches everything. */
  readonly search: string;

  /** Only devices of this owner. Blank means any. */
  readonly ownerId: string;

  /** Only devices in this area, by key. Blank means any. */
  readonly areaKey: string;

  /** Only devices that are reporting. */
  readonly isReportingOnly: boolean;
};

/** The toolbar as a page opens: everything shown. */
export const OPEN_FILTER: DeviceFilter = {
  search: '',
  ownerId: '',
  areaKey: '',
  isReportingOnly: false,
};

/**
 * Whether one device belongs in the list under a filter.
 *
 * @param device - The device.
 * @param entities - The entities it exposes.
 * @param isReporting - Whether it is currently reporting, as its readings say.
 * @param filter - What the toolbar has been set to.
 * @returns True when every part of the filter admits it.
 */
export function matchesFilter(
  device: DeviceView,
  entities: readonly EntityView[],
  isReporting: boolean,
  filter: DeviceFilter,
): boolean {
  if (filter.ownerId !== '' && device.owner.id !== filter.ownerId) {
    return false;
  }

  if (filter.areaKey !== '' && device.areaKey !== filter.areaKey) {
    return false;
  }

  if (filter.isReportingOnly && !isReporting) {
    return false;
  }

  const needle = filter.search.trim().toLowerCase();

  if (needle === '') {
    return true;
  }

  const haystack = [
    device.name,
    device.model ?? '',
    device.manufacturer ?? '',
    device.owner.id,
    device.externalId,
    device.areaName ?? '',
    ...entities.flatMap((entity) => [entity.entityId, entity.name]),
  ]
    .join('\n')
    .toLowerCase();

  return haystack.includes(needle);
}
