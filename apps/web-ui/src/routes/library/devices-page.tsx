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
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { isUpdateOffered, type DeviceView, type EntityView } from '@nebulahome/contracts';
import { AppIcon, Button, Switch, TableFooter } from '@nebulahome/ui';

import { SortHeader } from '@/components/sort-header';
import { areaFacetChoices } from '@/lib/area-tree';
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

/** One device with everything the row needs, resolved once per render. */
type DeviceLine = {
  readonly device: DeviceView;
  readonly entities: readonly EntityView[];
  readonly standing: DeviceStanding;
  readonly status: DeviceStatus;
};

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
  const { areas, tree } = useAreas();
  const [filter, setFilter] = useListState(DEVICE_FILTER_CODEC);
  const [, setTick] = useState(0);

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    /**
     * Reads every device.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every device in the registry.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchDevices(signal),
  });

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    /**
     * Reads every entity, with the state it had when asked.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the component goes away.
     * @returns Every entity in the registry.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEntities(signal),
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
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((count) => count + 1);
    }, CLOCK_MS);

    return (): void => {
      clearInterval(timer);
    };
  }, []);

  const now = new Date();
  const groups = bySource(entities.data ?? []);
  const vendorNames = vendorNamesOf(vendors.data ?? []);
  const all: DeviceLine[] = (devices.data ?? []).map((device) => {
    const owned = groups.get(device.id) ?? [];
    const standing = standingOf(
      owned.map((entity) => readingOf(entity, readings[entity.entityId])),
      device.lastUpdatedAt,
    );
    const hasUpdate = owned.some((entity) => {
      const update = capabilityStateOf(entity, readings[entity.entityId]).update;

      return update !== undefined && !update.isInstalling && isUpdateOffered(update);
    });

    return {
      device,
      entities: owned,
      standing,
      status: deviceStatusOf(device, standing, hasUpdate),
    };
  });
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
  const shown = all.filter((line) =>
    matchesFilter(line.device, line.entities, filter, {
      vendorName: vendorNames.get(line.device.vendorId),
      tagNames: [
        ...tagNames(line.device.tagIds),
        ...line.entities.flatMap((entity) => tagNames(entity.tagIds)),
      ],
    }),
  );

  const vendorOptions = [...new Set(all.map((line) => line.device.vendorId))].map((id) => ({
    value: id,
    label: vendorNames.get(id) ?? id,
  }));
  // Each room under its floor, the floors by their number, the way the areas page reads.
  const areaOptions = areaFacetChoices(
    tree,
    areas,
    new Map(
      all.flatMap((line) =>
        line.device.areaKey === null ? [] : [[line.device.areaKey, line.device.areaName] as const],
      ),
    ),
  );
  const shownEntityCount = shown.reduce((sum, line) => sum + line.entities.length, 0);
  const paging = usePaging('devices', SORTS, shown.length);

  /**
   * Compares two rows by the column the table is sorted by, the name breaking ties.
   *
   * @param left - One row.
   * @param right - The other.
   * @returns Their order.
   */
  const compare = (left: DeviceLine, right: DeviceLine): number => {
    const byName = left.device.name.localeCompare(right.device.name);
    const order =
      paging.sort === 'room'
        ? // A device in no room goes last.
          (left.device.areaName ?? '￿').localeCompare(right.device.areaName ?? '￿') || byName
        : paging.sort === 'status'
          ? DEVICE_STATUS_ORDER.indexOf(left.status.kind) -
              DEVICE_STATUS_ORDER.indexOf(right.status.kind) || byName
          : byName;

    return paging.direction === 'asc' ? order : -order;
  };
  const rows = paging.rows([...shown].sort(compare));

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
      count={devices.isPending ? undefined : all.length}
      shownCount={shown.length}
      summary={[`${String(shownEntityCount)} ${shownEntityCount === 1 ? 'entity' : 'entities'}`]}
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
      isEmpty={all.length === 0}
      emptyMessage={t(
        'library.devices.nothingYetAddA',
        'Nothing yet. Add a device from Integrations and it appears here as soon as the hub has heard from it.',
      )}
    >
      <div className="overflow-hidden rounded-card border border-border bg-surface">
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
