/**
 * The registry: every device, the entities it owns, and what each of them reads.
 *
 * This is the one page where the address matters. Everywhere else a person picks a thing by its
 * icon, its name and its room; here they are looking at the registry itself, and
 * `light.hallway_ceiling` is what an automation or the API will refer to. So the entity
 * addresses are shown, in the mono face, under the device that owns them - and beside each, its
 * reading, which is the live one: the channel the shell keeps open delivers every change, and a
 * row shows the newer of what the page loaded with and what has arrived since.
 *
 * A device's standing is read off those same readings. "Reporting" means an entity of it is
 * reachable and has said something; "last seen" is when the newest of them spoke. Neither is a
 * column, and neither needs to be: the readings are already here.
 *
 * Nothing is added here. A device is added from its vendor's page, and appears here the moment
 * the hub has heard from it; a link from that page - `?device=` - opens this one on that row
 * alone, expanded, which is the registry's answer to "what did that just create". The search and
 * the filters are in the address too, so the back button from an entity's page returns to the
 * list as it was left.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { DeviceView, EntityView } from '@nebula-home/contracts';
import { Badge, Button } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { useListState } from '@/lib/use-list-state';
import { fetchDevices, fetchEntities, fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  DEVICE_FILTER_CODEC,
  isNarrowing,
  matchesFilter,
  OPEN_FILTER,
} from '@/library/device-filters';
import { capabilityStateOf, entityScopesOf, isCommandable } from '@/library/entity-control';
import { readingOf, standingOf, type DeviceStanding } from '@/library/entity-reading';
import { useLive } from '@/live/live-store';
import { DeviceFilterButton } from '@/routes/library/device-filter';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { DEVICE_COLUMNS, DeviceRow } from '@/routes/library/device-row';
import type { EntityLine } from '@/routes/library/entity-row';
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
  readonly lines: readonly EntityLine[];
  readonly standing: DeviceStanding;
};

/**
 * The entities, by the device that owns them.
 *
 * Grouped by the entity's source, which is the device id - the one the page lists the device
 * under - rather than by the registry's row uuid.
 *
 * @param entities - Every entity.
 * @returns A map from device id to its entities.
 */
function bySource(entities: readonly EntityView[]): Map<string, EntityView[]> {
  const groups = new Map<string, EntityView[]>();

  for (const entity of entities) {
    groups.set(entity.source, [...(groups.get(entity.source) ?? []), entity]);
  }

  return groups;
}

/**
 * Renders the devices page.
 *
 * @returns The page.
 */
export function DevicesPage() {
  const readings = useLive((state) => state.readings);
  const liveStatus = useLive((state) => state.status);
  const can = useSession((state) => state.can);
  const canEditEntities = can('entity:write');
  const { tags } = useTags();
  const { areas } = useAreas();
  const [filter, setFilter] = useListState(DEVICE_FILTER_CODEC);
  const linkedDeviceId = filter.deviceId;
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(
    () => new Set(linkedDeviceId === '' ? [] : [linkedDeviceId]),
  );
  const [linkSeen, setLinkSeen] = useState(linkedDeviceId);
  const [, setTick] = useState(0);

  if (linkSeen !== linkedDeviceId) {
    // A link to another device while the page is open: that row opens too. Adjusted during the
    // render rather than in an effect, so the row is open on the first paint after the link.
    setLinkSeen(linkedDeviceId);

    if (linkedDeviceId !== '') {
      setOpenIds((current) => new Set([...current, linkedDeviceId]));
    }
  }

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

  const icons = useCatalogueIcons([
    ...tags.map((tag) => tag.icon),
    ...(devices.data ?? []).map((device) => device.icon),
    ...(entities.data ?? []).map((entity) => entity.icon),
  ]);
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
  // The system device's vendor is the platform itself, which no hub catalogue lists.
  const vendorNames = new Map([
    ['nebula', 'NebulaHome'],
    ...(vendors.data ?? []).map((vendor): [string, string] => [vendor.id, vendor.name]),
  ]);
  const all: DeviceLine[] = (devices.data ?? []).map((device) => {
    const lines: EntityLine[] = (groups.get(device.id) ?? []).map((entity) => {
      const live = readings[entity.entityId];

      return {
        entity,
        reading: readingOf(entity, live),
        state: capabilityStateOf(entity, live),
        reportedAt: live?.receivedAt ?? entity.lastUpdated?.getTime() ?? null,
        icon: entity.icon === null ? undefined : icons.get(entity.icon),
        tags: entity.tagIds.flatMap((id) => {
          const tag = tagsById.get(id);

          return tag === undefined ? [] : [{ tag, icon: icons.get(tag.icon ?? '') }];
        }),
        canControl:
          isCommandable(entity) &&
          can('entity:control', entityScopesOf(entity, tags, device.tagIds)),
      };
    });

    return {
      device,
      lines,
      standing: standingOf(
        lines.map((line) => line.reading),
        device.lastUpdatedAt,
      ),
    };
  });
  const shown = all.filter((line) =>
    matchesFilter(
      line.device,
      line.lines.map((entry) => entry.entity),
      filter,
      {
        vendorName: vendorNames.get(line.device.vendorId),
        tagNames: [
          ...line.device.tagIds.flatMap((id) => {
            const tag = tagsById.get(id);

            return tag === undefined ? [] : [tag.name];
          }),
          ...line.lines.flatMap((entry) => entry.tags.map(({ tag }) => tag.name)),
        ],
      },
    ),
  );

  const vendorOptions = [...new Set(all.map((line) => line.device.vendorId))].map((id) => ({
    value: id,
    label: vendorNames.get(id) ?? id,
  }));
  const areasByKey = new Map(areas.map((area) => [area.key, area]));
  // Each room under its floor, the way the areas page arranges them.
  const areaOptions = [
    ...new Map(
      all.flatMap((line) =>
        line.device.areaKey === null ? [] : [[line.device.areaKey, line] as const],
      ),
    ).entries(),
  ].map(([key, line]) => {
    const area = areasByKey.get(key);
    const floor = areas.find(
      (candidate) => candidate.id === area?.parentId && candidate.kind === 'floor',
    );

    return {
      value: key,
      label: line.device.areaName ?? key,
      ...(floor === undefined ? {} : { group: floor.name }),
    };
  });
  const shownEntityCount = shown.reduce((sum, line) => sum + line.lines.length, 0);

  /**
   * Opens a device that is shut, or shuts one that is open.
   *
   * @param deviceId - Which device.
   */
  const toggle = (deviceId: string): void => {
    setOpenIds((current) => {
      const next = new Set(current);

      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }

      return next;
    });
  };

  return (
    <LibraryPage
      title="Devices"
      noun="device"
      count={devices.isPending ? undefined : all.length}
      shownCount={shown.length}
      tools={
        <>
          {linkedDeviceId === '' ? null : (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                setFilter({ ...filter, deviceId: '' });
              }}
            >
              Show all devices
            </Button>
          )}
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
        <span>
          {shownEntityCount} entit{shownEntityCount === 1 ? 'y' : 'ies'}
        </span>
      </div>

      <div className="rounded-panel border border-border face-card">
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
                lines={line.lines}
                standing={line.standing}
                isOpen={openIds.has(line.device.id)}
                onToggle={() => {
                  toggle(line.device.id);
                }}
                now={now}
                canEditEntities={canEditEntities}
              />
            ))}
          </ul>
        )}
      </div>
    </LibraryPage>
  );
}
