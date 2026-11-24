/**
 * The registry: every device, how it is doing, and the way into each.
 *
 * A row is a device - its name, where it comes from, the room it is in, how many entities it
 * exposes, how it stands and when it was last heard from - and a press opens the device's own
 * page, where its entities are, each with what it reads.
 *
 * A device's standing is read off its entities' readings, the live ones whenever the channel the
 * shell keeps open has spoken. "Reporting" means an entity of it is reachable and has said
 * something; "seen" is when the newest of them spoke; "Update ready" is a firmware update one of
 * its entities offers. None is a column the API serves, and none needs to be: the readings are
 * already here.
 *
 * A device is added from its vendor's page - **Add device**, in the search's pill, opens the
 * integrations - and appears here the moment the hub has heard from it. As the board draws it: a
 * table sorted by any column but the icon, a page at a time, the page and its size in the address
 * beside the search and the filters, so the back button from a device's page returns to the list
 * as it was left. The table always follows the live readings: a device that stops reporting moves
 * out of a Status filter the moment it does.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { isUpdateOffered, type DeviceView, type EntityView } from '@nebulahome/contracts';
import { AppIcon, Button, FilterChips, TableFooter, useNow } from '@nebulahome/ui';

import { SortHeader } from '@/components/sort-header';
import { areaFacetChoices, buildAreaTree } from '@/lib/area-tree';
import { signalled } from '@/lib/signalled';
import { useListState } from '@/lib/use-list-state';
import { usePaging } from '@/lib/use-paging';
import { fetchDevices, fetchEntities, fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import { bySource, vendorNamesOf } from '@/library/device-entities';
import {
  DEVICE_FILTER_CODEC,
  isNarrowing,
  matchesFilter,
  matchesStatus,
  OPEN_FILTER,
} from '@/library/device-filters';
import {
  DEVICE_STATUS_ORDER,
  deviceStatusOf,
  type DeviceStatus,
  type DeviceStatusKind,
} from '@/library/device-status';
import { capabilityStateOf } from '@/library/entity-control';
import { readingOf, standingOf, type DeviceStanding } from '@/library/entity-reading';
import { modelOf } from '@/library/vendor-device-filters';
import { useLive } from '@/live/live-store';
import {
  activeRegistryFilters,
  DeviceFilterButton,
  type DeviceChoices,
} from '@/routes/library/device-filter';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { DEVICE_COLUMNS, DeviceRow } from '@/routes/library/device-row';
import { LibraryPage } from '@/routes/library/library-page';
import { NoMatches } from '@/routes/library/no-matches';
import { SearchField } from '@/routes/library/search-field';
import { useAreas } from '@/routes/library/use-areas';
import { useTags } from '@/routes/library/use-tags';

/** How often "seen" is re-read against the clock, so "now" turns into "1 minute ago". */
const CLOCK_MS = 30_000;

/** The columns the table sorts by; the first is the order it opens in. */
const SORTS = ['device', 'integration', 'room', 'entities', 'status', 'seen'] as const;

/** The columns whose order holds still between readings. */
type ColumnSort = 'device' | 'integration' | 'room' | 'entities';

/** One device and its entities: what the list and the filter need, before any reading. */
type DeviceEntry = {
  readonly device: DeviceView;
  readonly entities: readonly EntityView[];
};

/** One device with everything the row needs, its standing read off the readings now. */
type DeviceLine = DeviceEntry & {
  readonly standing: DeviceStanding;
  readonly status: DeviceStatus;
};

/**
 * Compares two devices by name, or by integration, room or entity count with the name breaking
 * ties.
 *
 * @param left - One device.
 * @param right - The other.
 * @param sort - The column the table is sorted by.
 * @param vendorNames - The vendors' names, by id, as the Integration column shows them.
 * @returns Their order, ascending.
 */
