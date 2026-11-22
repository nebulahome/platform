/**
 * The counts beside the rail's entries: how many automations, devices, packages there are.
 *
 * No endpoint counts things: each list page reads its whole list, and a count is that list's
 * length. So the rail reads the same lists under the same keys, which makes a count free on a page
 * that has read its list; the page itself still reads its list again when it opens, since what the
 * rail read may be older than the page wants. Each is read only for someone who may read it - a
 * count is not a way around a permission - and kept for a minute, so the rail itself does not ask
 * for every list again each time it is drawn anew.
 *
 * Areas count the rooms: the house and its floors are how rooms are arranged, not more places.
 * Integrations count what the Integrations page lists: the brokers the platform brings are not
 * integrations somebody installed.
 *
 * Beside the counts, what wants a look: the updates waiting for the integrations and the packages,
 * read from the same lists their pages filter by, so the rail asks for nothing a page would not.
 */
import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/auth/session-store';
import { CONTAINER_QUERY_KEYS, fetchContainers } from '@/containers/api';
import { signalled } from '@/lib/signalled';
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
import { fetchAvailablePackages, PACKAGE_QUERY_KEYS } from '@/packages/api';
import { useInstalledPackages } from '@/packages/use-packages';

/** What a count is kept for before it is asked again. */
const COUNT_STALE_MS = 60_000;

/** What the packages index is kept for: it changes by the day, as on the Packages page. */
const INDEX_STALE_MS = 5 * 60_000;

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
    queryFn: signalled(read),
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
    queryFn: signalled(fetchAreas),
  });
  const containers = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.list,
    enabled: can('container:read'),
    staleTime: COUNT_STALE_MS,
    queryFn: signalled(fetchContainers),
  });
  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,
    enabled: can('integration:read'),
    staleTime: COUNT_STALE_MS,
    queryFn: signalled(fetchVendors),
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
    integrations: can('integration:read')
      ? vendors.data?.filter((vendor) => vendor.origin !== 'platform').length
      : undefined,
    areas: can('area:read') ? rooms.data?.filter((area) => area.kind === 'room').length : undefined,
    packages: can('package:read') && !arePackagesPending ? packages.length : undefined,
    containers: can('container:read') ? containers.data?.items.length : undefined,
  };
}

/** The entries of the rail that can ask for a look. */
export type RailAlertKey = 'integrations' | 'packages';

/** How many updates each has waiting: zero when none, or while it is read, or when it may not be. */
export type RailAlerts = Readonly<Record<RailAlertKey, number>>;

/**
 * Reads what wants a look: the integrations with a newer release or another build waiting (the
 * Integrations page's "update" filter), and the installed packages with a newer release out (the
 * Packages page's "Version … is out").
 *
 * @returns See {@link RailAlerts}.
 */
export function useRailAlerts(): RailAlerts {
  const can = useSession((state) => state.can);
  const mayReadIntegrations = can('integration:read');
  const mayReadPackages = can('package:read');
  const vendors = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.vendors,
    enabled: mayReadIntegrations,
    staleTime: COUNT_STALE_MS,
    queryFn: signalled(fetchVendors),
  });
  const available = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.available,
    enabled: mayReadPackages,
    staleTime: INDEX_STALE_MS,
    queryFn: signalled(fetchAvailablePackages),
  });

  return {
    integrations: mayReadIntegrations
      ? (vendors.data?.filter(
          (vendor) => vendor.update?.hasUpdate === true || vendor.update?.hasNewBuild === true,
        ).length ?? 0)
      : 0,
    packages: mayReadPackages
      ? (available.data?.items.filter((offered) => offered.hasUpdate && offered.latest !== null)
          .length ?? 0)
      : 0,
  };
}
