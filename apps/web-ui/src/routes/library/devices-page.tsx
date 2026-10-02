/**
 * The registry: every device, how it is doing, and the way into each.
 *
 * A row is a device - its name, where it comes from, the room it is in, how many entities it
 * exposes, whether it is reporting and when it was last heard from - and a press opens the
 * device's own page, where its entities are, each with what it reads.
 *
 * A device's standing is read off its entities' readings, the live ones whenever the channel the
 * shell keeps open has spoken. "Reporting" means an entity of it is reachable and has said
 * something; "last seen" is when the newest of them spoke. Neither is a column the API serves,
 * and neither needs to be: the readings are already here.
 *
 * Nothing is added here. A device is added from its vendor's page, and appears here the moment
 * the hub has heard from it. The search and the filters are in the address, so the back button
 * from a device's page returns to the list as it was left.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { DeviceView, EntityView } from '@nebulahome/contracts';
import { Badge } from '@nebulahome/ui';

import { areaFacetChoices } from '@/lib/area-tree';
import { useListState } from '@/lib/use-list-state';
import { fetchDevices, fetchEntities, fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import { bySource, vendorNamesOf } from '@/library/device-entities';
import {
  DEVICE_FILTER_CODEC,
  isNarrowing,
  matchesFilter,
  OPEN_FILTER,
} from '@/library/device-filters';
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

/** How often "last seen" is re-read against the clock, so "now" turns into "1 minute ago". */
const CLOCK_MS = 30_000;

/** One device with everything the row needs, resolved once per render. */
type DeviceLine = {
  readonly device: DeviceView;
  readonly entities: readonly EntityView[];
  readonly standing: DeviceStanding;
};

/**
 * Renders the devices page.
 *
 * @returns The page.
 */
export function DevicesPage() {
  const readings = useLive((state) => state.readings);
  const liveStatus = useLive((state) => state.status);
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

    return {
      device,
      entities: owned,
      standing: standingOf(
        owned.map((entity) => readingOf(entity, readings[entity.entityId])),
        device.lastUpdatedAt,
      ),
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

  return (
    <LibraryPage
      title="Devices"
      noun="device"
      count={devices.isPending ? undefined : all.length}
      shownCount={shown.length}
      summary={[`${String(shownEntityCount)} ${shownEntityCount === 1 ? 'entity' : 'entities'}`]}
      tools={
        <>
          <SearchField
            placeholder="Search devices, entities…"
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
      isPending={devices.isPending || entities.isPending}
      error={devices.error ?? entities.error}
      isEmpty={all.length === 0}
      emptyMessage="Nothing yet. Add a device from Integrations and it appears here as soon as the hub has heard from it."
    >
      <div className="flex flex-wrap items-center justify-end gap-2.5 text-caption text-foreground-subtle tabular">
        {liveStatus === 'live' ? (
          <Badge tone="success" size="small">
            Live
          </Badge>
        ) : (
          <Badge tone="neutral" size="small">
            {liveStatus === 'connecting' ? 'Connecting' : 'Not live'}
          </Badge>
        )}
      </div>

      <div className="overflow-hidden rounded-panel border border-border face-card">
        <div
          className={`${DEVICE_COLUMNS} border-b border-border-soft px-4 py-2.5 text-label text-foreground-subtle uppercase`}
          aria-hidden="true"
        >
          <span>Device</span>
          <span className="hidden md:block">Integration</span>
          <span className="hidden lg:block">Area</span>
          <span className="hidden md:block">Entities</span>
          <span className="hidden md:block">Status</span>
          <span className="hidden md:block">Last seen</span>
          <span />
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
            {shown.map((line) => (
              <DeviceRow
                key={line.device.id}
                device={line.device}
                vendorName={vendorNames.get(line.device.vendorId) ?? line.device.vendorId}
                icon={icons.get(line.device.icon ?? '')}
                entityCount={line.entities.length}
                standing={line.standing}
                now={now}
              />
            ))}
          </ul>
        )}
      </div>
    </LibraryPage>
  );
}