function compareByColumn(
  left: DeviceEntry,
  right: DeviceEntry,
  sort: ColumnSort,
  vendorNames: ReadonlyMap<string, string>,
): number {
  const byName = left.device.name.localeCompare(right.device.name);

  switch (sort) {
    case 'device':
      return byName;
    case 'integration':
      return (
        (vendorNames.get(left.device.vendorId) ?? left.device.vendorId).localeCompare(
          vendorNames.get(right.device.vendorId) ?? right.device.vendorId,
        ) || byName
      );
    case 'room':
      // A device in no room goes last.
      return (left.device.areaName ?? '￿').localeCompare(right.device.areaName ?? '￿') || byName;
    case 'entities':
      return left.entities.length - right.entities.length || byName;
  }
}

/**
 * Compares two devices by how they stand, the name breaking ties.
 *
 * @param left - One device.
 * @param right - The other.
 * @returns Their order, ascending.
 */
function compareByStatus(left: DeviceLine, right: DeviceLine): number {
  return (
    DEVICE_STATUS_ORDER.indexOf(left.status.kind) -
      DEVICE_STATUS_ORDER.indexOf(right.status.kind) ||
    left.device.name.localeCompare(right.device.name)
  );
}

/**
 * Compares two devices by when they were last heard from, the most recent first and one never
 * heard from last, the name breaking ties.
 *
 * @param left - One device.
 * @param right - The other.
 * @returns Their order, ascending.
 */
function compareBySeen(left: DeviceLine, right: DeviceLine): number {
  return (
    (right.standing.lastSeenAt?.getTime() ?? -Infinity) -
      (left.standing.lastSeenAt?.getTime() ?? -Infinity) ||
    left.device.name.localeCompare(right.device.name)
  );
}

/**
 * Renders the devices page.
 *
 * @returns The page.
 */
