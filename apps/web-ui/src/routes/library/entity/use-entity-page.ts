/**
 * Everything an entity's page reads, resolved into one view of it.
 *
 * The entity itself is read on its own, keyed under the entities so that a save or a device
 * event that refreshes every entity refreshes this one too - and it starts from the row the
 * devices page already holds, so arriving from the list draws the page at once and the read only
 * brings it up to date. Around it: the device it belongs to, the vendor that device comes from,
 * the room and the floor it is in, the tags on it, and the newest state the live channel has.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AreaView,
  CapabilityState,
  DeviceView,
  EntityView,
  IconView,
  TagView,
} from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchEntity, fetchVendors, LIBRARY_QUERY_KEYS } from '@/library/api';
import { capabilityStateOf, entityScopesOf, isCommandable } from '@/library/entity-control';
import { readingOf, type Reading } from '@/library/entity-reading';
import { useLive, type LiveReading } from '@/live/live-store';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { useAreas } from '@/routes/library/use-areas';
import { useTags } from '@/routes/library/use-tags';

/** The entity, and everything around it. */
export type EntityPageView = {
  readonly entity: EntityView;

  /** The device it belongs to, when it comes from one and the devices have been read. */
  readonly device: DeviceView | undefined;

  /** The vendor's name, or its id while the catalogue is away. */
  readonly vendorName: string | null;

  /** The room it is in, and the floor that room is on. */
  readonly room: AreaView | undefined;
  readonly floor: AreaView | undefined;

  /** Its own tags, resolved. */
  readonly tags: readonly TagView[];

  /** The catalogue icons the page draws: the entity's, the device's and the tags'. */
  readonly icons: ReadonlyMap<string, IconView>;

  /** Its state now, capability by capability. */
  readonly state: CapabilityState;

  /** Its reading, in words. */
  readonly reading: Reading;

  /** What the channel last said about it, if anything. */
  readonly live: LiveReading | undefined;

  /** When its state last arrived, in milliseconds since the epoch. */
  readonly reportedAt: number | null;

  /** Whether this person may command it, and it can be commanded at all. */
  readonly canControl: boolean;

  /** Whether this person may rename it, redraw it or tag it. */
  readonly canEdit: boolean;

  /** Whether this person may make a tag from the settings. */
  readonly canCreateTags: boolean;
};

/** What the page gets. */
export type EntityPageData = {
  /** The view, once the entity has been read. */
  readonly view: EntityPageView | undefined;

  /** Whether the first read is still in flight. */
  readonly isPending: boolean;

  /** Why the read failed, when it did. */
  readonly error: unknown;
};

/**
 * Reads an entity's page.
 *
 * @param entityId - The entity, by its address.
 * @returns See {@link EntityPageData}.
 */
export function useEntityPage(entityId: string): EntityPageData {
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const live = useLive((state) => state.readings[entityId]);
  const { tags } = useTags();
  const { areas } = useAreas();

  const entity = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.entities, entityId],
    /**
     * Reads the entity.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns The entity.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEntity(entityId, signal),
    /**
     * Starts from the row the entity list already holds, when it holds one.
     *
     * @returns The entity as the list has it, or undefined.
     */
    placeholderData: () =>
      queryClient
        .getQueryData<EntityView[]>(LIBRARY_QUERY_KEYS.entities)
        ?.find((candidate) => candidate.entityId === entityId),
  });

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    /**
     * Reads every device, for the one this entity belongs to.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the page goes away.
     * @returns Every device.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchDevices(signal),
  });

  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,
    /**
     * Reads the vendors, for the name of this device's.
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

  const data = entity.data;
  // A reading linked across two ways belongs to the one device both ways are.
  const device = devices.data?.find(
    (candidate) =>
      candidate.id === data?.source ||
      (candidate.linked?.ways.some((way) => way.deviceId === data?.source) ?? false),
  );
  const icons = useCatalogueIcons([
    data?.icon ?? null,
    device?.icon ?? null,
    ...tags.map((tag) => tag.icon),
  ]);

  if (data === undefined) {
    return { view: undefined, isPending: entity.isPending, error: entity.error };
  }

  const room = areas.find((area) => area.key === data.areaKey);
  const floor = room?.kind === 'room' ? areas.find((area) => area.id === room.parentId) : undefined;
  const vendor = vendors.data?.find((candidate) => candidate.id === device?.vendorId);

  return {
    view: {
      entity: data,
      device,
      vendorName: device === undefined ? null : (vendor?.name ?? device.vendorId),
      room,
      floor,
      tags: data.tagIds.flatMap((id) => tags.filter((tag) => tag.id === id)),
      icons,
      state: capabilityStateOf(data, live),
      reading: readingOf(data, live),
      live,
      reportedAt: live?.receivedAt ?? data.lastUpdated?.getTime() ?? null,
      canControl:
        isCommandable(data) &&
        can('entity:control', entityScopesOf(data, tags, device?.tagIds ?? [])),
      canEdit: can('entity:write', entityScopesOf(data, tags, device?.tagIds ?? [])),
      canCreateTags: can('tag:write'),
    },
    isPending: false,
    error: entity.error,
  };
}
