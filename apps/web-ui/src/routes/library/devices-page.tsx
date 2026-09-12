/**
 * The registry: every physical thing, the entities it owns, and what each of them reads.
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
 * Adding a device is finding one. The dialog behind the header's button runs a discovery pass
 * on an integration instance and adopts what the owner picks from what it found; there is no
 * form for typing a device in by hand, because no integration the hub ships could do anything
 * with one.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { DeviceView, EntityView } from '@nebula-home/contracts';
import { Badge, Button, Panel, Segmented, SelectField, TextField } from '@nebula-home/ui';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchEntities, LIBRARY_QUERY_KEYS } from '@/library/api';
import { matchesFilter, OPEN_FILTER, type DeviceFilter } from '@/library/device-filters';
import { readingOf, standingOf, type DeviceStanding } from '@/library/entity-reading';
import { useLive } from '@/live/live-store';
import { DEVICE_COLUMNS, DeviceRow, type EntityLine } from '@/routes/library/device-row';
import { DiscoverDialog } from '@/routes/library/discover-dialog';
import { LibraryPage } from '@/routes/library/library-page';

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
 * @param entities - Every entity.
 * @returns A map from device id to its entities.
 */
function byDevice(entities: readonly EntityView[]): Map<string, EntityView[]> {
  const groups = new Map<string, EntityView[]>();

  for (const entity of entities) {
    if (entity.deviceId !== null) {
      groups.set(entity.deviceId, [...(groups.get(entity.deviceId) ?? []), entity]);
    }
  }

  return groups;
}

/**
 * Renders the devices page.
 *
 * @returns The page.
 */
export function DevicesPage() {
  const canWrite = useSession((state) => state.can)('device:write');
  const readings = useLive((state) => state.readings);
  const liveStatus = useLive((state) => state.status);
  const [filter, setFilter] = useState<DeviceFilter>(OPEN_FILTER);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [isDiscovering, setDiscovering] = useState(false);
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

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((count) => count + 1);
    }, CLOCK_MS);

    return (): void => {
      clearInterval(timer);
    };
  }, []);

  const now = new Date();
  const groups = byDevice(entities.data ?? []);
  const all: DeviceLine[] = (devices.data ?? []).map((device) => {
    const lines = (groups.get(device.id) ?? []).map((entity) => ({
      entity,
      reading: readingOf(entity, readings[entity.entityId]),
    }));

    return {
      device,
      lines,
      standing: standingOf(
        lines.map((line) => line.reading),
        device.lastSeenAt,
      ),
    };
  });
  const shown = all.filter((line) =>
    matchesFilter(
      line.device,
      line.lines.map((entry) => entry.entity),
      line.standing.isReporting,
      filter,
    ),
  );

  const owners = [...new Set(all.map((line) => line.device.owner.id))].sort();
  const areas = [
    ...new Map(
      all
        .filter((line) => line.device.areaKey !== null)
        .map((line) => [line.device.areaKey ?? '', line.device.areaName ?? '']),
    ),
  ].sort((left, right) => left[1].localeCompare(right[1]));
  const entityCount = all.reduce((sum, line) => sum + line.lines.length, 0);

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
    <>
      <LibraryPage
        title="Devices"
        summary="One device, its entities, and the integration that owns it. This is the registry, so the addresses are the ones automations and the API use."
        noun="device"
        count={devices.isPending ? undefined : all.length}
        action={
          canWrite ? (
            <Button
              size="compact"
              onClick={() => {
                setDiscovering(true);
              }}
            >
              Add device
            </Button>
          ) : undefined
        }
        isPending={devices.isPending || entities.isPending}
        error={devices.error ?? entities.error}
        isEmpty={all.length === 0}
        emptyMessage="Nothing adopted yet. Add a device to have an integration look for what it can reach."
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <TextField
            label="Search"
            isLabelHidden
            size="compact"
            type="search"
            placeholder="Search devices, entities…"
            className="w-72"
            value={filter.search}
            onChange={(event) => {
              setFilter({ ...filter, search: event.target.value });
            }}
          />
          <SelectField
            label="Integration"
            isLabelHidden
            size="compact"
            className="w-44"
            options={[
              { value: '', label: 'All integrations' },
              ...owners.map((owner) => ({ value: owner, label: owner })),
            ]}
            value={filter.ownerId}
            onChange={(ownerId) => {
              setFilter({ ...filter, ownerId });
            }}
          />
          <SelectField
            label="Area"
            isLabelHidden
            size="compact"
            className="w-40"
            options={[
              { value: '', label: 'All areas' },
              ...areas.map(([key, name]) => ({ value: key, label: name })),
            ]}
            value={filter.areaKey}
            onChange={(areaKey) => {
              setFilter({ ...filter, areaKey });
            }}
          />
          <Segmented
            label="Which devices"
            size="compact"
            options={[
              { value: 'all', label: 'All' },
              { value: 'reporting', label: 'Reporting only' },
            ]}
            value={filter.isReportingOnly ? 'reporting' : 'all'}
            onChange={(value) => {
              setFilter({ ...filter, isReportingOnly: value === 'reporting' });
            }}
          />

          <span className="ml-auto flex items-center gap-2.5 text-caption text-foreground-subtle tabular">
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
              {shown.length === all.length ? '' : `${String(shown.length)} of `}
              {all.length} device{all.length === 1 ? '' : 's'} · {entityCount} entit
              {entityCount === 1 ? 'y' : 'ies'}
            </span>
          </span>
        </div>

        <Panel title="Registry">
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
            <p className="px-4 py-3.5 text-ui text-foreground-muted">
              Nothing matches. Clear the search or widen the filters.
            </p>
          ) : (
            <ul>
              {shown.map((line) => (
                <DeviceRow
                  key={line.device.id}
                  device={line.device}
                  lines={line.lines}
                  standing={line.standing}
                  isOpen={openIds.has(line.device.id)}
                  onToggle={() => {
                    toggle(line.device.id);
                  }}
                  now={now}
                />
              ))}
            </ul>
          )}
        </Panel>
      </LibraryPage>

      {/* Beside the page rather than inside it: the page shows its children only once there is
          something to list, and the dialog is how the first thing gets listed. */}
      <DiscoverDialog
        // Keyed on being open, so each opening is a fresh dialog with no pass from last time.
        key={isDiscovering ? 'open' : 'shut'}
        isOpen={isDiscovering}
        onClose={() => {
          setDiscovering(false);
        }}
      />
    </>
  );
}
