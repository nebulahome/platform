/**
 * The counts beside the rail's entries: how many automations, devices, packages there are.
 *
 * No endpoint counts things: each list page reads its whole list, and a count is that list's
 * length. So the rail reads the same lists under the same keys, which makes a count free on a page
 * that has read its list and makes the page free once the rail has. Each is read only for someone
 * who may read it - a count is not a way around a permission - and kept for a minute, so moving
 * between pages does not ask for every list again.
 *
 * Areas count the rooms: the house and its floors are how rooms are arranged, not more places.
 */
import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/auth/session-store';
import { CONTAINER_QUERY_KEYS, fetchContainers } from '@/containers/api';
import {
  fetchAliases,
  fetchAreas,
  fetchAutomations,
  fetchDevices,
  fetchScenes,
  fetchTags,
  fetchVendors,
  LIBRARY_QUERY_KEYS,
} from '@/library/api';
import { useInstalledPackages } from '@/packages/use-packages';

/** What a count is kept for before it is asked again. */
const COUNT_STALE_MS = 60_000;

/** The entries of the rail that carry a count. */
export type RailCountKey =
  | 'automations'
  | 'scenes'
  | 'aliases'
  | 'devices'
  | 'areas'
  | 'tags'
  | 'integrations'
  | 'packages'
  | 'containers';

/** Each count, or undefined while it is read or when it may not be. */
export type RailCounts = Readonly<Record<RailCountKey, number | undefined>>;

/**
 * Reads one list for its length, when the person may read it.
 *
 * @param key - Where the list is cached: the list page's own key.
 * @param read - Reads the list.
 * @param isAllowed - Whether the person may read it.
 * @returns The list's length, or undefined.
 */
function useLength(
  key: readonly unknown[],
  read: (signal: AbortSignal) => Promise<readonly unknown[]>,
  isAllowed: boolean,
): number | undefined {
  const query = useQuery({
    queryKey: key,
    enabled: isAllowed,
    staleTime: COUNT_STALE_MS,

    /**
     * Reads the list.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The list.
     */
    queryFn: async ({ signal }) => read(signal),
  });

  return isAllowed ? query.data?.length : undefined;
}

/**
 * Reads the rail's counts.
 *
 * @returns See {@link RailCounts}.
 */
export function useRailCounts(): RailCounts {
  const can = useSession((state) => state.can);
  const rooms = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.areas,
    enabled: can('area:read'),
    staleTime: COUNT_STALE_MS,

    /**
     * Reads every area.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The areas.
     */
    queryFn: async ({ signal }) => fetchAreas(signal),
  });
  const containers = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.list,
    enabled: can('container:read'),
    staleTime: COUNT_STALE_MS,

    /**
     * Reads every container.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns Docker's status and the containers.
     */
    queryFn: async ({ signal }) => fetchContainers(signal),
  });
  const { packages, isPending: arePackagesPending } = useInstalledPackages();

  return {
    automations: useLength(
      LIBRARY_QUERY_KEYS.automations,
      fetchAutomations,
      can('automation:read'),
    ),
    scenes: useLength(LIBRARY_QUERY_KEYS.scenes, fetchScenes, can('scene:read')),
    aliases: useLength(LIBRARY_QUERY_KEYS.aliases, fetchAliases, can('alias:read')),
    devices: useLength(LIBRARY_QUERY_KEYS.devices, fetchDevices, can('device:read')),
    tags: useLength(LIBRARY_QUERY_KEYS.tags, fetchTags, can('tag:read')),
    integrations: useLength(LIBRARY_QUERY_KEYS.vendors, fetchVendors, can('integration:read')),
    areas: can('area:read') ? rooms.data?.filter((area) => area.kind === 'room').length : undefined,
    packages: can('package:read') && !arePackagesPending ? packages.length : undefined,
    containers: can('container:read') ? containers.data?.items.length : undefined,
  };
}
