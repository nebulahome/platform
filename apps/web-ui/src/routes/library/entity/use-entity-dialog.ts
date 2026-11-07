/**
 * Everything an entity's dialog reads, resolved into one view of it.
 *
 * The entity itself is read on its own, keyed under the entities so that a save or a device
 * event that refreshes every entity refreshes this one too - and it starts from the row the
 * entity list already holds, so a dialog opened from a list draws at once and the read only
 * brings it up to date. Around it: the device it belongs to, that device's battery, the tags that
 * decide what this person may do with it, its icon, and the newest state the live channel has.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { CapabilityState, DeviceView, EntityView, IconView } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchEntities, fetchEntity, LIBRARY_QUERY_KEYS } from '@/library/api';
import { capabilityStateOf, entityScopesOf, isCommandable } from '@/library/entity-control';
import { readingOf, type Reading } from '@/library/entity-reading';
import { useLive } from '@/live/live-store';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { useTags } from '@/routes/library/use-tags';

/** The entity, and everything around it. */
export type EntityDialogView = {
  readonly entity: EntityView;

  /** The device it belongs to, when it comes from one and the devices have been read. */
  readonly device: DeviceView | undefined;

  /** Its own icon from the catalogue, when it has one and it has been read. */
  readonly icon: IconView | undefined;

  /** Its state now, capability by capability. */
  readonly state: CapabilityState;

  /** Its reading, in words, and whether it answers. */
  readonly reading: Reading;

  /** When its state last arrived, in milliseconds since the epoch. */
  readonly reportedAt: number | null;

  /** The battery of its device, from the device's battery sensor; null when it has none. */
  readonly battery: number | null;

  /** Whether this person may command it, and it can be commanded at all. */
  readonly canControl: boolean;

  /** Whether this person may rename it, redraw it, tag it or disable it. */
  readonly canEdit: boolean;

  /** Whether this person may make a tag from the settings. */
  readonly canCreateTags: boolean;

  /** Whether this person may link and unlink: the device's to allow. */
  readonly canLink: boolean;
};

/** What the dialog gets. */
export type EntityDialogData = {
  /** The view, once the entity has been read. */
  readonly view: EntityDialogView | undefined;

  /** Why the read failed, when it did. */
  readonly error: unknown;
};

/**
 * Reads an entity's dialog.
 *
 * @param entityId - The entity, by its address.
 * @returns See {@link EntityDialogData}.
 */
export function useEntityDialog(entityId: string): EntityDialogData {
  const queryClient = useQueryClient();
  const can = useSession((state) => state.can);
  const live = useLive((state) => state.readings[entityId]);
  const { tags } = useTags();

  const entity = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.entities, entityId],
    /**
     * Reads the entity.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the dialog goes away.
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
     * @param context.signal - Cancels the request when the dialog goes away.
     * @returns Every device.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchDevices(signal),
  });

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    /**
     * Reads every entity, for the battery sensor of this one's device.
     *
     * @param context - What TanStack Query provides, including the cancellation signal.
     * @param context.signal - Cancels the request when the dialog goes away.
     * @returns Every entity.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchEntities(signal),
  });

  const data = entity.data;
  // The battery is a sensor of its own on the same device.
  const batteryEntity =
    data === undefined
      ? undefined
      : entities.data?.find(
          (candidate) =>
            candidate.entityId !== data.entityId &&
            candidate.source === data.source &&
            candidate.deviceClass === 'battery',
        );
  const batteryLive = useLive((state) =>
    batteryEntity === undefined ? undefined : state.readings[batteryEntity.entityId],
  );
  // A reading linked across two ways belongs to the one device both ways are.
  const device = devices.data?.find(
    (candidate) =>
      candidate.id === data?.source ||
      (candidate.linked?.ways.some((way) => way.deviceId === data?.source) ?? false),
  );
  const icons = useCatalogueIcons([data?.icon ?? null]);

  if (data === undefined) {
    return { view: undefined, error: entity.error };
  }

  const scopes = entityScopesOf(data, tags, device?.tagIds ?? []);
  const battery =
    batteryEntity === undefined
      ? undefined
      : capabilityStateOf(batteryEntity, batteryLive).sensor_numeric?.value;

  return {
    view: {
      entity: data,
      device,
      icon: data.icon === null ? undefined : icons.get(data.icon),
      state: capabilityStateOf(data, live),
      reading: readingOf(data, live),
      reportedAt: live?.receivedAt ?? data.lastUpdated?.getTime() ?? null,
      battery: battery ?? null,
      canControl: isCommandable(data) && can('entity:control', scopes),
      canEdit: can('entity:write', scopes),
      canCreateTags: can('tag:write'),
      canLink: can('device:write'),
    },
    error: entity.error,
  };
}
