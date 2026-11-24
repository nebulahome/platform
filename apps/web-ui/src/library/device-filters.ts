/**
 * Narrowing the registry: the search box and the facets behind the Filter button - how each
 * device stands, its integration, its room, its model, the transport that reaches it, a tag, the
 * parts, and the ones reached two ways.
 *
 * Pure, so the header's every combination can be tried without a page. A search matches on
 * anything a person might type from memory - the device's name, its id, its model, its maker,
 * its vendor, the serial the hardware reports, and the addresses and names of its entities -
 * because the point of a registry search is to find the row for the thing in your hand, and
 * the one string you remember about it could be any of those.
 *
 * How a device stands is read off the live readings, which change under the list; the page puts
 * it to {@link matchesStatus} on its own, and everything else here holds still between readings.
 */
import type { DeviceView, EntityView } from '@nebulahome/contracts';

import { matchesQuery } from '@/lib/search-text';
import { nonDefault, readChoice, type ListCodec } from '@/lib/use-list-state';
import { DEVICE_STATUS_ORDER, type DeviceStatusKind } from '@/library/device-status';
import { DEVICE_SHOWS, modelOf, type DeviceShow } from '@/library/vendor-device-filters';

/** What the header has been set to. */
export type DeviceFilter = {
  /** Free text; every word must be found. Blank matches everything. */
  readonly search: string;

  /** Only devices standing so: any of them. None means any standing. */
  readonly statuses: readonly DeviceStatusKind[];

  /** Only devices of this vendor. Blank means any. */
  readonly vendorId: string;

  /** Only devices in this area, by key. Blank means any. */
  readonly areaKey: string;

  /** Only devices of this model. Blank means any. */
  readonly model: string;

  /** Only devices reached over this transport. Blank means any. */
  readonly transport: string;

  /** Only devices carrying this tag, by id. Blank means any. */
  readonly tagId: string;

  /** Which of the devices and their parts to show. */
  readonly show: DeviceShow;

  /** Only devices reached two ways. */
  readonly isLinked: boolean;
};

/** The header as a page opens: everything shown. */
export const OPEN_FILTER: DeviceFilter = {
  search: '',
  statuses: [],
  vendorId: '',
  areaKey: '',
  model: '',
  transport: '',
  tagId: '',
  show: 'all',
  isLinked: false,
};

/** How the filter lives in the address: `?q=`, `?status=`, `?vendor=`, `?area=` and the rest. */
export const DEVICE_FILTER_CODEC: ListCodec<DeviceFilter> = {
  keys: ['q', 'status', 'vendor', 'area', 'model', 'via', 'tag', 'show', 'linked'],

  /**
   * Reads the filter from the query.
   *
   * @param params - The query.
   * @returns The filter.
   */
  read: (params) => ({
    search: params.get('q') ?? '',
    statuses: (params.get('status') ?? '')
      .split(',')
      .flatMap((value) => DEVICE_STATUS_ORDER.filter((kind) => kind === value)),
    vendorId: params.get('vendor') ?? '',
    areaKey: params.get('area') ?? '',
    model: params.get('model') ?? '',
    transport: params.get('via') ?? '',
    tagId: params.get('tag') ?? '',
    show: readChoice(params, 'show', DEVICE_SHOWS, 'all'),
    isLinked: params.get('linked') === '1',
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
      status: [filter.statuses.join(','), ''],
      vendor: [filter.vendorId, ''],
      area: [filter.areaKey, ''],
      model: [filter.model, ''],
      via: [filter.transport, ''],
      tag: [filter.tagId, ''],
      show: [filter.show, 'all'],
      linked: [filter.isLinked ? '1' : '', ''],
    }),
};

/**
 * How many facets of the sheet are set: the number on its button. The search is not one - it has
 * its own field.
 *
 * @param filter - What the header has been set to.
 * @returns The count.
 */
export function narrowingCount(filter: DeviceFilter): number {
  return (
    Number(filter.statuses.length > 0) +
    Number(filter.vendorId !== '') +
    Number(filter.areaKey !== '') +
    Number(filter.model !== '') +
    Number(filter.transport !== '') +
    Number(filter.tagId !== '') +
    Number(filter.show !== 'all') +
    Number(filter.isLinked)
  );
}

/**
 * Whether anything narrows the list: the search or a facet.
 *
 * @param filter - What the header has been set to.
 * @returns True when fewer than every device may be shown.
 */
export function isNarrowing(filter: DeviceFilter): boolean {
  return filter.search.trim() !== '' || narrowingCount(filter) > 0;
}

/** What matching a device needs besides the device, its entities and the filter. */
export type DeviceMatchContext = {
  /** The names of the tags on the device and on its entities, for the search. */
  readonly tagNames?: readonly string[];

  /** The vendor's name as the Integration column shows it, for the search. */
  readonly vendorName?: string | undefined;

  /** Whether the device is a part of another device in the list. */
  readonly isPart?: boolean;
};

/**
 * Whether one device belongs in the list under a filter, its standing aside.
 *
 * The search follows the rule every search box does ({@link matchesQuery}): case and accents
 * aside, every word typed must be found in one of the fields.
 *
 * @param device - The device.
 * @param entities - The entities it exposes.
 * @param filter - What the header has been set to.
 * @param context - See {@link DeviceMatchContext}.
 * @returns True when the search and every facet but Status admit it.
 */
export function matchesFilter(
  device: DeviceView,
  entities: readonly EntityView[],
  filter: DeviceFilter,
  context: DeviceMatchContext = {},
): boolean {
  const isPart = context.isPart ?? false;

  return (
    (filter.vendorId === '' || device.vendorId === filter.vendorId) &&
    (filter.areaKey === '' || device.areaKey === filter.areaKey) &&
    (filter.model === '' || modelOf(device) === filter.model) &&
    (filter.transport === '' || device.transport === filter.transport) &&
    (filter.tagId === '' || device.tagIds.includes(filter.tagId)) &&
    (filter.show !== 'main' || !isPart) &&
    (filter.show !== 'parts' || isPart) &&
    (!filter.isLinked || device.linked !== null) &&
    matchesQuery(
      [
        device.name,
        device.id,
        device.model,
        device.manufacturer,
        device.vendorId,
        context.vendorName,
        device.driverName,
        device.externalId,
        device.areaName,
        ...entities.flatMap((entity) => [entity.entityId, entity.name, ...entity.searchAliases]),
        ...(context.tagNames ?? []),
      ],
      filter.search,
    )
  );
}

/**
 * Whether a device standing so passes the Status facet.
 *
 * @param filter - What the header has been set to.
 * @param kind - How the device stands now.
 * @returns True when no standing is ticked or this one is.
 */
export function matchesStatus(filter: DeviceFilter, kind: DeviceStatusKind): boolean {
  return filter.statuses.length === 0 || filter.statuses.includes(kind);
}
