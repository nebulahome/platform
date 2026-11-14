/**
 * Everything a picker needs to lay the house's entities out by floor, room and device.
 *
 * The entities, the devices and the areas are the same reads the devices and areas pages make,
 * under the same keys, so opening a picker on a page that already has them costs nothing, and
 * several fields in one editor share one request.
 */
import { useQuery } from '@tanstack/react-query';

import type { AreaView, DeviceView, EntityView, IconView } from '@nebulahome/contracts';

import { signalled } from '@/lib/signalled';
import { fetchDevices, fetchEntities, LIBRARY_QUERY_KEYS } from '@/library/api';
import { useLive, type LiveReading } from '@/live/live-store';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { useAreas } from '@/routes/library/use-areas';

/** What a picker reads. */
export type EntityDirectory = {
  readonly entities: readonly EntityView[];
  readonly devices: readonly DeviceView[];
  readonly areas: readonly AreaView[];

  /** The icons of the entities and the devices, by id. */
  readonly icons: ReadonlyMap<string, IconView>;

  /** What the live channel has said since, by entity. */
  readonly readings: Readonly<Record<string, LiveReading>>;

  /** Whether the entities are still being read. */
  readonly isPending: boolean;

  /** Why the entities could not be read, when they could not. */
  readonly error: unknown;
};

/**
 * Reads the directory.
 *
 * @param isIconsWanted - Whether the icons are drawn yet: a closed picker needs none.
 * @returns See {@link EntityDirectory}.
 */
export function useEntityDirectory(isIconsWanted = true): EntityDirectory {
  const readings = useLive((state) => state.readings);
  const { areas } = useAreas();

  const entities = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.entities,
    queryFn: signalled(fetchEntities),
  });

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    queryFn: signalled(fetchDevices),
  });

  const icons = useCatalogueIcons(
    isIconsWanted
      ? [
          ...(entities.data ?? []).map((entity) => entity.icon),
          ...(devices.data ?? []).map((device) => device.icon),
        ]
      : [],
  );

  return {
    entities: entities.data ?? [],
    devices: devices.data ?? [],
    areas,
    icons,
    readings,
    isPending: entities.isPending,
    error: entities.error,
  };
}
