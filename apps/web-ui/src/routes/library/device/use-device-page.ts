/**
 * Everything a device's page reads, resolved into one view of it.
 *
 * The device comes from the devices list the registry page already holds, so arriving from it
 * draws the page at once. Around it: its entities, each with the newest reading the live channel
 * has, the vendor it comes from (the catalogue's entry, which the settings dialog needs to draw
 * the driver's form), the room and floor it is in, and the tags on it and on its entities.
 */
import { useQuery } from '@tanstack/react-query';

import type {
  AreaView,
  DeviceView,
  IconView,
  IntegrationVendorView,
  TagView,
} from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchEntities, fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import { bySource, vendorNamesOf } from '@/library/device-entities';
import { capabilityStateOf, entityScopesOf, isCommandable } from '@/library/entity-control';
import { readingOf, standingOf, type DeviceStanding } from '@/library/entity-reading';
import { useLive } from '@/live/live-store';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import type { EntityLine } from '@/routes/library/entity-row';
import { useAreas } from '@/routes/library/use-areas';
import { useTags } from '@/routes/library/use-tags';

/** The device, and everything around it. */
export type DevicePageView = {
  readonly device: DeviceView;

  /** The catalogue's entry for its vendor; undefined for the System device, or while away. */
  readonly vendor: IntegrationVendorView | undefined;

  /** The vendor's name, or its id while the catalogue is away. */
  readonly vendorName: string;

  /** The room it is in, and the floor that room is on. */
  readonly room: AreaView | undefined;
  readonly floor: AreaView | undefined;

  /** Its own tags, resolved. */
  readonly tags: readonly TagView[];

  /** Its entities, each with its reading, icon and tags. */
  readonly lines: readonly EntityLine[];

  /** Whether it is reporting, and when it was last heard from. */
  readonly standing: DeviceStanding;

  /** The catalogue icons the page draws: the device's, its entities' and the tags'. */
  readonly icons: ReadonlyMap<string, IconView>;

  /** Whether this person may change the device. */
  readonly canWrite: boolean;

  /** Whether this person may remove it. */
  readonly canRemove: boolean;

  /** Whether this person may configure its entities. */
  readonly canEditEntities: boolean;

  /** Whether this person may make a tag from the settings. */
  readonly canCreateTags: boolean;
};

/** What the page gets. */
export type DevicePageData = {
  /** The view, once the device has been read and found. */
  readonly view: DevicePageView | undefined;

  /** Whether the first read is still in flight. */
  readonly isPending: boolean;

  /** Why the read failed. */
  readonly error: unknown;

  /** Whether the devices were read and none has the id. */
  readonly isMissing: boolean;
};

/**
 * Reads a device's page.
 *
 * @param deviceId - The device, by its id.
 * @returns See {@link DevicePageData}.
 */
export function useDevicePage(deviceId: string): DevicePageData {
  const can = useSession((state) => state.can);
  const readings = useLive((state) => state.readings);
  const { tags } = useTags();
  const { areas } = useAreas();

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    /**
     * Reads every device, for this one.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Every device.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchDevices(signal),
  });

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    /**
     * Reads every entity, for this device's.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Every entity.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEntities(signal),
  });

  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,
    /**
     * Reads the vendors, for this device's name and driver.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Every vendor, or none while the hub is away.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      try {
        return await fetchVendors(signal);
      } catch {
        return [];
      }
    },
  });

  const device = devices.data?.find((candidate) => candidate.id === deviceId);
  const owned = device === undefined ? [] : (bySource(entities.data ?? []).get(device.id) ?? []);
  const icons = useCatalogueIcons([
    device?.icon ?? null,
    ...owned.map((entity) => entity.icon),
    ...tags.map((tag) => tag.icon),
  ]);

  if (device === undefined) {
    return {
      view: undefined,
      isPending: devices.isPending,
      error: devices.error,
      isMissing: devices.isSuccess,
    };
  }

  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const room = areas.find((area) => area.id === device.areaId);
  const floor = room?.kind === 'room' ? areas.find((area) => area.id === room.parentId) : undefined;
  const vendor = vendors.data?.find((candidate) => candidate.id === device.vendorId);
  const lines: EntityLine[] = [...owned]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entity) => {
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
    view: {
      device,
      vendor,
      vendorName: vendorNamesOf(vendors.data ?? []).get(device.vendorId) ?? device.vendorId,
      room,
      floor,
      tags: device.tagIds.flatMap((id) => {
        const tag = tagsById.get(id);

        return tag === undefined ? [] : [tag];
      }),
      lines,
      standing: standingOf(
        lines.map((line) => line.reading),
        device.lastUpdatedAt,
      ),
      icons,
      canWrite: can('device:write'),
      canRemove: can('device:delete'),
      canEditEntities: can('entity:write'),
      canCreateTags: can('tag:write'),
    },
    isPending: false,
    error: entities.error,
    isMissing: false,
  };
}