export function DevicesPage() {
  const { t } = useTranslation();

  const readings = useLive((state) => state.readings);
  const navigate = useNavigate();
  const { tags } = useTags();
  const { areas } = useAreas();
  const [filter, setFilter] = useListState(DEVICE_FILTER_CODEC);

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    queryFn: signalled(fetchDevices),
  });

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    queryFn: signalled(fetchEntities),
  });

  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,
    /**
     * Reads the vendors, for their names: a device carries the vendor's id.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every vendor the hub has loaded, or none while it is away.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        return await fetchVendors(signal);
      } catch {
        // The names are a nicety. A page that showed nothing because the hub was restarting
        // would be worse than one showing the vendors' ids.
        return [];
      }
    },
  });

  const icons = useCatalogueIcons((devices.data ?? []).map((device) => device.icon));
  const vendorNames = useMemo(() => vendorNamesOf(vendors.data ?? []), [vendors.data]);
  const { search, vendorId, areaKey, model, transport, tagId, show, isLinked } = filter;

  // What hangs on the lists and the filter alone - the grouping, the filtering, the facets - is
  // worked out again only when they change, not at every flush of readings: those reach each
  // device's standing, below.
  const { entries, matched, choices } = useMemo(() => {
    const groups = bySource(entities.data ?? [], devices.data ?? []);
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    const ids = new Set((devices.data ?? []).map((device) => device.id));
    const every: DeviceEntry[] = (devices.data ?? []).map((device) => ({
      device,
      entities: groups.get(device.id) ?? [],
    }));

    /**
     * Whether a device is a part of another device listed here.
     *
     * @param device - The device.
     * @returns True for a part.
     */
    const isPart = (device: DeviceView): boolean =>
      device.parentId !== null && ids.has(device.parentId);

    /**
     * The names of some tags.
     *
     * @param ids - The tags, by id.
     * @returns Their names, leaving out any no longer there.
     */
    const tagNames = (ids: readonly string[]): string[] =>
      ids.flatMap((id) => {
        const tag = tagsById.get(id);

        return tag === undefined ? [] : [tag.name];
      });

    const facets = { ...OPEN_FILTER, search, vendorId, areaKey, model, transport, tagId, show };
    const offered: DeviceChoices = {
      vendors: [...new Set(every.map((entry) => entry.device.vendorId))].map((id) => ({
        value: id,
        label: vendorNames.get(id) ?? id,
      })),
      // Each room under its floor, the floors by their number, the way the areas page reads.
      areas: areaFacetChoices(
        buildAreaTree(areas),
        areas,
        new Map(
          every.flatMap((entry) =>
            entry.device.areaKey === null
              ? []
              : [[entry.device.areaKey, entry.device.areaName] as const],
          ),
        ),
      ),
      models: [...new Set(every.map((entry) => modelOf(entry.device)))].toSorted((a, b) =>
        a.localeCompare(b),
      ),
      transports: [...new Set(every.map((entry) => entry.device.transport))].toSorted((a, b) =>
        a.localeCompare(b),
      ),
      tags: [...new Set(every.flatMap((entry) => entry.device.tagIds))].flatMap((id) => {
        const tag = tagsById.get(id);

        return tag === undefined ? [] : [{ value: id, label: tag.name }];
      }),
      hasParts: every.some((entry) => isPart(entry.device)),
    };

    return {
      entries: every,
      matched: every.filter((entry) =>
        matchesFilter(
          entry.device,
          entry.entities,
          { ...facets, isLinked },
          {
            vendorName: vendorNames.get(entry.device.vendorId),
            tagNames: [
              ...tagNames(entry.device.tagIds),
              ...entry.entities.flatMap((entity) => tagNames(entity.tagIds)),
            ],
            isPart: isPart(entry.device),
          },
        ),
      ),
      choices: offered,
    };
  }, [
    devices.data,
    entities.data,
    tags,
    vendorNames,
    areas,
    search,
    vendorId,
    areaKey,
    model,
    transport,
    tagId,
    show,
    isLinked,
  ]);

  // Drawn again every so often, for "seen" against the clock; the time itself is read below.
  useNow(CLOCK_MS);

  const now = new Date();

  /**
   * A device with its standing, read off its entities' readings now.
   *
   * @param entry - The device and its entities.
   * @returns The row's line.
   */
  const lineOf = (entry: DeviceEntry): DeviceLine => {
    const standing = standingOf(
      entry.entities.map((entity) => readingOf(entity, readings[entity.entityId])),
      entry.device.lastUpdatedAt,
    );
    const hasUpdate = entry.entities.some((entity) => {
      const update = capabilityStateOf(entity, readings[entity.entityId]).update;

      return update !== undefined && !update.isInstalling && isUpdateOffered(update);
    });

    return { ...entry, standing, status: deviceStatusOf(entry.device, standing, hasUpdate) };
  };

  // Every device is read: the Status facet counts and narrows by how each stands now.
  const lines = entries.map(lineOf);
  const counts: Record<DeviceStatusKind, number> = {
    unreachable: 0,
    silent: 0,
    update: 0,
    reporting: 0,
    disabled: 0,
  };

  for (const line of lines) {
    counts[line.status.kind] += 1;
  }

  const matchedIds = new Set(matched.map((entry) => entry.device.id));
  const shown = lines.filter(
    (line) => matchedIds.has(line.device.id) && matchesStatus(filter, line.status.kind),
  );
  const shownEntityCount = shown.reduce((sum, line) => sum + line.entities.length, 0);
  const paging = usePaging('devices', SORTS, shown.length);
  const { sort, direction } = paging;
  const sign = direction === 'asc' ? 1 : -1;
  const rows = paging.rows(
    shown.sort(
      (left, right) =>
        sign *
        (sort === 'status'
          ? compareByStatus(left, right)
          : sort === 'seen'
            ? compareBySeen(left, right)
            : compareByColumn(left, right, sort, vendorNames)),
    ),
  );
  const chips = activeRegistryFilters(filter, choices, setFilter);

  /** Opens the integrations, where a device is added from its vendor's page. */
  const addDevice = (): void => {
    void navigate('/integrations');
  };

  return (
    <LibraryPage
      title={t('library.devices.devices', 'Devices')}
      counted={(count) =>
        t('library.devices.count', {
          count,
          defaultValue_one: '{{count}} device',
          defaultValue_other: '{{count}} devices',
        })
      }
      count={devices.isPending ? undefined : entries.length}
      shownCount={shown.length}
      summary={[
        t('library.devices.entityCount', {
          count: shownEntityCount,
          defaultValue_one: '{{count}} entity',
          defaultValue_other: '{{count}} entities',
        }),
      ]}
      tools={
        // With nothing to search, Add device stands alone.
        entries.length === 0 ? (
          <Button onClick={addDevice}>
            <AppIcon id="plus" size={15} />
            {t('library.devices.addDevice', 'Add device')}
          </Button>
        ) : (
          <>
            <DeviceFilterButton
              filter={filter}
              choices={choices}
              counts={counts}
              onChange={setFilter}
            />
            <SearchField
              placeholder={t('library.devices.searchDevicesEntities', 'Search devices, entities…')}
              value={filter.search}
              // On a phone the pill takes what the page's margins and the Filter leave.
              className="w-[min(24rem,calc(100vw-12rem))] lg:w-96"
              action={
                <Button size="compact" className="shrink-0" onClick={addDevice}>
                  <AppIcon id="plus" size={14} />
                  {/* A phone keeps the room for the search it sits in: the plus alone, named to a reader. */}
                  <span className="max-sm:sr-only">
                    {t('library.devices.addDevice', 'Add device')}
                  </span>
                </Button>
              }
              onChange={(search) => {
                setFilter({ ...filter, search });
              }}
            />
          </>
        )
      }
      filters={
        <FilterChips
          filters={chips}
          onClearAll={() => {
            setFilter({ ...OPEN_FILTER, search: filter.search });
          }}
        />
      }
      isPending={devices.isPending || entities.isPending}
      error={devices.error ?? entities.error}
      isEmpty={entries.length === 0}
      emptyMessage={t(
        'library.devices.nothingYetAddA',
        'Nothing yet. Add a device from Integrations and it appears here as soon as the hub has heard from it.',
      )}
    >
      <div className="rounded-card border border-border bg-surface">
        <div
          className={`${DEVICE_COLUMNS} border-b border-border px-5 py-3 font-mono text-label text-foreground-subtle uppercase`}
        >
          <SortHeader
            label={t('library.devices.device', 'Device')}
            isSorted={paging.sort === 'device'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('device');
            }}
            className="justify-self-start"
          />
          <SortHeader
            label={t('library.devices.integration', 'Integration')}
            isSorted={paging.sort === 'integration'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('integration');
            }}
            className="hidden justify-self-start md:inline-flex"
          />
          <SortHeader
            label={t('library.devices.room', 'Room')}
            isSorted={paging.sort === 'room'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('room');
            }}
            className="hidden justify-self-start lg:inline-flex"
          />
          <SortHeader
            label={t('library.devices.entities', 'Entities')}
            isSorted={paging.sort === 'entities'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('entities');
            }}
            className="hidden justify-self-start md:inline-flex"
          />
          <SortHeader
            label={t('library.devices.status', 'Status')}
            isSorted={paging.sort === 'status'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('status');
            }}
            className="justify-self-start"
          />
          <SortHeader
            label={t('library.devices.seen', 'Seen')}
            isSorted={paging.sort === 'seen'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('seen');
            }}
            className="hidden justify-self-start md:inline-flex"
          />
        </div>

        {shown.length === 0 ? (
          <div className="p-4">
            <NoMatches
              query={filter.search}
              onClear={
                isNarrowing(filter)
                  ? () => {
                      setFilter(OPEN_FILTER);
                    }
                  : undefined
              }
            />
          </div>
        ) : (
          <ul>
            {rows.map((line) => (
              <DeviceRow
                key={line.device.id}
                device={line.device}
                vendorName={vendorNames.get(line.device.vendorId) ?? line.device.vendorId}
                icon={icons.get(line.device.icon ?? '')}
                entityCount={line.entities.length}
                standing={line.standing}
                status={line.status}
                now={now}
              />
            ))}
          </ul>
        )}

        <TableFooter
          page={paging.page}
          size={paging.size}
          total={shown.length}
          onPage={paging.setPage}
          onSize={paging.setSize}
        />
      </div>
    </LibraryPage>
  );
}
