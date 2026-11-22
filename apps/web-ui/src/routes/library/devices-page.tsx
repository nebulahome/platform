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
 * A device is added from its vendor's page - **Add device** opens the integrations - and appears
 * here the moment the hub has heard from it. As the board draws it: a table sorted by Device, Room
 * or Status, a page at a time, the page and its size in the address beside the search and the
 * filters, so the back button from a device's page returns to the list as it was left. **Live
 * updates** off holds the readings where they were, for reading a list that does not move.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { isUpdateOffered, type DeviceView, type EntityView } from '@nebulahome/contracts';
import { AppIcon, Button, Switch, TableFooter, useNow } from '@nebulahome/ui';

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
  OPEN_FILTER,
} from '@/library/device-filters';
import { DEVICE_STATUS_ORDER, deviceStatusOf, type DeviceStatus } from '@/library/device-status';
import { capabilityStateOf } from '@/library/entity-control';
import { readingOf, standingOf, type DeviceStanding } from '@/library/entity-reading';
import { useLive } from '@/live/live-store';
import { DeviceFilterButton } from '@/routes/library/device-filter';
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
const SORTS = ['device', 'room', 'status'] as const;

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
 * Compares two devices by name, or by room with the name breaking ties.
 *
 * @param left - One device.
 * @param right - The other.
 * @param sort - The column the table is sorted by.
 * @returns Their order, ascending.
 */
function compareByColumn(left: DeviceEntry, right: DeviceEntry, sort: 'device' | 'room'): number {
  const byName = left.device.name.localeCompare(right.device.name);

  return sort === 'room'
    ? // A device in no room goes last.
      (left.device.areaName ?? '￿').localeCompare(right.device.areaName ?? '￿') || byName
    : byName;
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
 * Renders the devices page.
 *
 * @returns The page.
 */
export function DevicesPage() {
  const { t } = useTranslation();

  const liveReadings = useLive((state) => state.readings);
  const [held, setHeld] = useState<typeof liveReadings | null>(null);
  const readings = held ?? liveReadings;
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
  const { search, vendorId, areaKey } = filter;

  // What hangs on the lists and the filter alone - the grouping, the filtering, the facets - is
  // worked out again only when they change, not at every flush of readings: those reach the
  // standing of the rows drawn, below.
  const { entries, matched, vendorOptions, areaOptions } = useMemo(() => {
    const groups = bySource(entities.data ?? [], devices.data ?? []);
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    const every: DeviceEntry[] = (devices.data ?? []).map((device) => ({
      device,
      entities: groups.get(device.id) ?? [],
    }));

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

    return {
      entries: every,
      matched: every.filter((entry) =>
        matchesFilter(
          entry.device,
          entry.entities,
          { search, vendorId, areaKey },
          {
            vendorName: vendorNames.get(entry.device.vendorId),
            tagNames: [
              ...tagNames(entry.device.tagIds),
              ...entry.entities.flatMap((entity) => tagNames(entity.tagIds)),
            ],
          },
        ),
      ),
      vendorOptions: [...new Set(every.map((entry) => entry.device.vendorId))].map((id) => ({
        value: id,
        label: vendorNames.get(id) ?? id,
      })),
      // Each room under its floor, the floors by their number, the way the areas page reads.
      areaOptions: areaFacetChoices(
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
    };
  }, [devices.data, entities.data, tags, vendorNames, areas, search, vendorId, areaKey]);

  // Drawn again every so often, for "seen" against the clock; the time itself is read below.
  useNow(CLOCK_MS);

  const now = new Date();
  const shownEntityCount = matched.reduce((sum, entry) => sum + entry.entities.length, 0);
  const paging = usePaging('devices', SORTS, matched.length);
  const { sort, direction } = paging;
  const sign = direction === 'asc' ? 1 : -1;

  // By name or room the order does not move with the readings, so it too is kept.
  const byColumn = useMemo(
    () =>
      sort === 'status'
        ? matched
        : [...matched].sort((left, right) => sign * compareByColumn(left, right, sort)),
    [matched, sort, sign],
  );

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

  // By status every device is read to be placed; otherwise only the page's rows are.
  const rows =
    sort === 'status'
      ? paging.rows(matched.map(lineOf).sort((left, right) => sign * compareByStatus(left, right)))
      : paging.rows(byColumn).map(lineOf);

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
      shownCount={matched.length}
      summary={[
        t('library.devices.entityCount', {
          count: shownEntityCount,
          defaultValue_one: '{{count}} entity',
          defaultValue_other: '{{count}} entities',
        }),
      ]}
      tools={
        <>
          <span aria-hidden="true" className="text-ui-sm text-foreground-muted">
            {t('library.devices.liveUpdates', 'Live updates')}
          </span>
          <Switch
            label={t('library.devices.liveUpdates', 'Live updates')}
            isOn={held === null}
            onChange={(isOn) => {
              setHeld(isOn ? null : liveReadings);
            }}
          />
          <SearchField
            placeholder={t('library.devices.searchDevicesEntities', 'Search devices, entities…')}
            value={filter.search}
            onChange={(search) => {
              setFilter({ ...filter, search });
            }}
          />
          <DeviceFilterButton
            filter={filter}
            vendors={vendorOptions}
            areas={areaOptions}
            onChange={setFilter}
          />
        </>
      }
      action={
        <Button
          onClick={() => {
            void navigate('/integrations');
          }}
        >
          <AppIcon id="plus" size={15} />
          {t('library.devices.addDevice', 'Add device')}
        </Button>
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
          <span className="hidden md:block">{t('library.devices.integration', 'Integration')}</span>
          <SortHeader
            label={t('library.devices.room', 'Room')}
            isSorted={paging.sort === 'room'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('room');
            }}
            className="hidden justify-self-start lg:inline-flex"
          />
          <span className="hidden md:block">{t('library.devices.entities', 'Entities')}</span>
          <SortHeader
            label={t('library.devices.status', 'Status')}
            isSorted={paging.sort === 'status'}
            direction={paging.direction}
            onSort={() => {
              paging.toggleSort('status');
            }}
            className="justify-self-start"
          />
          <span className="hidden md:block">{t('library.devices.seen', 'Seen')}</span>
        </div>

        {matched.length === 0 ? (
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
          total={matched.length}
          onPage={paging.setPage}
          onSize={paging.setSize}
        />
      </div>
    </LibraryPage>
  );
}
